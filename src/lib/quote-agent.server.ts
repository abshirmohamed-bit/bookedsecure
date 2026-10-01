/**
 * One agent turn on the public quote page.
 *
 * Same brain as the owner assistant (`agent-core`), a different tool set. The
 * tenant comes from the URL slug, the conversation from the database, and every
 * record change happens inside a tool. Anything the model writes is guarded
 * before the customer can read it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assistantTimeZone, nowInZone } from "@/lib/assistant-time";
import { runAgentTurn } from "@/lib/agent-core.server";
import { resolvePublicTenant, type PublicTenant } from "@/lib/quote-form.server";
import { isBookingOnlyTenant } from "@/lib/booking-only-mode";
import { buildQuoteAgentTools } from "@/lib/quote-agent-tools.server";
import { agentPrompt, buildQuoteAgentSystem, guardAgentReply } from "@/lib/quote-agent";
import { sanitiseCustomerText } from "@/lib/customer-text";
import type { PilotOffer } from "@/lib/web-chat-booking";
import type { WebChatCollected, WebChatPrompt, WebChatTenant } from "@/lib/web-chat";
import type { ModelMessage } from "ai";

const MAX_HISTORY_TURNS = 16;

export type AgentTurnState = {
  conversationId: string;
  status: string;
  messages: Array<{ role: "customer" | "assistant" | "system"; body: string }>;
  prompt: WebChatPrompt | null;
  requiresOwnerReview: boolean;
  completed: boolean;
  declined: boolean;
  duplicate: boolean;
};

const HELP_MESSAGE =
  "Thanks for that. I could not finish that just now, so the team will pick this up and come back to you shortly.";

/** Shown when the AI service itself is unavailable (billing/credits), not a bad turn. */
const AI_UNAVAILABLE_MESSAGE =
  "Thanks for that. Our assistant is taking a short break right now. Please try again in a little while, and the team has been notified in the meantime.";

function isBillingFailure(error: unknown): boolean {
  // The gateway's 402 surfaces inside the stream, so the awaited text throws
  // AI_NoOutputGeneratedError with the real AI_APICallError as its cause.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const text = String((current as { message?: string })?.message ?? current);
    if (/\b402\b|payment required|insufficient|credits/i.test(text)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function addTurn(
  businessId: string,
  conversationId: string,
  role: "customer" | "assistant",
  body: string,
): Promise<void> {
  await supabaseAdmin.from("web_conversation_messages").insert({
    business_id: businessId,
    conversation_id: conversationId,
    role,
    body: sanitiseCustomerText(body).slice(0, 2000),
  });
}

function toAgentTenant(tenant: PublicTenant): WebChatTenant {
  return {
    name: tenant.name,
    flexibleRequestsEnabled: tenant.flexibleRequestsEnabled,
    bookingEnabled: isBookingOnlyTenant(tenant.businessId),
    quoteSubjectLabel: tenant.quoteSubjectLabel,
    addons: tenant.addons ?? [],
    services: tenant.services.map((service) => ({
      id: service.id,
      name: service.name,
      category: service.category,
      duration_minutes: service.duration_minutes,
      description: service.description,
      included_items: service.included_items,
      excluded_items: service.excluded_items,
      qualification_note: service.qualification_note,
      price_guidance: service.price_guidance,
      campaign_eligible: service.campaign_eligible,
      image_url: service.image_url ?? null,
    })),
  };
}

function offerOptions(offers: PilotOffer[]): WebChatPrompt["options"] {
  return offers.map((offer) => ({ value: offer.label, label: offer.label, detail: null }));
}

/**
 * Runs the agent for one customer message. Returns null when the agent cannot
 * run at all, so the caller can fall back to the deterministic quote flow.
 */
export async function runQuoteAgentTurn(input: {
  slug: string;
  conversationId: string;
  answer: string;
  formUrl: string | null;
}): Promise<AgentTurnState | null> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;

  const tenant = await resolvePublicTenant(input.slug);
  if (!tenant || tenant.quoteMode !== "ai_chat") return null;

  const { data: conversation } = await supabaseAdmin
    .from("web_conversations")
    .select("id, status, collected, lead_id, requires_owner_review")
    .eq("id", input.conversationId)
    // Tenant scoping: a conversation from another business can never be driven.
    .eq("business_id", tenant.businessId)
    .maybeSingle();
  if (!conversation || conversation.status === "declined") return null;

  const { data: history } = await supabaseAdmin
    .from("web_conversation_messages")
    .select("role, body")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(80);
  const turns = (history ?? []).map((row) => ({
    role: row.role as "customer" | "assistant" | "system",
    body: row.body as string,
  }));

  const chatTenant = toAgentTenant(tenant);
  const collected = { ...((conversation.collected ?? {}) as WebChatCollected) };
  const { data: businessRow } = await supabaseAdmin
    .from("businesses")
    .select("timezone")
    .eq("id", tenant.businessId)
    .maybeSingle();
  const timeZone = assistantTimeZone(businessRow?.timezone ?? null);
  const local = nowInZone(timeZone);

  let leadId = (conversation.lead_id as string | null) ?? null;
  let booked: { slotStart: string; confirmation: string } | null = null;
  let handoff: string | null = null;
  let offers: PilotOffer[] = [];
  const executed: string[] = [];

  const save = async (patch: Record<string, unknown>) => {
    await supabaseAdmin
      .from("web_conversations")
      .update({ collected: collected as never, ...patch } as never)
      .eq("id", conversation.id)
      .eq("business_id", tenant.businessId);
  };

  const ctx = {
    businessId: tenant.businessId,
    slug: tenant.slug,
    tenantName: tenant.name,
    conversationId: conversation.id,
    formUrl: input.formUrl,
    tenant: chatTenant,
    collected,
    get leadId() {
      return leadId;
    },
    set leadId(value: string | null) {
      leadId = value;
    },
    record: (summary: string) => executed.push(summary),
    onBooked: (slotStart: string, confirmation: string) => {
      booked = { slotStart, confirmation };
    },
    onHandoff: (reason: string) => {
      handoff = reason;
    },
    onOffers: (list: PilotOffer[]) => {
      offers = list;
    },
    save,
  };

  const messages: ModelMessage[] = [
    ...turns
      .filter((turn) => turn.role !== "system")
      .slice(-MAX_HISTORY_TURNS)
      .map(
        (turn) =>
          ({
            role: turn.role === "customer" ? "user" : "assistant",
            content: turn.body,
          }) as ModelMessage,
      ),
    { role: "user", content: input.answer.slice(0, 500) },
  ];

  const system = buildQuoteAgentSystem({
    tenant: chatTenant,
    tenantSlug: tenant.slug,
    timeZone,
    localDate: local.date,
    localTime: local.time,
    localWeekday: local.weekday,
    bookingEnabled: chatTenant.bookingEnabled === true,
    knownFacts: {
      name: collected.name,
      mobile: collected.mobile_number,
      email: collected.email,
      suburb: collected.suburb,
      address: collected.service_address,
      service: collected.service_name,
      "their own words": collected.typed_request,
      details: collected.concerns,
    },
    leadSaved: Boolean(leadId),
  });

  await addTurn(tenant.businessId, conversation.id, "customer", input.answer.slice(0, 500));

  let answer = "";
  let aiUnavailable = false;
  try {
    answer = await runAgentTurn({
      apiKey,
      system,
      messages,
      tools: buildQuoteAgentTools(ctx),
      effort: "low",
      maxSteps: 12,
    });
  } catch (error) {
    aiUnavailable = isBillingFailure(error);
    console.error("[quote-agent] turn failed", error);
  }

  const bookedNow = booked as { slotStart: string; confirmation: string } | null;
  const guarded = guardAgentReply(answer, { bookingConfirmed: Boolean(bookedNow) });
  // A confirmed booking is always closed with the server-composed confirmation,
  // never with model wording alone.
  const body = bookedNow
    ? [guarded.reply, bookedNow.confirmation].filter((part) => part.length > 0).join(" ")
      : guarded.reply.length > 0
        ? guarded.reply
        : aiUnavailable
          ? AI_UNAVAILABLE_MESSAGE
          : HELP_MESSAGE;

  const requiresOwnerReview =
    Boolean(conversation.requires_owner_review) || handoff !== null || aiUnavailable;
  const completed = Boolean(bookedNow);

  await save({
    lead_id: leadId,
    requires_owner_review: requiresOwnerReview,
    ...(completed ? { status: "completed", completed_at: new Date().toISOString() } : {}),
  });
  await addTurn(tenant.businessId, conversation.id, "assistant", body);

  if (completed && leadId) {
    const { applyCompletedQuoteClassification } = await import("@/lib/quote-classification.server");
    await applyCompletedQuoteClassification({
      businessId: tenant.businessId,
      conversationId: conversation.id,
      leadId,
    }).catch(() => undefined);
  }

  if (executed.length > 0) {
    await supabaseAdmin
      .from("audit_events")
      .insert({
        business_id: tenant.businessId,
        event_type: "quote_agent_turn",
        entity_type: "web_conversation",
        entity_id: conversation.id,
        metadata: { executed, lead_id: leadId, handoff } as never,
      })
      .then(() => undefined, () => undefined);
  }

  return {
    conversationId: conversation.id,
    status: completed ? "completed" : "active",
    messages: [...turns, { role: "customer", body: input.answer.slice(0, 500) }, { role: "assistant", body }],
    prompt: completed ? null : agentPrompt(body, offers.length > 0 ? offerOptions(offers) : undefined),
    requiresOwnerReview,
    completed,
    declined: false,
    duplicate: false,
  };
}
