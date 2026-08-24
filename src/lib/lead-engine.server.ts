// Core lead + SMS engine. Server-only: always reached through server functions
// or server routes, never imported by client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  AUTOMATION_BLOCKED_STATUSES,
  firstName,
  isOptOutMessage,
  normaliseAuMobile,
  renderTemplate,
  type LeadStatus,
} from "@/lib/domain";
import { getProvider } from "@/lib/sms/provider.server";

type Business = {
  id: string;
  name: string;
  phone_number: string | null;
  default_sms_provider: string;
  automation_enabled: boolean;
  quiet_hours_start: number;
  quiet_hours_end: number;
  sms_signature: string | null;
  timezone: string;
};

export const GLOCAST_BUSINESS_ID = "11111111-1111-1111-1111-111111111111";

export async function getDefaultBusinessId(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.id ?? GLOCAST_BUSINESS_ID;
}

async function getBusiness(businessId: string): Promise<Business> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, phone_number, default_sms_provider, automation_enabled, quiet_hours_start, quiet_hours_end, sms_signature, timezone",
    )
    .eq("id", businessId)
    .single();
  if (error || !data) throw new Error(`Business not found: ${businessId}`);
  return data as Business;
}

async function audit(input: {
  businessId: string;
  userId?: string | null | undefined;
  eventType: string;
  entityType?: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId ?? null,
    event_type: input.eventType,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: (input.metadata ?? null) as never,
  });
}

function isWithinQuietHours(business: Business, at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-AU", {
      timeZone: business.timezone,
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
  const { quiet_hours_start: start, quiet_hours_end: end } = business;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type CaptureInput = {
  businessId?: string | undefined;
  name: string;
  mobile_number: string;
  email?: string | null | undefined;
  suburb?: string | null | undefined;
  vehicle_type?: string | null | undefined;
  last_cleaned_at?: string | null | undefined;
  main_concerns?: string | null | undefined;
  service_intent?: string | null | undefined;
  source_channel?: string | undefined;
  source_campaign?: string | null | undefined;
  source_form?: string | null | undefined;
  utm_source?: string | null | undefined;
  utm_campaign?: string | null | undefined;
  consent?: boolean | undefined;
  consent_text?: string | null | undefined;
};

export type CaptureResult = {
  leadId: string;
  duplicate: boolean;
  acknowledgementSent: boolean;
  note?: string;
};

/** Creates (or reuses) a lead, opens its conversation and sends the acknowledgement. */
export async function captureLead(input: CaptureInput): Promise<CaptureResult> {
  const businessId = input.businessId ?? (await getDefaultBusinessId());
  const mobile = normaliseAuMobile(input.mobile_number);
  const business = await getBusiness(businessId);

  const status: LeadStatus = mobile ? "new" : "invalid";

  // De-duplicate repeated submissions / retried webhooks from the same number.
  if (mobile) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: existing } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("mobile_number", mobile)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      return { leadId: existing.id, duplicate: true, acknowledgementSent: false };
    }
  }

  const { data: lead, error } = await supabaseAdmin
    .from("leads")
    .insert({
      business_id: businessId,
      name: input.name,
      mobile_number: mobile ?? input.mobile_number,
      email: input.email ?? null,
      suburb: input.suburb ?? null,
      vehicle_type: input.vehicle_type ?? null,
      last_cleaned_at: input.last_cleaned_at ?? null,
      main_concerns: input.main_concerns ?? null,
      service_intent: input.service_intent ?? null,
      source_channel: input.source_channel ?? "unknown",
      source_campaign: input.source_campaign ?? null,
      source_form: input.source_form ?? null,
      utm_source: input.utm_source ?? null,
      utm_campaign: input.utm_campaign ?? null,
      status,
      readiness_classification: "new",
      consent_record: input.consent
        ? {
            consented: true,
            at: new Date().toISOString(),
            text: input.consent_text ?? "Consent given on quote form",
          }
        : null,
    })
    .select("id")
    .single();

  if (error || !lead) throw new Error(error?.message ?? "Could not create lead");

  await supabaseAdmin.from("conversations").insert({
    business_id: businessId,
    lead_id: lead.id,
    status: "open",
  });

  await audit({
    businessId,
    eventType: "lead_created",
    entityType: "lead",
    entityId: lead.id,
    metadata: { source_channel: input.source_channel ?? "unknown" },
  });

  if (!mobile) {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "Mobile number was not a valid Australian mobile — lead marked invalid, no SMS sent.",
    };
  }

  const { data: rule } = await supabaseAdmin
    .from("automation_rules")
    .select("message_template")
    .eq("business_id", businessId)
    .eq("rule_type", "acknowledgement")
    .eq("active", true)
    .order("step", { ascending: true })
    .limit(1)
    .maybeSingle();

  const template =
    rule?.message_template ??
    "Hi {{first_name}}, thanks for contacting {{business_name}}. We've received your detailing enquiry. Reply with your vehicle type and main concern so we can help. Reply STOP to opt out.";

  const sent = await sendSms({
    businessId,
    leadId: lead.id,
    body: renderTemplate(template, {
      first_name: firstName(input.name),
      business_name: business.name,
    }),
    kind: "acknowledgement",
    idempotencyKey: `${lead.id}:acknowledgement`,
    respectAutomation: true,
  });

  return {
    leadId: lead.id,
    duplicate: false,
    acknowledgementSent: sent.sent,
    ...(sent.reason ? { note: sent.reason } : {}),
  };
}

export type SendSmsResult = { sent: boolean; reason?: string; messageId?: string };

/** Single outbound path for every SMS: enforces opt-out, status and idempotency rules. */
export async function sendSms(input: {
  businessId: string;
  leadId: string;
  body: string;
  kind: "acknowledgement" | "follow_up" | "manual" | "approved_reply";
  idempotencyKey?: string | undefined;
  respectAutomation: boolean;
  userId?: string | null | undefined;
}): Promise<SendSmsResult> {
  const business = await getBusiness(input.businessId);
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, name, mobile_number, status, opted_out_at, business_id, first_contacted_at")
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!lead) return { sent: false, reason: "Lead not found for this business." };
  if (lead.opted_out_at) return { sent: false, reason: "Lead has opted out — no SMS sent." };
  if (lead.status === "invalid") return { sent: false, reason: "Lead number is invalid." };

  if (input.respectAutomation) {
    if (!business.automation_enabled)
      return { sent: false, reason: "Automation is switched off for this business." };
    if (AUTOMATION_BLOCKED_STATUSES.includes(lead.status as LeadStatus))
      return { sent: false, reason: `Automated SMS blocked for status "${lead.status}".` };
  }

  if (input.idempotencyKey) {
    const { data: dupe } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (dupe) return { sent: false, reason: "Already sent (duplicate suppressed).", messageId: dupe.id };
  }

  const provider = getProvider(business.default_sms_provider);
  let result;
  try {
    result = await provider.sendMessage({
      to: lead.mobile_number,
      from: business.phone_number,
      body: input.body,
    });
  } catch (error) {
    const detail = provider.formatProviderError(error);
    await supabaseAdmin.from("messages").insert({
      business_id: input.businessId,
      lead_id: lead.id,
      conversation_id: await conversationIdFor(lead.id),
      direction: "outbound",
      body: input.body,
      provider: provider.name,
      delivery_status: "failed",
      error_code: detail.slice(0, 200),
      message_kind: input.kind,
      idempotency_key: input.idempotencyKey ?? null,
    });
    return { sent: false, reason: detail };
  }

  const conversationId = await conversationIdFor(lead.id);
  const { data: message } = await supabaseAdmin
    .from("messages")
    .insert({
      business_id: input.businessId,
      lead_id: lead.id,
      conversation_id: conversationId,
      direction: "outbound",
      body: input.body,
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      delivery_status: result.deliveryStatus,
      error_code: result.errorCode ?? null,
      message_kind: input.kind,
      idempotency_key: input.idempotencyKey ?? null,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const leadUpdate: Record<string, unknown> = {};
  if (!lead.first_contacted_at) leadUpdate["first_contacted_at"] = new Date().toISOString();
  if (["new"].includes(lead.status)) leadUpdate["status"] = "contacted";
  else if (lead.status === "customer_replied" && input.kind !== "follow_up")
    leadUpdate["status"] = "waiting_for_customer";
  if (Object.keys(leadUpdate).length > 0) {
    await supabaseAdmin.from("leads").update(leadUpdate as never).eq("id", lead.id);
  }

  await scheduleNextFollowUp({ businessId: input.businessId, leadId: lead.id, business });

  await audit({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: `sms_sent_${input.kind}`,
    entityType: "lead",
    entityId: lead.id,
  });

  return { sent: true, ...(message?.id ? { messageId: message.id } : {}) };
}

async function conversationIdFor(leadId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();
  return data?.id ?? null;
}

/** Advances the follow-up schedule after an outbound message. */
async function scheduleNextFollowUp(input: {
  businessId: string;
  leadId: string;
  business: Business;
}) {
  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("id, follow_up_step, automation_paused")
    .eq("lead_id", input.leadId)
    .maybeSingle();
  if (!conversation) return;

  const nextStep = conversation.follow_up_step + 1;
  const { data: rule } = await supabaseAdmin
    .from("automation_rules")
    .select("delay_minutes")
    .eq("business_id", input.businessId)
    .eq("rule_type", "follow_up")
    .eq("active", true)
    .eq("step", nextStep)
    .maybeSingle();

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      next_follow_up_at: rule
        ? new Date(Date.now() + rule.delay_minutes * 60 * 1000).toISOString()
        : null,
    })
    .eq("id", conversation.id);
}

/** Inbound SMS: stores the reply, handles opt-out and stops automation. */
export async function handleInboundMessage(input: {
  providerName: string;
  payload: Record<string, unknown>;
}): Promise<{ handled: boolean; reason?: string; leadId?: string }> {
  const provider = getProvider(input.providerName);
  const inbound = provider.handleInboundMessage(input.payload);
  if (!inbound) return { handled: false, reason: "Payload missing sender or body." };

  const mobile = normaliseAuMobile(inbound.from) ?? inbound.from;
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, business_id, status")
    .eq("mobile_number", mobile)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) return { handled: false, reason: `No lead matches ${mobile}.` };

  const conversationId = await conversationIdFor(lead.id);
  await supabaseAdmin.from("messages").insert({
    business_id: lead.business_id,
    lead_id: lead.id,
    conversation_id: conversationId,
    direction: "inbound",
    body: inbound.body,
    provider: provider.name,
    provider_message_id: inbound.providerMessageId,
    delivery_status: "delivered",
    message_kind: "customer_reply",
    idempotency_key: `in:${inbound.providerMessageId}`,
    received_at: inbound.receivedAt,
  });

  const optOut = isOptOutMessage(inbound.body);

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: inbound.receivedAt,
      next_follow_up_at: null,
      status: optOut ? "closed" : "needs_attention",
    })
    .eq("lead_id", lead.id);

  const update: Record<string, unknown> = { first_reply_at: inbound.receivedAt };
  if (optOut) {
    update["status"] = "opted_out";
    update["opted_out_at"] = inbound.receivedAt;
    update["consent_record"] = {
      opted_out: true,
      at: inbound.receivedAt,
      source_message: inbound.body,
    };
  } else if (!["completed", "scheduled", "quote_sent"].includes(lead.status)) {
    update["status"] = "customer_replied";
  }
  await supabaseAdmin.from("leads").update(update as never).eq("id", lead.id);

  await audit({
    businessId: lead.business_id,
    eventType: optOut ? "opt_out_recorded" : "inbound_reply",
    entityType: "lead",
    entityId: lead.id,
  });

  return { handled: true, leadId: lead.id };
}

export async function handleDeliveryStatus(input: {
  providerName: string;
  payload: Record<string, unknown>;
}): Promise<{ handled: boolean; reason?: string }> {
  const provider = getProvider(input.providerName);
  const update = provider.handleDeliveryStatus(input.payload);
  if (!update) return { handled: false, reason: "Payload missing provider message id." };

  const { data } = await supabaseAdmin
    .from("messages")
    .update({
      delivery_status: update.deliveryStatus,
      error_code: update.errorCode ?? null,
    })
    .eq("provider_message_id", update.providerMessageId)
    .select("id");

  return data?.length ? { handled: true } : { handled: false, reason: "Unknown message id." };
}

/** Sends every follow-up that is currently due. Safe to run repeatedly. */
export async function processDueFollowUps(): Promise<{
  processed: number;
  sent: number;
  skipped: Array<{ leadId: string; reason: string }>;
}> {
  const now = new Date();
  const { data: due } = await supabaseAdmin
    .from("conversations")
    .select("id, business_id, lead_id, follow_up_step, automation_paused, next_follow_up_at")
    .lte("next_follow_up_at", now.toISOString())
    .not("next_follow_up_at", "is", null)
    .limit(100);

  const skipped: Array<{ leadId: string; reason: string }> = [];
  let sent = 0;

  for (const conversation of due ?? []) {
    if (conversation.automation_paused) {
      skipped.push({ leadId: conversation.lead_id, reason: "Automation paused by the owner." });
      continue;
    }
    const business = await getBusiness(conversation.business_id);
    if (!business.automation_enabled) {
      skipped.push({ leadId: conversation.lead_id, reason: "Automation off for business." });
      continue;
    }
    if (isWithinQuietHours(business, now)) {
      await supabaseAdmin
        .from("conversations")
        .update({ next_follow_up_at: new Date(now.getTime() + 60 * 60 * 1000).toISOString() })
        .eq("id", conversation.id);
      skipped.push({ leadId: conversation.lead_id, reason: "Quiet hours — deferred." });
      continue;
    }

    const step = conversation.follow_up_step + 1;
    const { data: rule } = await supabaseAdmin
      .from("automation_rules")
      .select("message_template")
      .eq("business_id", conversation.business_id)
      .eq("rule_type", "follow_up")
      .eq("active", true)
      .eq("step", step)
      .maybeSingle();

    if (!rule) {
      await supabaseAdmin
        .from("conversations")
        .update({ next_follow_up_at: null })
        .eq("id", conversation.id);
      skipped.push({ leadId: conversation.lead_id, reason: "Follow-up sequence finished." });
      continue;
    }

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id, name, status, opted_out_at")
      .eq("id", conversation.lead_id)
      .maybeSingle();
    if (!lead) continue;

    await supabaseAdmin
      .from("conversations")
      .update({ follow_up_step: step })
      .eq("id", conversation.id);

    const result = await sendSms({
      businessId: conversation.business_id,
      leadId: lead.id,
      body: renderTemplate(rule.message_template, {
        first_name: firstName(lead.name),
        business_name: business.name,
      }),
      kind: "follow_up",
      idempotencyKey: `${lead.id}:follow_up:${step}`,
      respectAutomation: true,
    });

    if (result.sent) {
      sent += 1;
      await supabaseAdmin
        .from("leads")
        .update({ status: lead.status === "new" ? "contacted" : "waiting_for_customer" })
        .eq("id", lead.id);
    } else {
      skipped.push({ leadId: lead.id, reason: result.reason ?? "Not sent." });
      await supabaseAdmin
        .from("conversations")
        .update({ next_follow_up_at: null })
        .eq("id", conversation.id);
    }
  }

  return { processed: due?.length ?? 0, sent, skipped };
}

export { audit as recordAuditEvent };
