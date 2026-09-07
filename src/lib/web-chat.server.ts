// Server-only persistence for the public AI quote conversation.
//
// Hard boundaries held here:
// - Tenant identity comes from the URL slug only, resolved server-side.
// - Web messages are written to web_conversation_messages, never to `messages`
//   (the SMS delivery table), so no SMS pipeline, usage or webhook code sees them.
// - Lead capture uses channel: "web", which returns before any acknowledgement
//   or follow-up job is enqueued. No provider is ever called on this path.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolvePublicTenant, type PublicTenant } from "@/lib/quote-form.server";
import {
  DECLINED_MESSAGE,
  FLEXIBLE_CHOICE,
  DUPLICATE_MESSAGE,
  applyAnswer,
  campaignPrefill,
  completionMessage,
  nextStep,
  promptFor,
  resolveOutcome,
  welcomeMessage,
  type WebChatCollected,
  type WebChatPrompt,
  type WebChatTenant,
} from "@/lib/web-chat";
import {
  AMBIGUOUS_CORRECTION_MESSAGE,
  FIELD_LABELS,
  detectCorrection,
  hasCorrectionCue,
  hasExplicitChangeIntent,
  parseChangeDirective,
} from "@/lib/web-chat-correction";
import { isBookingOnlyTenant } from "@/lib/booking-only-mode";
import {
  BOOKING_CHANGE_MESSAGE,
  BOOKING_CONFLICT_MESSAGE,
  BOOKING_EXPIRED_MESSAGE,
  BOOKING_UNAVAILABLE_MESSAGE,
  bookingDeclinedMessage,
} from "@/lib/web-chat-booking";
import {
  UNSUPPORTED_REQUEST_MESSAGE,
  applyFieldDirectives,
  fieldUpdateMessage,
  ambiguityMessage,
  groupedMissingMessage,
  outstandingFields,
  parseApprovedLocations,
  unmatchedServiceMessage,
} from "@/lib/web-chat-intake";
import { sanitiseCustomerText } from "@/lib/customer-text";
import {
  aiCorrectionMessage,
  resolveIntake,
} from "@/lib/web-chat-ai-extraction";
import {
  acknowledgeFields,
  answerQuestion,
  assembleReply,
  isConversationalIntakeTenant,
  replyAsksSomething,
  uncertainServiceMessage,
  unsupportedAnswer,
  type AnswerFacts,
} from "@/lib/web-chat-conversation";
import { extractWithAi, type AiExtractor } from "@/lib/web-chat-ai-extraction.server";




const MAX_MESSAGES = 60;



export type WebChatTurn = { role: "customer" | "assistant" | "system"; body: string };

export type WebChatState = {
  conversationId: string;
  status: string;
  messages: WebChatTurn[];
  prompt: WebChatPrompt | null;
  requiresOwnerReview: boolean;
  completed: boolean;
  declined: boolean;
  duplicate: boolean;
  error?: string | null;
  /** First name of a contact recognised via their personal campaign link. */
  returningName?: string | null;
};

function toChatTenant(tenant: PublicTenant, offerPercent?: number | null): WebChatTenant {
  return {
    offerPercent: offerPercent ?? null,
    name: tenant.name,
    flexibleRequestsEnabled: tenant.flexibleRequestsEnabled,
    bookingEnabled: isBookingOnlyTenant(tenant.businessId),
    services: tenant.services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      included_items: service.included_items,
      excluded_items: service.excluded_items,
      qualification_note: service.qualification_note,
      price_guidance: service.price_guidance,
      campaign_eligible: service.campaign_eligible,
    })),
  };
}

async function addMessage(
  businessId: string,
  conversationId: string,
  role: WebChatTurn["role"],
  body: string,
): Promise<void> {
  await supabaseAdmin.from("web_conversation_messages").insert({
    business_id: businessId,
    conversation_id: conversationId,
    role,
    // Persisted transcript lines are customer-facing text.
    body: sanitiseCustomerText(body).slice(0, 2000),
  });
}

async function loadTurns(conversationId: string): Promise<WebChatTurn[]> {
  const { data } = await supabaseAdmin
    .from("web_conversation_messages")
    .select("role, body")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES + 10);
  return (data ?? []).map((row) => ({ role: row.role as WebChatTurn["role"], body: row.body }));
}

/**
 * Rehydrates an existing conversation after a page refresh, so corrected values
 * are never lost. Tenant-scoped: a conversation id from another business, or a
 * tenant that is no longer in AI mode, resolves to null and a fresh chat starts.
 */
export async function resumeWebChat(slug: string, conversationId: string): Promise<WebChatState | null> {
  const tenant = await resolvePublicTenant(slug);
  if (!tenant || tenant.quoteMode !== "ai_chat") return null;

  const { data: conversation } = await supabaseAdmin
    .from("web_conversations")
    .select("id, status, collected, requires_owner_review, lead_id")
    .eq("id", conversationId)
    .eq("business_id", tenant.businessId)
    .maybeSingle();
  // A completed or declined conversation is never resumable, so a refresh can
  // never be turned into a second booking.
  if (!conversation || conversation.status !== "active") return null;

  const chatTenant = toChatTenant(tenant);
  let collected = (conversation.collected ?? {}) as WebChatCollected;
  const turns = await loadTurns(conversation.id);
  if (turns.length === 0 || turns.length > MAX_MESSAGES) return null;

  let step = nextStep(collected);

  // Booking step: the offer list stored on the conversation is display state and
  // may be stale. Re-derive it from the database and live availability so a
  // resumed conversation can only ever select a slot that is still bookable.
  if ((step === "booking" || step === "booking_confirm") && conversation.lead_id) {
    const { rehydrateBookingOffers } = await import("@/lib/web-chat-booking.server");
    const rehydrated = await rehydrateBookingOffers({
      businessId: tenant.businessId,
      leadId: conversation.lead_id,
    });

    if (rehydrated.state === "open") {
      collected = { ...collected, pilot_offers: rehydrated.offers, booking_selected: null, booking_declined: false };
      await supabaseAdmin
        .from("web_conversations")
        .update({ collected: collected as never })
        .eq("id", conversation.id)
        .eq("business_id", tenant.businessId);
    } else {
      // Already booked elsewhere, or nothing bookable is left: close the booking
      // step instead of offering a slot that cannot be honoured.
      const closing =
        rehydrated.state === "already_booked"
          ? await (async () => {
              const { bookingConfirmationText } = await import("@/lib/web-chat-booking.server");
              return await bookingConfirmationText({
                businessId: tenant.businessId,
                leadId: conversation.lead_id!,
                slotStart: rehydrated.slotStart,
              });
            })()
          : BOOKING_UNAVAILABLE_MESSAGE;
      collected = { ...collected, booking_declined: rehydrated.state !== "already_booked" };
      await supabaseAdmin
        .from("web_conversations")
        .update({
          collected: collected as never,
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", conversation.id)
        .eq("business_id", tenant.businessId);
      await addMessage(tenant.businessId, conversation.id, "assistant", closing);
      return {
        conversationId: conversation.id,
        status: "completed",
        messages: [...turns, { role: "assistant", body: closing }],
        prompt: null,
        requiresOwnerReview: conversation.requires_owner_review,
        completed: true,
        declined: false,
        duplicate: false,
      };
    }
    step = nextStep(collected);
  }

  return {
    conversationId: conversation.id,
    status: conversation.status,
    messages: turns,
    prompt: step ? promptFor(step, chatTenant, collected) : null,
    requiresOwnerReview: conversation.requires_owner_review,
    completed: false,
    declined: false,
    duplicate: false,
  };
}

/** Starts a conversation for an AI-mode tenant. Returns null for unknown/manual tenants. */
export async function startWebChat(slug: string, campaignToken?: string | null): Promise<WebChatState | null> {
  const tenant = await resolvePublicTenant(slug);
  if (!tenant || tenant.quoteMode !== "ai_chat") return null;

  // A contact arriving via their own campaign link is recognised by the
  // link's private token: details already on file (name, mobile, email) are
  // prefilled and never re-asked, and the conversation is attached to their
  // existing lead so the new enquiry lands on their own profile.
  let prefill: WebChatCollected = {};
  let returningLeadId: string | null = null;
  if (campaignToken) {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, name, mobile_number, email")
      .eq("business_id", tenant.businessId)
      .eq("public_token", campaignToken)
      .is("deleted_at", null)
      .maybeSingle();
    if (lead) {
      const known = campaignPrefill(lead);
      if (known) {
        prefill = known;
        returningLeadId = lead.id as string;
      }
    }
  }

  const chatTenant = toChatTenant(tenant);
  const { data: conversation, error } = await supabaseAdmin
    .from("web_conversations")
    .insert({
      business_id: tenant.businessId,
      status: "active",
      collected: prefill as never,
      lead_id: returningLeadId,
    })
    .select("id")
    .single();
  if (error || !conversation) throw new Error("Could not start the conversation.");

  const greeting = welcomeMessage(chatTenant);
  const first = promptFor("service", chatTenant, prefill);
  await addMessage(tenant.businessId, conversation.id, "assistant", greeting);
  await addMessage(tenant.businessId, conversation.id, "assistant", first.text);

  // A recognised returning contact is greeted by (first) name.
  const returningName = (() => {
    const first2 = (prefill.name ?? "").trim().split(/\s+/)[0] ?? "";
    if (!first2) return null;
    return first2.charAt(0).toUpperCase() + first2.slice(1);
  })();

  return {
    conversationId: conversation.id,
    status: "active",
    messages: [
      { role: "assistant", body: greeting },
      { role: "assistant", body: first.text },
    ],
    prompt: first,
    requiresOwnerReview: false,
    completed: false,
    declined: false,
    duplicate: false,
    returningName,
  };
}

export async function replyToWebChat(input: {
  slug: string;
  conversationId: string;
  answer: string;
  formUrl: string | null;
  /**
   * Idempotency guard: the step the client believed it was answering. When the
   * conversation has already moved past it (a retried or double-submitted turn),
   * the answer is not applied again — the current state is returned instead.
   */
  expectedStep?: string | null;
}): Promise<WebChatState | null> {
  const tenant = await resolvePublicTenant(input.slug);
  if (!tenant || tenant.quoteMode !== "ai_chat") return null;

  const { data: conversation } = await supabaseAdmin
    .from("web_conversations")
    .select("id, business_id, status, collected, lead_id, requires_owner_review")
    .eq("id", input.conversationId)
    // Tenant scoping: a conversation id from another business can never be driven.
    .eq("business_id", tenant.businessId)
    .maybeSingle();
  if (!conversation) return null;

  const chatTenant = toChatTenant(tenant);
  const collected = (conversation.collected ?? {}) as WebChatCollected;
  const turns = await loadTurns(conversation.id);

  if (conversation.status !== "active" || turns.length > MAX_MESSAGES) {
    // A confirmed booking is historical. A later message can still update the
    // customer's own details, but it never moves, rebooks or cancels the slot —
    // anything that would affect the visit goes to the owner for review.
    const change =
      conversation.status === "completed" && conversation.lead_id && turns.length <= MAX_MESSAGES
        ? await handleBookingChangeRequest({
            tenant,
            chatTenant,
            conversationId: conversation.id,
            leadId: conversation.lead_id,
            collected,
            answer: input.answer,
            turns,
            requiresOwnerReview: conversation.requires_owner_review,
          })
        : null;
    if (change) return change;

    return {
      conversationId: conversation.id,
      status: conversation.status,
      messages: turns,
      prompt: null,
      requiresOwnerReview: conversation.requires_owner_review,
      completed: conversation.status === "completed",
      declined: conversation.status === "declined",
      duplicate: false,
    };
  }


  const step = nextStep(collected);
  if (!step) {
    return {
      conversationId: conversation.id,
      status: conversation.status,
      messages: turns,
      prompt: null,
      requiresOwnerReview: conversation.requires_owner_review,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }

  // Replayed/duplicated turn: the conversation already advanced past the step the
  // client answered, so nothing is applied and no extra turns are persisted.
  if (input.expectedStep && input.expectedStep !== step) {
    return {
      conversationId: conversation.id,
      status: conversation.status,
      messages: turns,
      prompt: promptFor(step, chatTenant, collected),
      requiresOwnerReview: conversation.requires_owner_review,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }
  // Pilot booking step. Handled on its own branch: the answer is an offer id the
  // server itself generated, so correction parsing and field validation do not
  // apply. No SMS, no provider call and no automation is triggered here.
  if (step === "booking" || step === "booking_confirm") {
    return await handleBookingSelection({
      step,
      tenant,
      chatTenant,
      conversation: {
        id: conversation.id,
        leadId: conversation.lead_id ?? null,
        requiresOwnerReview: conversation.requires_owner_review,
      },
      collected,
      answer: input.answer,
      turns,
    });
  }

  // Natural-language intake. A single free-text message may carry several
  // details ("ceramic coating for my Mazda in Punchbowl next Tuesday"). Each
  // value is matched only against this tenant's approved services and
  // locations, or parsed from the customer's own words, and stored through the
  // same validation the individual questions use. Whatever is still missing is
  // then asked for TOGETHER — never one rigid question at a time — and any
  // genuine ambiguity is put back to the customer instead of guessed.
  // Multi-field change directive ("change the vehicle to a Mazda CX-5 and the
  // suburb to Bankstown"). Each clause updates exactly one field with its own
  // value, so no value bleeds across fields and no field is silently dropped.
  // Ordering: understanding first. The directive parser only runs BEFORE intake
  // when the customer expressed EXPLICIT change intent ("change my suburb to
  // Parramatta"). A first-turn narrative that merely mentions a name or number
  // is information, so it must reach intake/AI extraction and never be claimed
  // — and partially discarded — by the directive parser.
  const explicitChange = hasExplicitChangeIntent(input.answer);

  const runDirectives = () =>
    maybeHandleFieldDirectives({
      tenant,
      chatTenant,
      conversationId: conversation.id,
      collected,
      step,
      answer: input.answer,
      turns,
    });

  if (explicitChange) {
    const directiveBranch = await runDirectives();
    if (directiveBranch) return directiveBranch;
  }

  const intakeBranch = await maybeHandleIntake({
    tenant,
    chatTenant,
    conversationId: conversation.id,
    requiresOwnerReview: conversation.requires_owner_review,
    collected,
    step,
    answer: input.answer,
    turns,
  });
  if (intakeBranch) return intakeBranch;

  if (!explicitChange) {
    const directiveBranch = await runDirectives();
    if (directiveBranch) return directiveBranch;
  }


  // Mid-conversation correction. Handled BEFORE the active question is
  // validated, so "actually put it as Abshiro for my name" is never run through
  // Australian mobile-number validation. The original customer message is kept
  // in the transcript; only the stored field value changes (latest wins).
  const correction = detectCorrection(collected, step, input.answer, chatTenant);
  if (correction.kind !== "none") {
    const directive = parseChangeDirective(input.answer);
    // The customer's own words stay in the transcript verbatim; only the
    // review-step button directive is shown as readable text.
    const echo = directive
      ? `Change my ${FIELD_LABELS[directive]}`
      : input.answer.slice(0, 500);
    await addMessage(tenant.businessId, conversation.id, "customer", echo);

    if (correction.kind === "clarify" || correction.kind === "invalid") {
      await addMessage(tenant.businessId, conversation.id, "assistant", correction.message);
      return {
        conversationId: conversation.id,
        status: "active",
        messages: [...turns, { role: "customer", body: echo }, { role: "assistant", body: correction.message }],
        prompt: promptFor(step, chatTenant, collected),
        requiresOwnerReview: conversation.requires_owner_review,
        completed: false,
        declined: false,
        duplicate: false,
        error: correction.message,
      };
    }

    const corrected = correction.collected;
    const correctedOutcome = resolveOutcome(corrected);
    await supabaseAdmin
      .from("web_conversations")
      .update({
        collected: corrected as never,
        selected_service_id: corrected.service_id ?? null,
        service_name_snapshot: corrected.service_name ?? null,
        requires_owner_review: correctedOutcome.requiresOwnerReview,
        unsupported_request: correctedOutcome.unsupportedRequest,
      })
      .eq("id", conversation.id)
      .eq("business_id", tenant.businessId);

    await addMessage(tenant.businessId, conversation.id, "assistant", correction.message);
    const resumeStep = nextStep(corrected);
    const resumePrompt = resumeStep ? promptFor(resumeStep, chatTenant, corrected) : null;
    if (resumePrompt) await addMessage(tenant.businessId, conversation.id, "assistant", resumePrompt.text);

    return {
      conversationId: conversation.id,
      status: "active",
      messages: [
        ...turns,
        { role: "customer", body: echo },
        { role: "assistant", body: correction.message },
        ...(resumePrompt ? [{ role: "assistant" as const, body: resumePrompt.text }] : []),
      ],
      prompt: resumePrompt,
      requiresOwnerReview: correctedOutcome.requiresOwnerReview,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }

  const applied = applyAnswer(collected, step, input.answer, chatTenant);
  if (!applied.ok) {
    const prompt = promptFor(step, chatTenant, collected);
    const errorText = hasCorrectionCue(input.answer) ? AMBIGUOUS_CORRECTION_MESSAGE : applied.error;
    await addMessage(tenant.businessId, conversation.id, "customer", input.answer.slice(0, 500));
    await addMessage(tenant.businessId, conversation.id, "assistant", errorText);
    return {
      conversationId: conversation.id,
      status: "active",
      messages: [
        ...turns,
        { role: "customer", body: input.answer.slice(0, 500) },
        { role: "assistant", body: errorText },
      ],
      prompt,
      requiresOwnerReview: false,
      completed: false,
      declined: false,
      duplicate: false,
      error: errorText,
    };
  }

  await addMessage(tenant.businessId, conversation.id, "customer", applied.echo);
  const next = applied.collected;
  const outcome = resolveOutcome(next);

  // Consent declined: nothing is passed to the business and no lead is created.
  if (next.consent === "declined") {
    await supabaseAdmin
      .from("web_conversations")
      .update({
        collected: { ...next, mobile_number: null, email: null } as never,
        consent_outcome: "declined",
        status: "declined",
        completed_at: new Date().toISOString(),
      })
      .eq("id", conversation.id)
      .eq("business_id", tenant.businessId);
    await addMessage(tenant.businessId, conversation.id, "assistant", DECLINED_MESSAGE);
    return {
      conversationId: conversation.id,
      status: "declined",
      messages: [...turns, { role: "customer", body: applied.echo }, { role: "assistant", body: DECLINED_MESSAGE }],
      prompt: null,
      requiresOwnerReview: false,
      completed: false,
      declined: true,
      duplicate: false,
    };
  }

  const followUp = nextStep(next);

  if (followUp) {
    await supabaseAdmin
      .from("web_conversations")
      .update({
        collected: next as never,
        selected_service_id: next.service_id ?? null,
        service_name_snapshot: next.service_name ?? null,
        requires_owner_review: outcome.requiresOwnerReview,
        unsupported_request: outcome.unsupportedRequest,
      })
      .eq("id", conversation.id)
      .eq("business_id", tenant.businessId);

    const prompt = promptFor(followUp, chatTenant, next);
    const detail =
      followUp === "vehicle" && next.service_name ? serviceAcknowledgement(chatTenant, next) : null;
    if (detail) await addMessage(tenant.businessId, conversation.id, "assistant", detail);
    await addMessage(tenant.businessId, conversation.id, "assistant", prompt.text);
    return {
      conversationId: conversation.id,
      status: "active",
      messages: [
        ...turns,
        { role: "customer", body: applied.echo },
        ...(detail ? [{ role: "assistant" as const, body: detail }] : []),
        { role: "assistant", body: prompt.text },
      ],
      prompt,
      requiresOwnerReview: outcome.requiresOwnerReview,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }

  // Everything collected and consent granted → create the lead (web channel, no SMS).
  const { captureLead } = await import("@/lib/lead-engine.server");
  const consentText = `I agree to ${tenant.name} contacting me about this enquiry, including by SMS. Reply STOP at any time to opt out.`;

  let leadId = conversation.lead_id ?? null;
  let duplicate = false;
  if (!leadId) {
    const result = await captureLead({
      businessId: tenant.businessId,
      channel: "web",
      name: next.name ?? "Web visitor",
      mobile_number: next.mobile_number ?? "",
      email: next.email ?? null,
      suburb: next.suburb ?? null,
      service_address: next.service_address ?? null,
      vehicle_type: next.vehicle_type ?? null,
      main_concerns: next.concerns ?? null,
      service_intent: next.service_name ?? next.typed_request ?? "AI quote conversation",
      source_channel: "website",
      source_form: `ai_chat:${tenant.slug}`,
      source_metadata: {
        ai_chat: {
          tenant_slug: tenant.slug,
          web_conversation_id: conversation.id,
          form_url: input.formUrl,
        },
      },
      request_type: next.service_id ? "service" : "recommendation",
      approved_service_id: next.service_id ?? null,
      service_name_snapshot: next.service_name ?? null,
      flexible_request_text: next.typed_request ?? null,
      requires_owner_review: outcome.requiresOwnerReview,
      lead_origin: "ai_web_chat",
      // Deterministic per conversation: a retried finalisation reuses the lead.
      external_id: `webchat:${conversation.id}`,
      consent: true,
      consent_text: consentText,
      consent_source_url: input.formUrl,
    });
    leadId = result.leadId;
    duplicate = result.duplicate;
  } else {
    // Returning contact (arrived via their personal campaign link): the new
    // enquiry's details are merged onto their OWN record — fill-only for
    // profile fields, refreshed for the current request. No duplicate lead.
    const { data: existing } = await supabaseAdmin
      .from("leads")
      .select(
        "name, email, suburb, service_address, vehicle_type, last_cleaned_at, main_concerns, service_intent, request_type, approved_service_id, service_name_snapshot, flexible_request_text, external_id",
      )
      .eq("id", leadId)
      .eq("business_id", tenant.businessId)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing) {
      const { mergeReturningLead } = await import("@/lib/returning-lead");
      const patch = mergeReturningLead(existing, {
        name: next.name ?? null,
        email: next.email ?? null,
        suburb: next.suburb ?? null,
        service_address: next.service_address ?? null,
        vehicle_type: next.vehicle_type ?? null,
        main_concerns: next.concerns ?? null,
        service_intent: next.service_name ?? next.typed_request ?? "AI quote conversation",
        request_type: next.service_id ? "service" : "recommendation",
        approved_service_id: next.service_id ?? null,
        service_name_snapshot: next.service_name ?? null,
        flexible_request_text: next.typed_request ?? null,
        source_channel: "website",
        source_form: `ai_chat:${tenant.slug}`,
        lead_origin: "ai_web_chat",
        requires_owner_review: outcome.requiresOwnerReview,
        source_metadata: {
          ai_chat: {
            tenant_slug: tenant.slug,
            web_conversation_id: conversation.id,
            form_url: input.formUrl,
            returning: true,
          },
        },
      });
      await supabaseAdmin
        .from("leads")
        .update(patch as never)
        .eq("id", leadId)
        .eq("business_id", tenant.businessId);
    }
  }

  // Full Detail pilot: the server computes real appointment options and the
  // conversation stays open on the booking step. Anything outside the pilot
  // falls through to the existing completion below, unchanged.
  if (leadId && !duplicate) {
    const { openBookingStep } = await import("@/lib/web-chat-booking.server");
    const booking = await openBookingStep({
      businessId: tenant.businessId,
      slug: tenant.slug,
      leadId,
    });
    if (booking.offered) {
      const withOffers: WebChatCollected = {
        ...next,
        pilot_offers: booking.offers,
        booking_offered: true,
      };
      await supabaseAdmin
        .from("web_conversations")
        .update({
          collected: withOffers as never,
          lead_id: leadId,
          selected_service_id: next.service_id ?? null,
          service_name_snapshot: next.service_name ?? null,
          requires_owner_review: outcome.requiresOwnerReview,
          unsupported_request: outcome.unsupportedRequest,
          consent_outcome: "granted",
        })
        .eq("id", conversation.id)
        .eq("business_id", tenant.businessId);

      const bookingPrompt = promptFor("booking", chatTenant, withOffers);
      await addMessage(tenant.businessId, conversation.id, "assistant", bookingPrompt.text);
      return {
        conversationId: conversation.id,
        status: "active",
        messages: [
          ...turns,
          { role: "customer", body: applied.echo },
          { role: "assistant", body: bookingPrompt.text },
        ],
        prompt: bookingPrompt,
        requiresOwnerReview: outcome.requiresOwnerReview,
        completed: false,
        declined: false,
        duplicate: false,
      };
    }
  }

  const closing = duplicate ? DUPLICATE_MESSAGE : completionMessage(chatTenant, outcome);

  await supabaseAdmin
    .from("web_conversations")
    .update({
      collected: next as never,
      lead_id: leadId,
      selected_service_id: next.service_id ?? null,
      service_name_snapshot: next.service_name ?? null,
      requires_owner_review: outcome.requiresOwnerReview,
      unsupported_request: outcome.unsupportedRequest,
      consent_outcome: "granted",
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", conversation.id)
    .eq("business_id", tenant.businessId);
  if (leadId) {
    const { applyCompletedQuoteClassification } = await import("@/lib/quote-classification.server");
    await applyCompletedQuoteClassification({
      businessId: tenant.businessId,
      conversationId: conversation.id,
      leadId,
    });
  }
  await addMessage(tenant.businessId, conversation.id, "assistant", closing);

  return {
    conversationId: conversation.id,
    status: "completed",
    messages: [...turns, { role: "customer", body: applied.echo }, { role: "assistant", body: closing }],
    prompt: null,
    requiresOwnerReview: outcome.requiresOwnerReview,
    completed: true,
    declined: false,
    duplicate,
  };
}

/**
 * Booking step handler.
 *
 * The customer's answer is one of the offer ids the server generated for THIS
 * conversation. Everything is re-checked server-side: tenant, lead, offer and
 * live availability. On a conflict the customer's message stays in the
 * transcript and fresh options are returned — the conversation never restarts.
 *
 * No SMS, no `messages` row, no provider call, no AI usage event and no
 * automation job is created anywhere on this path.
 */
async function handleBookingSelection(input: {
  step: "booking" | "booking_confirm";
  tenant: PublicTenant;
  chatTenant: WebChatTenant;
  conversation: { id: string; leadId: string | null; requiresOwnerReview: boolean };
  collected: WebChatCollected;
  answer: string;
  turns: WebChatTurn[];
}): Promise<WebChatState> {
  const { tenant, chatTenant, conversation, collected, turns } = input;
  const businessId = tenant.businessId;

  const applied = applyAnswer(collected, input.step, input.answer, chatTenant);
  if (!applied.ok) {
    const prompt = promptFor(input.step, chatTenant, collected);
    await addMessage(businessId, conversation.id, "assistant", applied.error);
    return {
      conversationId: conversation.id,
      status: "active",
      messages: [...turns, { role: "assistant", body: applied.error }],
      prompt,
      requiresOwnerReview: conversation.requiresOwnerReview,
      completed: false,
      declined: false,
      duplicate: false,
      error: applied.error,
    };
  }

  const echo = applied.echo;
  await addMessage(businessId, conversation.id, "customer", echo);
  const next = applied.collected;

  async function complete(body: string, stored: WebChatCollected): Promise<WebChatState> {
    await supabaseAdmin
      .from("web_conversations")
      .update({
        collected: stored as never,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", conversation.id)
      .eq("business_id", businessId);
    if (conversation.leadId) {
      const { applyCompletedQuoteClassification } = await import("@/lib/quote-classification.server");
      await applyCompletedQuoteClassification({
        businessId,
        conversationId: conversation.id,
        leadId: conversation.leadId,
      });
    }
    await addMessage(businessId, conversation.id, "assistant", body);
    return {
      conversationId: conversation.id,
      status: "completed",
      messages: [...turns, { role: "customer", body: echo }, { role: "assistant", body }],
      prompt: null,
      requiresOwnerReview: conversation.requiresOwnerReview,
      completed: true,
      declined: false,
      duplicate: false,
    };
  }

  // "None of these work": the lead stays captured, no job is created, no SMS.
  if (next.booking_declined === true) {
    return await complete(bookingDeclinedMessage(tenant.name), next);
  }

  /** Persists the draft state and stays in the conversation with a prompt. */
  async function stay(
    stored: WebChatCollected,
    message: string,
    promptStep: "booking" | "booking_confirm",
  ): Promise<WebChatState> {
    await supabaseAdmin
      .from("web_conversations")
      .update({ collected: stored as never })
      .eq("id", conversation.id)
      .eq("business_id", businessId);
    await addMessage(businessId, conversation.id, "assistant", message);
    return {
      conversationId: conversation.id,
      status: "active",
      messages: [...turns, { role: "customer", body: echo }, { role: "assistant", body: message }],
      prompt: promptFor(promptStep, chatTenant, stored),
      requiresOwnerReview: conversation.requiresOwnerReview,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }

  // Selecting a time is a HOLD, never a booking. The customer sees the full
  // summary and must confirm it back before anything is created.
  if (input.step === "booking") {
    const prompt = promptFor("booking_confirm", chatTenant, next);
    return await stay(next, prompt.text, "booking_confirm");
  }

  // "Pick a different time": the hold is released in the conversation and fresh
  // live options are recomputed. Still no booking, no SMS, no owner alert.
  if (next.booking_confirmed !== true) {
    if (!conversation.leadId) {
      return await complete(BOOKING_UNAVAILABLE_MESSAGE, { ...collected, booking_declined: true });
    }
    const { refreshBookingOffers } = await import("@/lib/web-chat-booking.server");
    const fresh = await refreshBookingOffers({ businessId, leadId: conversation.leadId });
    if (fresh.length === 0) {
      return await complete(BOOKING_UNAVAILABLE_MESSAGE, { ...collected, booking_declined: true });
    }
    const reopened: WebChatCollected = {
      ...next,
      pilot_offers: fresh,
      booking_offered: true,
      booking_selected: null,
      booking_confirmed: false,
      booking_declined: false,
    };
    return await stay(reopened, BOOKING_CHANGE_MESSAGE, "booking");
  }

  const offerId = collected.booking_selected ?? next.booking_selected!;
  if (!conversation.leadId) {
    return await complete(BOOKING_UNAVAILABLE_MESSAGE, { ...collected, booking_declined: true });
  }

  const { commitWebChatBooking, bookingConfirmationText, refreshBookingOffers } = await import(
    "@/lib/web-chat-booking.server"
  );
  const commit = await commitWebChatBooking({
    businessId,
    leadId: conversation.leadId,
    conversationId: conversation.id,
    offerId,
  });

  if (commit.ok) {
    // Booking-only mode: operational confirmation + owner alert, no sequence.
    const { finalizeBookingOnlyBooking } = await import("@/lib/booking-only.server");
    await finalizeBookingOnlyBooking({
      businessId,
      leadId: conversation.leadId,
      offerId: commit.offerId,
      slotStart: commit.slotStart,
      replay: commit.replay,
    });
    const body = await bookingConfirmationText({
      businessId,
      leadId: conversation.leadId,
      slotStart: commit.slotStart,
    });
    // The conversation is completed only after the booking commit succeeded.
    return await complete(body, next);
  }


  // Conflict / expiry: recompute options and stay on the booking step.
  const fresh = await refreshBookingOffers({ businessId, leadId: conversation.leadId });
  if (fresh.length === 0) {
    return await complete(BOOKING_UNAVAILABLE_MESSAGE, {
      ...collected,
      booking_declined: true,
    });
  }

  const retry: WebChatCollected = {
    ...collected,
    pilot_offers: fresh,
    booking_offered: true,
    booking_selected: null,
    booking_confirmed: false,
    booking_declined: false,
  };
  await supabaseAdmin
    .from("web_conversations")
    .update({ collected: retry as never })
    .eq("id", conversation.id)
    .eq("business_id", businessId);

  const prompt = promptFor("booking", chatTenant, retry);
  // An expired hold and a slot taken by someone else are different situations,
  // so the customer is told which one actually happened.
  const retryMessage =
    commit.reason === "offer_expired" ? BOOKING_EXPIRED_MESSAGE : BOOKING_CONFLICT_MESSAGE;
  await addMessage(businessId, conversation.id, "assistant", retryMessage);
  return {
    conversationId: conversation.id,
    status: "active",
    messages: [
      ...turns,
      { role: "customer", body: echo },
      { role: "assistant", body: retryMessage },
    ],
    prompt,
    requiresOwnerReview: conversation.requiresOwnerReview,
    completed: false,
    declined: false,
    duplicate: false,
  };
}

/**
 * Natural-language intake branch.
 *
 * Returns a state only when the customer's message genuinely carried more than
 * the single open question — otherwise it returns null and the existing
 * step-by-step handling proceeds unchanged.
 */
export async function maybeHandleIntake(args: {
  tenant: PublicTenant;
  chatTenant: WebChatTenant;
  conversationId: string;
  requiresOwnerReview: boolean;
  collected: WebChatCollected;
  step: string;
  answer: string;
  turns: WebChatTurn[];
  /** Injected in tests. Production uses the single Lovable AI extraction call. */
  extractor?: AiExtractor;
}): Promise<WebChatState | null> {
  const { tenant, chatTenant, collected, step, turns } = args;
  const raw = args.answer.trim();
  const collectionSteps = ["service", "vehicle", "suburb", "address", "concerns", "name", "mobile"];
  if (!collectionSteps.includes(step)) return null;
  if (raw.length < 3) return null;
  if (parseChangeDirective(raw)) return null;
  // Button/option answers are handled by the normal path.
  if (tenant.services.some((service) => service.id === raw) || raw === FLEXIBLE_CHOICE) return null;

  const intakeTenant = {
    timezone: "Australia/Sydney",
    services: tenant.services.map((service) => ({ id: service.id, name: service.name })),
    locations: parseApprovedLocations(tenant.serviceArea),
  };

  // Understanding: one structured AI extraction call per customer message,
  // folded over the deterministic regex pass, then every candidate validated and
  // merged by the deterministic layer. Control never moves to the model.
  const resolved = await resolveIntake({
    raw,
    collected,
    chatTenant,
    intakeTenant,
    step,
    turns,
    businessName: tenant.name,
    extract: args.extractor ?? ((context) => extractWithAi(tenant.businessId, context)),
  });

  const {
    extraction,
    collected: next,
    applied,
    corrections,
    beyondOpenStep,
    question,
    uncertain,
    unsupported,
  } = resolved;
  // Model-written wording for this turn, already stripped of any price, time,
  // availability or booking claim. Null falls back to the fixed sentences.
  const modelReply = resolved.reply;
  const ambiguity = extraction.ambiguities[0] ?? null;
  // Per-tenant flag: only an enabled tenant answers questions and handles
  // uncertainty. Everyone else keeps the previous step-machine behaviour.
  const conversational = isConversationalIntakeTenant(tenant.businessId);
  const answeringTurn = conversational && (question !== null || uncertain);
  // A single validated field is now enough — the old "fewer than two fields"
  // rule discarded understanding the model had already produced.
  if (!ambiguity && !unsupported && !answeringTurn && applied.length === 0 && !beyondOpenStep) {
    return null;
  }

  const echo = raw.slice(0, 500);
  await addMessage(tenant.businessId, args.conversationId, "customer", echo);

  if (unsupported && applied.length === 0) {
    await addMessage(tenant.businessId, args.conversationId, "assistant", UNSUPPORTED_REQUEST_MESSAGE);
    return {
      conversationId: args.conversationId,
      status: "active",
      messages: [
        ...turns,
        { role: "customer", body: echo },
        { role: "assistant", body: UNSUPPORTED_REQUEST_MESSAGE },
      ],
      prompt: promptFor(step as never, chatTenant, collected),
      requiresOwnerReview: args.requiresOwnerReview,
      completed: false,
      declined: false,
      duplicate: false,
    };
  }

  const outcome = resolveOutcome(next);
  await supabaseAdmin
    .from("web_conversations")
    .update({
      collected: next as never,
      selected_service_id: next.service_id ?? null,
      service_name_snapshot: next.service_name ?? null,
      requires_owner_review: outcome.requiresOwnerReview,
      unsupported_request: outcome.unsupportedRequest,
    })
    .eq("id", args.conversationId)
    .eq("business_id", tenant.businessId);

  const outstanding = outstandingFields(next);

  // Every answer is composed from facts this tenant already configured.
  const facts: AnswerFacts = {
    businessName: tenant.name,
    services: chatTenant.services.map((service) => ({
      name: service.name,
      description: service.description,
    })),
    locations: intakeTenant.locations,
    outstanding,
    bookingEnabled: chatTenant.bookingEnabled === true,
    suburb: next.suburb ?? null,
  };

  let answer: string | null = null;
  if (conversational) {
    if (question) answer = answerQuestion(question, facts);
    if (!answer && uncertain && outstanding.includes("service")) {
      answer = uncertainServiceMessage(facts);
    }
    // A question with no supporting tenant fact is deflected honestly.
    if (!answer && question) answer = unsupportedAnswer(facts);
  }

  // Acknowledge only values that were validated and stored this turn.
  const acknowledgement =
    conversational && corrections.length === 0
      ? acknowledgeFields(
          applied.map((field) => ({
            label: field,
            value:
              field === "vehicle"
                ? next.vehicle_type ?? ""
                : field === "location"
                  ? next.suburb ?? ""
                  : field === "address"
                    ? next.service_address ?? ""
                  : field === "name"
                    ? next.name ?? ""
                    : field === "mobile"
                      ? next.mobile_number ?? ""
                      : "",
          })),
        )
      : null;

  const resumeStep = nextStep(next);
  const prompt = resumeStep ? promptFor(resumeStep, chatTenant, next) : null;

  let ask: string | null = null;
  if (ambiguity) ask = ambiguityMessage(ambiguity);
  else if (outstanding.includes("service") && extraction.unmatched.service && !answer)
    ask = unmatchedServiceMessage(tenant.name);
  else {
    const grouped = groupedMissingMessage(outstanding);
    if (grouped) ask = acknowledgement || answer ? grouped.replace(/^Got it\.\s*/, "") : grouped;
    else if (prompt) ask = prompt.text;
  }

  // The model's wording replaces the fixed acknowledgement/answer sentences when
  // it survived guarding; when it already asks something, the server's own ask
  // is dropped so the customer reads one question, not two. An ambiguity ask is
  // never dropped: that one is a control decision, not phrasing.
  const replies = modelReply
    ? assembleReply({
        acknowledgement: modelReply,
        answer: null,
        ask: ambiguity || !replyAsksSomething(modelReply) ? ask : null,
      })
    : assembleReply({
        acknowledgement: corrections.length > 0 ? aiCorrectionMessage(corrections) : acknowledgement,
        answer,
        ask,
      });

  for (const reply of replies) await addMessage(tenant.businessId, args.conversationId, "assistant", reply);

  return {
    conversationId: args.conversationId,
    status: "active",
    messages: [
      ...turns,
      { role: "customer", body: echo },
      ...replies.map((body) => ({ role: "assistant" as const, body })),
    ],
    prompt: prompt ?? null,
    requiresOwnerReview: outcome.requiresOwnerReview,
    completed: false,
    declined: false,
    duplicate: false,
  };
}


/**
 * Applies a change directive that names two or more fields. Returns null when
 * fewer than two fields were updated, leaving single-field corrections to the
 * existing correction path.
 */
async function maybeHandleFieldDirectives(args: {
  tenant: PublicTenant;
  chatTenant: WebChatTenant;
  conversationId: string;
  collected: WebChatCollected;
  step: string;
  answer: string;
  turns: WebChatTurn[];
}): Promise<WebChatState | null> {
  const { tenant, chatTenant, collected, turns } = args;
  const raw = args.answer.trim();
  if (raw.length < 6 || parseChangeDirective(raw)) return null;

  const { collected: next, updates } = applyFieldDirectives(raw, collected, chatTenant);
  if (updates.length < 2) return null;

  const echo = raw.slice(0, 500);
  await addMessage(tenant.businessId, args.conversationId, "customer", echo);

  const outcome = resolveOutcome(next);
  await supabaseAdmin
    .from("web_conversations")
    .update({
      collected: next as never,
      selected_service_id: next.service_id ?? null,
      service_name_snapshot: next.service_name ?? null,
      requires_owner_review: outcome.requiresOwnerReview,
      unsupported_request: outcome.unsupportedRequest,
    })
    .eq("id", args.conversationId)
    .eq("business_id", tenant.businessId);

  const replies = [fieldUpdateMessage(updates)];
  const resumeStep = nextStep(next);
  const grouped = groupedMissingMessage(outstandingFields(next));
  const prompt = resumeStep ? promptFor(resumeStep, chatTenant, next) : null;
  if (grouped) replies.push(grouped);
  else if (prompt) replies.push(prompt.text);

  for (const reply of replies) await addMessage(tenant.businessId, args.conversationId, "assistant", reply);

  return {
    conversationId: args.conversationId,
    status: "active",
    messages: [
      ...turns,
      { role: "customer", body: echo },
      ...replies.map((body) => ({ role: "assistant" as const, body })),
    ],
    prompt: prompt ?? null,
    requiresOwnerReview: outcome.requiresOwnerReview,
    completed: false,
    declined: false,
    duplicate: false,
  };
}

/**
 * Handles a customer message that arrives after the booking was confirmed.
 *
 * Detail updates are written to the conversation and to the canonical lead
 * fields; the confirmed offer and job rows are never touched. Anything that
 * affects what the crew turns up to — or any reschedule/cancel wording — flags
 * the lead for owner review and raises one de-duplicated owner alert.
 */
async function handleBookingChangeRequest(args: {
  tenant: PublicTenant;
  chatTenant: WebChatTenant;
  conversationId: string;
  leadId: string;
  collected: WebChatCollected;
  answer: string;
  turns: WebChatTurn[];
  requiresOwnerReview: boolean;
}): Promise<WebChatState | null> {
  const { evaluateBookingChangeRequest } = await import("@/lib/booking-change-request");
  const outcome = evaluateBookingChangeRequest({
    collected: args.collected,
    raw: args.answer,
    tenant: args.chatTenant,
    tenantName: args.tenant.name,
  });

  const echo = args.answer.trim().slice(0, 500);
  if (echo.length === 0) return null;

  await addMessage(args.tenant.businessId, args.conversationId, "customer", echo);

  if (outcome.updates.length > 0) {
    const next = outcome.collected;
    await supabaseAdmin
      .from("web_conversations")
      .update({
        collected: next as never,
        ...(outcome.requiresOwnerReview ? { requires_owner_review: true } : {}),
      })
      .eq("id", args.conversationId)
      .eq("business_id", args.tenant.businessId);

    // Canonical lead detail fields only — booking rows stay authoritative.
    await supabaseAdmin
      .from("leads")
      .update({
        ...(next.suburb ? { suburb: next.suburb } : {}),
        ...(next.service_address ? { service_address: next.service_address } : {}),
        ...(next.vehicle_type ? { vehicle_type: next.vehicle_type } : {}),
        ...(next.concerns ? { main_concerns: next.concerns } : {}),
        ...(next.name ? { name: next.name } : {}),
        ...(next.email ? { email: next.email } : {}),
        ...(outcome.requiresOwnerReview ? { requires_owner_review: true } : {}),
      })
      .eq("id", args.leadId)
      .eq("business_id", args.tenant.businessId);
  } else if (outcome.requiresOwnerReview) {
    await supabaseAdmin
      .from("web_conversations")
      .update({ requires_owner_review: true })
      .eq("id", args.conversationId)
      .eq("business_id", args.tenant.businessId);
    await supabaseAdmin
      .from("leads")
      .update({ requires_owner_review: true })
      .eq("id", args.leadId)
      .eq("business_id", args.tenant.businessId);
  }

  if (outcome.requiresOwnerReview) {
    const { createNotification } = await import("@/lib/jobs.server");
    await createNotification({
      businessId: args.tenant.businessId,
      leadId: args.leadId,
      kind: "booking_change_request",
      title: "Change requested after booking",
      body: echo,
      metadata: {
        conversation_id: args.conversationId,
        kind: outcome.kind,
        updates: outcome.updates,
      },
      idempotencyKey: `booking_change_request:${args.conversationId}:${echo.slice(0, 120)}`,
    });
  }

  await addMessage(args.tenant.businessId, args.conversationId, "assistant", outcome.message);

  return {
    conversationId: args.conversationId,
    status: "completed",
    messages: [
      ...args.turns,
      { role: "customer", body: echo },
      { role: "assistant", body: outcome.message },
    ],
    prompt: null,
    requiresOwnerReview: args.requiresOwnerReview || outcome.requiresOwnerReview,
    completed: true,
    declined: false,
    duplicate: false,
  };
}
