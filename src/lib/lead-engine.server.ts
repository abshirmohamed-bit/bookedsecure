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
import { countSegments } from "@/lib/sms/segments";
import { getProvider, type ResolvedSender } from "@/lib/sms/provider.server";
import { checkSmsCap, recordSmsUsage } from "@/lib/usage.server";

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

/** Permanent consent / opt-out history, kept separately from the lead record. */
async function recordConsentEvent(input: {
  businessId: string;
  leadId: string;
  eventType: "consent_given" | "opt_out" | "opt_in";
  mobileNumber?: string | null;
  consentText?: string | null;
  source?: string | null;
  messageId?: string | null;
  occurredAt?: string;
}) {
  await supabaseAdmin.from("consent_events").insert({
    business_id: input.businessId,
    lead_id: input.leadId,
    event_type: input.eventType,
    channel: "sms",
    mobile_number: input.mobileNumber ?? null,
    consent_text: input.consentText ?? null,
    source: input.source ?? null,
    message_id: input.messageId ?? null,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
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

// ---------------------------------------------------------------------------
// Sender resolution
// ---------------------------------------------------------------------------

function toResolvedSender(row: {
  id: string;
  business_id: string;
  phone_number: string;
  provider: string;
  credential_mode: string;
  subaccount_sid: string | null;
  credential_secret_name: string | null;
}): ResolvedSender {
  return {
    id: row.id,
    businessId: row.business_id,
    phoneNumber: row.phone_number,
    provider: row.provider,
    credentialMode: row.credential_mode as ResolvedSender["credentialMode"],
    subaccountSid: row.subaccount_sid,
    credentialSecretName: row.credential_secret_name,
  };
}

const SENDER_COLUMNS =
  "id, business_id, phone_number, provider, credential_mode, subaccount_sid, credential_secret_name, active";

/** Sender used for this business/lead: sticky per conversation, else primary. */
export async function resolveSender(input: {
  businessId: string;
  leadId?: string | undefined;
  senderId?: string | undefined;
}): Promise<ResolvedSender | null> {
  if (input.senderId) {
    const { data } = await supabaseAdmin
      .from("sms_senders")
      .select(SENDER_COLUMNS)
      .eq("id", input.senderId)
      .eq("business_id", input.businessId)
      .eq("active", true)
      .maybeSingle();
    if (data) return toResolvedSender(data);
  }

  if (input.leadId) {
    const { data: last } = await supabaseAdmin
      .from("messages")
      .select("sender_id")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .not("sender_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.sender_id) {
      const { data } = await supabaseAdmin
        .from("sms_senders")
        .select(SENDER_COLUMNS)
        .eq("id", last.sender_id)
        .eq("business_id", input.businessId)
        .eq("active", true)
        .maybeSingle();
      if (data) return toResolvedSender(data);
    }
  }

  const { data: primary } = await supabaseAdmin
    .from("sms_senders")
    .select(SENDER_COLUMNS)
    .eq("business_id", input.businessId)
    .eq("active", true)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return primary ? toResolvedSender(primary) : null;
}

/** Tenant lookup for inbound/callback webhooks: the receiving number is the key. */
export async function findSenderByNumber(number: string): Promise<ResolvedSender | null> {
  const normalised = normaliseAuMobile(number) ?? number;
  const { data } = await supabaseAdmin
    .from("sms_senders")
    .select(SENDER_COLUMNS)
    .or(`phone_number.eq.${normalised},phone_number.eq.${number}`)
    .limit(1)
    .maybeSingle();
  return data ? toResolvedSender(data) : null;
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
  consent_source_url?: string | null | undefined;
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
            source_channel: input.source_channel ?? "unknown",
            source_form: input.source_form ?? null,
            form_url: input.consent_source_url ?? null,
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

  if (input.consent) {
    await recordConsentEvent({
      businessId,
      leadId: lead.id,
      eventType: "consent_given",
      mobileNumber: mobile ?? input.mobile_number,
      consentText: input.consent_text ?? "Consent given on quote form",
      source: input.consent_source_url
        ? `${input.source_channel ?? "unknown"} | ${input.consent_source_url}`
        : (input.source_channel ?? "unknown"),
    });
  }

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

/** Single outbound path for every SMS: enforces opt-out, status, sender, caps and idempotency. */
export async function sendSms(input: {
  businessId: string;
  leadId: string;
  body: string;
  kind: "acknowledgement" | "follow_up" | "manual" | "approved_reply";
  idempotencyKey?: string | undefined;
  respectAutomation: boolean;
  userId?: string | null | undefined;
  senderId?: string | undefined;
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

  const automated = input.kind === "acknowledgement" || input.kind === "follow_up";

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

  const { segments } = countSegments(input.body);

  // Monthly safety cap: blocks automated traffic, never inbound or STOP handling.
  if (automated) {
    const cap = await checkSmsCap({ businessId: input.businessId, segments });
    if (cap.blocked) {
      await audit({
        businessId: input.businessId,
        eventType: "sms_blocked_usage_cap",
        entityType: "lead",
        entityId: lead.id,
        metadata: { used: cap.used, cap: cap.cap },
      });
      return { sent: false, reason: cap.reason ?? "Monthly SMS safety cap reached." };
    }
  }

  const sender = await resolveSender({
    businessId: input.businessId,
    leadId: lead.id,
    senderId: input.senderId,
  });
  if (!sender) {
    return {
      sent: false,
      reason: "No active sender number configured for this business (no_sender_configured).",
    };
  }

  const provider = getProvider(sender.provider === "twilio" ? business.default_sms_provider : sender.provider);
  const conversationId = await conversationIdFor(lead.id);

  let result;
  try {
    result = await provider.sendMessage({ to: lead.mobile_number, body: input.body, sender });
  } catch (error) {
    const detail = provider.formatProviderError(error);
    await supabaseAdmin.from("messages").insert({
      business_id: input.businessId,
      lead_id: lead.id,
      conversation_id: conversationId,
      direction: "outbound",
      body: input.body,
      provider: provider.name,
      sender_id: sender.id,
      from_number: sender.phoneNumber,
      segments,
      delivery_status: "failed",
      error_code: detail.slice(0, 200),
      message_kind: input.kind,
      idempotency_key: input.idempotencyKey ?? null,
      attempt_count: 1,
    });
    await recordSmsUsage({ businessId: input.businessId, failures: 1 });
    return { sent: false, reason: detail };
  }

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
      sender_id: sender.id,
      from_number: sender.phoneNumber,
      segments,
      provider_cost: result.providerCost ?? null,
      delivery_status: result.deliveryStatus,
      error_code: result.errorCode ?? null,
      message_kind: input.kind,
      idempotency_key: input.idempotencyKey ?? null,
      attempt_count: 1,
      sent_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  await recordSmsUsage({
    businessId: input.businessId,
    segmentsOut: segments,
    messagesOut: 1,
    providerCost: result.providerCost ?? 0,
  });

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
    metadata: { segments, sender: sender.phoneNumber },
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

/**
 * Inbound SMS: stores the reply, handles opt-out and stops automation.
 * The tenant is identified by the receiving sender number — never by a global
 * mobile-number scan.
 */
export async function handleInboundMessage(input: {
  providerName: string;
  payload: Record<string, unknown>;
  sender: ResolvedSender;
}): Promise<{ handled: boolean; reason?: string; leadId?: string }> {
  const provider = getProvider(input.providerName);
  const inbound = provider.handleInboundMessage(input.payload);
  if (!inbound) return { handled: false, reason: "Payload missing sender or body." };

  const businessId = input.sender.businessId;
  const mobile = normaliseAuMobile(inbound.from) ?? inbound.from;
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, business_id, status")
    .eq("business_id", businessId)
    .eq("mobile_number", mobile)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) return { handled: false, reason: `No lead matches ${mobile} for this business.` };

  const conversationId = await conversationIdFor(lead.id);
  const { segments } = countSegments(inbound.body);
  const { data: inboundMessage } = await supabaseAdmin
    .from("messages")
    .insert({
      business_id: businessId,
      lead_id: lead.id,
      conversation_id: conversationId,
      direction: "inbound",
      body: inbound.body,
      provider: provider.name,
      provider_message_id: inbound.providerMessageId,
      sender_id: input.sender.id,
      from_number: mobile,
      segments,
      delivery_status: "delivered",
      message_kind: "customer_reply",
      idempotency_key: `in:${inbound.providerMessageId}`,
      received_at: inbound.receivedAt,
    })
    .select("id")
    .single();

  await recordSmsUsage({ businessId, segmentsIn: segments });

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
    await recordConsentEvent({
      businessId,
      leadId: lead.id,
      eventType: "opt_out",
      mobileNumber: mobile,
      consentText: inbound.body,
      source: "inbound_sms",
      messageId: inboundMessage?.id ?? null,
      occurredAt: inbound.receivedAt,
    });
  } else if (!["completed", "scheduled", "quote_sent"].includes(lead.status)) {
    update["status"] = "customer_replied";
  }
  await supabaseAdmin.from("leads").update(update as never).eq("id", lead.id);

  await audit({
    businessId,
    eventType: optOut ? "opt_out_recorded" : "inbound_reply",
    entityType: "lead",
    entityId: lead.id,
  });

  return { handled: true, leadId: lead.id };
}

/** Delivery callback, constrained to the business that owns the sender number. */
export async function handleDeliveryStatus(input: {
  providerName: string;
  payload: Record<string, unknown>;
  sender: ResolvedSender;
}): Promise<{ handled: boolean; reason?: string }> {
  const provider = getProvider(input.providerName);
  const update = provider.handleDeliveryStatus(input.payload);
  if (!update) return { handled: false, reason: "Payload missing provider message id." };

  const failed = update.deliveryStatus === "failed" || update.deliveryStatus === "undelivered";

  const { data } = await supabaseAdmin
    .from("messages")
    .update({
      delivery_status: update.deliveryStatus,
      error_code: update.errorCode ?? null,
    })
    .eq("provider_message_id", update.providerMessageId)
    .eq("business_id", input.sender.businessId)
    .select("id");

  if (!data?.length) return { handled: false, reason: "Unknown message id for this business." };
  if (failed) await recordSmsUsage({ businessId: input.sender.businessId, failures: 1 });
  return { handled: true };
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
