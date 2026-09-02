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
  DUPLICATE_MESSAGE,
  applyAnswer,
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
  detectCorrection,
  hasCorrectionCue,
} from "@/lib/web-chat-correction";

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
};

function toChatTenant(tenant: PublicTenant): WebChatTenant {
  return {
    name: tenant.name,
    flexibleRequestsEnabled: tenant.flexibleRequestsEnabled,
    services: tenant.services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      included_items: service.included_items,
      excluded_items: service.excluded_items,
      qualification_note: service.qualification_note,
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
    body: body.slice(0, 2000),
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

/** Starts a conversation for an AI-mode tenant. Returns null for unknown/manual tenants. */
export async function startWebChat(slug: string): Promise<WebChatState | null> {
  const tenant = await resolvePublicTenant(slug);
  if (!tenant || tenant.quoteMode !== "ai_chat") return null;

  const chatTenant = toChatTenant(tenant);
  const { data: conversation, error } = await supabaseAdmin
    .from("web_conversations")
    .insert({ business_id: tenant.businessId, status: "active", collected: {} as never })
    .select("id")
    .single();
  if (error || !conversation) throw new Error("Could not start the conversation.");

  const greeting = welcomeMessage(chatTenant);
  const first = promptFor("service", chatTenant, {});
  await addMessage(tenant.businessId, conversation.id, "assistant", greeting);
  await addMessage(tenant.businessId, conversation.id, "assistant", first.text);

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

  // Mid-conversation correction. Handled BEFORE the active question is
  // validated, so "actually put it as Abshiro for my name" is never run through
  // Australian mobile-number validation. The original customer message is kept
  // in the transcript; only the stored field value changes (latest wins).
  const correction = detectCorrection(collected, step, input.answer, chatTenant);
  if (correction.kind !== "none") {
    const echo = input.answer.slice(0, 500);
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
      followUp === "vehicle" && next.service_name
        ? `Great — ${next.service_name}. I'll pass the details to the team for review; nothing is priced or booked here.`
        : null;
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
