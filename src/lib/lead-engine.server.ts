// Core lead + SMS engine. Server-only: always reached through server functions
// or server routes, never imported by client code.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  reachabilityUpdateFor,
  type ReachabilityRecord,
} from "@/lib/sms/reachability";
import {
  AUTOMATION_BLOCKED_STATUSES,
  firstName,
  isOptOutMessage,
  normaliseAuMobile,
  renderTemplate,
  type LeadStatus,
} from "@/lib/domain";
import { buildConsentPromotion } from "@/lib/consent-promotion";
import { mergeReturningLead } from "@/lib/returning-lead";
import { followUpSuppressedByBooking } from "@/lib/booking-projection";


import { countSegments } from "@/lib/sms/segments";
import { getProvider, type ResolvedSender } from "@/lib/sms/provider.server";
import { resolveEffectiveProviderName } from "@/lib/sms/resolution";
import { assertTenantMatch } from "@/lib/sms/events";
import { checkSmsCap, recordSmsUsage } from "@/lib/usage.server";
import {
  checkTextoCredits,
  checkTextoDailyCap,
  recordMessageSpend,
} from "@/lib/sms/texto-accounts.server";
import {
  canReuseOutboundRow,
  classifyCarrierFailure,
  RESERVED_STATUS,
  UNKNOWN_STATUS,
} from "@/lib/sms/dispatch";
import { isUniqueViolation } from "@/lib/sms/webhook.server";
import {
  messageAttributionColumns,
  normaliseAgentAttribution,
} from "@/lib/agent-attribution";
import {
  evaluateQuietHoursGate,
  isQuietHoursExemptTransactional,
  QUIET_HOURS_BLOCKED_CODE,
} from "@/lib/sms/quiet-hours";
import { resolveAcknowledgementTemplate } from "@/lib/acknowledgement-contract";


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
export async function recordConsentEvent(input: {
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
  return evaluateQuietHoursGate(business, at).blocked;
}


// ---------------------------------------------------------------------------
// Sender resolution
// ---------------------------------------------------------------------------

function toResolvedSender(row: {
  id: string;
  business_id: string | null;
  phone_number: string;
  provider: string;
  credential_mode: string;
  subaccount_sid: string | null;
  credential_secret_name: string | null;
  messaging_profile_id?: string | null;
}): ResolvedSender | null {
  // Unassigned platform inventory (no business) can never be used to send or
  // receive: every write path is scoped by business_id.
  if (!row.business_id) return null;
  return {
    id: row.id,
    businessId: row.business_id,
    phoneNumber: row.phone_number,
    provider: row.provider,
    credentialMode: row.credential_mode as ResolvedSender["credentialMode"],
    subaccountSid: row.subaccount_sid,
    credentialSecretName: row.credential_secret_name,
    messagingProfileId: row.messaging_profile_id ?? null,
  };
}


const SENDER_COLUMNS =
  "id, business_id, phone_number, provider, credential_mode, subaccount_sid, credential_secret_name, messaging_profile_id, active";

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

/**
 * Tenant lookup for inbound/callback webhooks: the receiving number is the key.
 * Inactive rows and unassigned platform inventory are never matched, so a
 * number that is only held for future activation stays inert.
 */
export async function findSenderByNumber(number: string): Promise<ResolvedSender | null> {
  const normalised = normaliseAuMobile(number) ?? number;
  // Parameterised list — webhook-supplied text can never alter the filter.
  const candidates = Array.from(new Set([normalised, number]));
  const { data } = await supabaseAdmin
    .from("sms_senders")
    .select(SENDER_COLUMNS)
    .in("phone_number", candidates)
    .eq("active", true)
    .not("business_id", "is", null)
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
  /** Full street address where the service is performed. */
  service_address?: string | null | undefined;
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
  /** Structured request routing from the tenant quote form. */
  request_type?: string | null | undefined;
  approved_service_id?: string | null | undefined;
  /** Historical source of truth for the chosen service; survives renames and deletion. */
  service_name_snapshot?: string | null | undefined;
  flexible_request_text?: string | null | undefined;
  requires_owner_review?: boolean | undefined;
  lead_origin?: string | null | undefined;
  source_metadata?: Record<string, unknown> | null | undefined;
  /**
   * Capture channel. "web" is the AI web-chat path: the lead is created but no
   * acknowledgement or follow-up SMS is ever queued for it.
   */
  channel?: "sms" | "web" | undefined;
  /** Deterministic submission key; retries reuse the existing lead instead of rewriting it. */
  external_id?: string | null | undefined;
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

  // Retry of the exact same submission: reuse the existing lead, never overwrite it.
  if (input.external_id) {
    const { data: priorSubmission } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("external_id", input.external_id)
      .maybeSingle();
    if (priorSubmission?.id) {
      return { leadId: priorSubmission.id, duplicate: true, acknowledgementSent: false };
    }
  }

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

  const capturedConsentAt = new Date().toISOString();

  const consentPatch = buildConsentPromotion({
    consented: input.consent,
    consentText: input.consent_text,
    sourceChannel: input.source_channel,
    sourceForm: input.source_form,
    formUrl: input.consent_source_url,
    at: capturedConsentAt,
  });

  const enquiryFields = {
    name: input.name,
    email: input.email ?? null,
    suburb: input.suburb ?? null,
    service_address: input.service_address ?? null,
    vehicle_type: input.vehicle_type ?? null,
    last_cleaned_at: input.last_cleaned_at ?? null,
    main_concerns: input.main_concerns ?? null,
    service_intent: input.service_intent ?? null,
    request_type: input.request_type ?? null,
    approved_service_id: input.approved_service_id ?? null,
    service_name_snapshot: input.service_name_snapshot ?? null,
    flexible_request_text: input.flexible_request_text ?? null,
    external_id: input.external_id ?? null,
    source_channel: input.source_channel ?? "unknown",
    source_form: input.source_form ?? null,
    source_campaign: input.source_campaign ?? null,
    utm_source: input.utm_source ?? null,
    utm_campaign: input.utm_campaign ?? null,
    lead_origin: input.lead_origin ?? null,
    requires_owner_review: input.requires_owner_review ?? false,
    source_metadata: (input.source_metadata ?? null) as Record<string, unknown> | null,
  };

  // A contact who already exists (an imported/dormant lead, or an earlier
  // enquiry) keeps their own record: the new enquiry enriches that profile
  // instead of creating a second one, so history is never split.
  let leadId: string | null = null;
  if (mobile) {
    const { data: returning } = await supabaseAdmin
      .from("leads")
      .select(
        "id, name, email, suburb, service_address, vehicle_type, last_cleaned_at, main_concerns, service_intent, request_type, approved_service_id, service_name_snapshot, flexible_request_text, external_id",
      )
      .eq("business_id", businessId)
      .eq("mobile_number", mobile)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (returning?.id) {
      const patch = mergeReturningLead(returning, enquiryFields);
      await supabaseAdmin
        .from("leads")
        .update({ ...patch, ...consentPatch } as never)
        .eq("id", returning.id)
        .eq("business_id", businessId);
      leadId = returning.id;
    }
  }

  if (!leadId) {
    const { data: lead, error } = await supabaseAdmin

      .from("leads")
      .insert({
        business_id: businessId,
        name: input.name,
        mobile_number: mobile ?? input.mobile_number,
        email: input.email ?? null,
        suburb: input.suburb ?? null,
        service_address: input.service_address ?? null,
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
        request_type: input.request_type ?? null,
        approved_service_id: input.approved_service_id ?? null,
        service_name_snapshot: input.service_name_snapshot ?? null,
        flexible_request_text: input.flexible_request_text ?? null,
        requires_owner_review: input.requires_owner_review ?? false,
        ...(input.lead_origin ? { lead_origin: input.lead_origin } : {}),
        ...(input.source_metadata ? { source_metadata: input.source_metadata as never } : {}),
        ...(input.external_id ? { external_id: input.external_id } : {}),
        // Consent promotion is branch-independent: the same canonical fields are
        // written for listed-service, unlisted/recommendation, owner-review and
        // contact-only submissions alike.
        ...consentPatch,

      })
      .select("id")
      .single();

    if (error || !lead) {
      // Concurrent retry lost the race on the unique (business_id, external_id) index:
      // read back the winning lead rather than creating or modifying anything.
      if (input.external_id && error?.code === "23505") {
        const { data: raced } = await supabaseAdmin
          .from("leads")
          .select("id")
          .eq("business_id", businessId)
          .eq("external_id", input.external_id)
          .maybeSingle();
        if (raced?.id) {
          return { leadId: raced.id, duplicate: true, acknowledgementSent: false };
        }
      }
      throw new Error(error?.message ?? "Could not create lead");
    }
    leadId = lead.id;
  }

  const lead = { id: leadId };

  const { data: openConversation } = await supabaseAdmin
    .from("conversations")
    .select("id")
    .eq("business_id", businessId)
    .eq("lead_id", lead.id)
    .limit(1)
    .maybeSingle();
  if (!openConversation?.id) {
    await supabaseAdmin.from("conversations").insert({
      business_id: businessId,
      lead_id: lead.id,
      status: "open",
    });
  }


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

  // Owner alert is durable and independent of the customer SMS.
  const { enqueueJob, runJobById } = await import("@/lib/jobs.server");
  const alertJob = await enqueueJob({
    businessId,
    leadId: lead.id,
    jobType: "owner_alert",
    idempotencyKey: `lead:${lead.id}:owner_alert`,
    payload: {
      title: `New lead: ${input.name}`,
      body: [
        `${input.name} · ${mobile ?? input.mobile_number}`,
        input.service_intent ? `Service: ${input.service_intent}` : null,
        input.service_address ? `Address: ${input.service_address}` : null,
        input.suburb ? `Suburb: ${input.suburb}` : null,
        `Received: ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: {
        lead_id: lead.id,
        name: input.name,
        mobile_number: mobile ?? input.mobile_number,
        service_intent: input.service_intent ?? null,
        service_address: input.service_address ?? null,
        suburb: input.suburb ?? null,
        received_at: new Date().toISOString(),
        source_channel: input.source_channel ?? "unknown",
      },
    },
  });
  if (alertJob.job) await runJobById(alertJob.job.id);

  if (!mobile) {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "Mobile number was not a valid Australian mobile — lead marked invalid, no SMS sent.",
    };
  }

  // Flexible / recommendation requests are owner-review only: no acknowledgement is queued.
  if (input.requires_owner_review) {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "Flagged for owner review — no automated SMS was queued for this enquiry.",
    };
  }

  // Web-chat capture never touches the SMS path: no acknowledgement, no
  // follow-up sequence, no provider call. The lead is still created.
  if (input.channel === "web") {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "Captured from the web conversation — no SMS was queued.",
    };
  }

  // Consent is a precondition for any acknowledgement on the public form path.
  if (input.lead_origin === "inbound_form" && !input.consent) {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "No SMS consent recorded — no automated SMS was queued.",
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

  // The acknowledgement is opt-in: with no active acknowledgement rule for this
  // tenant nothing is queued and nothing is sent. The frozen contract text is a
  // guard against an edited template, never a substitute for a disabled rule.
  if (!rule) {
    return {
      leadId: lead.id,
      duplicate: false,
      acknowledgementSent: false,
      note: "Acknowledgement is switched off for this business — no SMS was queued.",
    };
  }

  // The acknowledgement text is a frozen contract: a stored rule is honoured
  // only when it matches it exactly, otherwise the frozen text is used.
  const { template } = resolveAcknowledgementTemplate(rule.message_template);


  // Durable acknowledgement: persisted before we attempt the send, so an
  // interrupted request still leaves the ACK queued for the scheduler.
  const ackJob = await enqueueJob({
    businessId,
    leadId: lead.id,
    jobType: "acknowledgement",
    idempotencyKey: `${lead.id}:acknowledgement`,
    payload: {
      body: renderTemplate(template, {
        first_name: firstName(input.name),
        business_name: business.name,
      }),
    },
  });

  const ackResult = ackJob.job ? await runJobById(ackJob.job.id) : null;
  const sent = ackResult?.status === "succeeded";

  return {
    leadId: lead.id,
    duplicate: false,
    acknowledgementSent: sent,
    ...(sent
      ? {}
      : {
          note:
            ackResult?.status === "retrying"
              ? `Acknowledgement queued for retry: ${ackResult.reason ?? "send failed"}`
              : (ackResult?.reason ?? "Acknowledgement queued."),
        }),
  };
}

/**
 * Where an outbound SMS came from. Persisted on the message for reporting.
 *
 * `agent_sequence` is attribution-only and is NEVER derived: it appears solely
 * when a caller passes it explicitly (Phase 4 attribution plumbing).
 */
export type MessageSource =
  | "manual"
  | "approved_reply"
  | "quote_page"
  | "inbound_enquiry"
  | "automation"
  | "agent_sequence";

export function deriveMessageSource(
  kind: "acknowledgement" | "follow_up" | "manual" | "approved_reply",
  leadOrigin: string | null | undefined,
): Exclude<MessageSource, "agent_sequence"> {
  if (kind === "manual") return "manual";
  if (kind === "approved_reply") return "approved_reply";
  if (kind === "follow_up") return "automation";
  return leadOrigin === "live" || leadOrigin === null || leadOrigin === undefined
    ? "quote_page"
    : "inbound_enquiry";
}


export type SendSmsResult = {
  sent: boolean;
  reason?: string;
  messageId?: string;
  duplicate?: boolean;
  retriable?: boolean;
  /** Explicit, typed block reason. Currently only the final quiet-hours gate. */
  code?: typeof QUIET_HOURS_BLOCKED_CODE;
};



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
  /** Trigger for observability: manual, quote_page, inbound_follow_up, automation. */
  source?: MessageSource | undefined;
  /** Optional agent-sequence attribution (metadata only — never authorises a send). */
  sequenceId?: string | null | undefined;
  actionKind?: string | null | undefined;
  agentActionId?: string | null | undefined;
  templateId?: string | null | undefined;
}): Promise<SendSmsResult> {
  // Attribution is validated before anything else: a malformed reference must
  // never reach the carrier, the ledger or the usage accounting.
  const validated = normaliseAgentAttribution(input);
  if (!validated.ok) return { sent: false, retriable: false, reason: validated.reason };
  const attribution = validated.attribution;

  const business = await getBusiness(input.businessId);

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select(
      "id, name, mobile_number, status, opted_out_at, business_id, first_contacted_at, sms_suppressed_at, sms_suppression_reason, lead_origin, source_channel",
    )
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!lead) return { sent: false, retriable: false, reason: "Lead not found for this business." };
  if (lead.opted_out_at)
    return { sent: false, retriable: false, reason: "Lead has opted out — no SMS sent." };
  if (lead.status === "invalid")
    return { sent: false, retriable: false, reason: "Lead number is invalid." };

  // A supplied agent action reference must exist for THIS tenant. Unknown or
  // cross-tenant references are refused outright: nothing is sent, nothing is
  // written, no attribution is stored.
  if (attribution.agentActionId) {
    const { data: action } = await supabaseAdmin
      .from("agent_actions")
      .select("id, business_id, lead_id")
      .eq("id", attribution.agentActionId)
      .eq("business_id", input.businessId)
      .maybeSingle();
    if (!action)
      return {
        sent: false,
        retriable: false,
        reason: "Unknown agent action reference for this business — nothing was sent.",
      };
    if (action.lead_id && action.lead_id !== input.leadId)
      return {
        sent: false,
        retriable: false,
        reason: "Agent action reference belongs to a different lead — nothing was sent.",
      };
  }

  const automated = input.kind === "acknowledgement" || input.kind === "follow_up";


  // A permanent delivery failure suppresses future *automated* SMS to this lead.
  // Manual owner-initiated messages stay possible, deliberately.
  if (automated && lead.sms_suppressed_at) {
    return {
      sent: false,
      retriable: false,
      reason: `Automated SMS suppressed for this lead: ${lead.sms_suppression_reason ?? "permanent delivery failure"}`,
    };
  }

  const messageSource = input.source ?? deriveMessageSource(input.kind, lead.lead_origin);

  if (input.respectAutomation) {
    if (!business.automation_enabled)
      return { sent: false, retriable: false, reason: "Automation is switched off for this business." };
    if (AUTOMATION_BLOCKED_STATUSES.includes(lead.status as LeadStatus))
      return {
        sent: false,
        retriable: false,
        reason: `Automated SMS blocked for status "${lead.status}".`,
      };
  }


  // Fast path: a reserved, in-flight or successful send with this key blocks a
  // repeat. Only confirmed failures stay retriable. The unique index on
  // (business_id, idempotency_key) is the real guarantee — see the reservation
  // insert below.
  if (input.idempotencyKey) {
    const { data: dupe } = await supabaseAdmin
      .from("messages")
      .select("id, delivery_status")
      .eq("business_id", input.businessId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (dupe && !canReuseOutboundRow(dupe.delivery_status))
      return {
        sent: false,
        duplicate: true,
        reason: "Already sent (duplicate suppressed).",
        messageId: dupe.id,
      };
  }

  // Final quiet-hours safety gate for EVERY outbound kind (manual, approved AI
  // reply, acknowledgement, automated follow-up). It runs before segments are
  // reserved, before any usage accounting, before a conversation is created and
  // before the carrier is contacted, so a blocked send leaves no trace other
  // than an internal audit event. Scheduling of a later attempt stays with the
  // existing callers (job retry / follow-up deferral) — nothing is queued here.
  const quietHours = evaluateQuietHoursGate(business, new Date());
  // One narrow exemption: the operational booking-confirmation template. A
  // customer who has just booked must be told immediately, at any hour. The
  // exemption is template-scoped, so promotional copy, sequence steps and AI
  // replies stay fully blocked inside the window.
  const transactionalExempt = isQuietHoursExemptTransactional({
    templateId: input.templateId ?? null,
    kind: input.kind,
  });
  if (quietHours.blocked && transactionalExempt) {
    await audit({
      businessId: input.businessId,
      eventType: "sms_quiet_hours_exempt_transactional",
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        kind: input.kind,
        source: messageSource,
        template_id: input.templateId ?? null,
        local_hour: quietHours.localHour,
        timezone: business.timezone,
      },
    });
  }
  if (quietHours.blocked && !transactionalExempt) {
    await audit({
      businessId: input.businessId,
      eventType: "sms_blocked_quiet_hours",
      entityType: "lead",
      entityId: lead.id,
      metadata: {
        kind: input.kind,
        source: messageSource,
        local_hour: quietHours.localHour,
        quiet_hours_start: quietHours.start,
        quiet_hours_end: quietHours.end,
        timezone: business.timezone,
      },
    });
    return {
      sent: false,
      retriable: true,
      code: QUIET_HOURS_BLOCKED_CODE,
      reason: quietHours.reason,
    };
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
        metadata: { used: cap.used, cap: cap.cap, kind: input.kind },
      });
      return { sent: false, retriable: false, reason: cap.reason ?? "Monthly SMS safety cap reached." };
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
      retriable: true,
      reason: "No active sender number configured for this business (no_sender_configured).",
    };
  }

  // The sender row owns the carrier decision, except that a business in
  // simulated mode is a hard safety gate: no sender-level value can escalate
  // it to a live carrier.
  const provider = getProvider(
    resolveEffectiveProviderName(business.default_sms_provider, sender.provider),
  );
  const conversationId = await conversationIdFor(lead.id);

  // Commercial gate (paid pilot): live sends require an active paid pilot
  // with remaining segment allowance; segments are atomically reserved
  // against the hard cap before contacting the carrier. Simulated sends
  // (e.g. the Glocast environment) never touch a carrier and are exempt.
  let pilotPeriodId: string | null = null;
  let usesPurchasedCredit = false;
  if (provider.name !== "simulated") {
    const { authorizeLiveSend } = await import("@/lib/commercial.server");
    const gate = await authorizeLiveSend(input.businessId, segments);
    if (!gate.allowed) {
      return { sent: false, retriable: false, reason: gate.reason };
    }
    pilotPeriodId = gate.periodId;
    usesPurchasedCredit = gate.overage;
  }

  // Texto tenant account checks: active account, non-empty credit balance, and
  // daily send cap. Kept next to the pilot gate so both commercial and account
  // limits apply before we touch the carrier.
  if (provider.name === "texto") {
    const creditCheck = await checkTextoCredits(input.businessId, segments);
    if (!creditCheck.ok) {
      if (pilotPeriodId) {
        const { releaseReservedSegments } = await import("@/lib/commercial.server");
        await releaseReservedSegments(pilotPeriodId, segments);
      }
      return { sent: false, retriable: false, reason: creditCheck.reason };
    }

    const automated = input.source !== "manual" && input.source !== "approved_reply";
    const dailyCheck = await checkTextoDailyCap(input.businessId, automated);
    if (!dailyCheck.ok) {
      if (pilotPeriodId) {
        const { releaseReservedSegments } = await import("@/lib/commercial.server");
        await releaseReservedSegments(pilotPeriodId, segments);
      }
      return { sent: false, retriable: false, reason: dailyCheck.reason };
    }
  }

  const releaseSegments = async () => {
    if (!pilotPeriodId) return;
    const { releaseReservedSegments } = await import("@/lib/commercial.server");
    await releaseReservedSegments(pilotPeriodId, segments);
  };

  // Reserve the outbound row BEFORE the carrier call. The unique index on
  // (business_id, idempotency_key) means a concurrent caller with the same key
  // loses the insert and never dispatches a second SMS.
  let messageId: string | null = null;
  if (input.idempotencyKey) {
    const { data: prior } = await supabaseAdmin
      .from("messages")
      .select("id, delivery_status, attempt_count")
      .eq("business_id", input.businessId)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    if (prior) {
      if (!canReuseOutboundRow(prior.delivery_status)) {
        await releaseSegments();
        return {
          sent: false,
          duplicate: true,
          reason: "Already sent (duplicate suppressed).",
          messageId: prior.id,
        };
      }
      // Confirmed previous failure: reclaim the same row for this attempt.
      await supabaseAdmin
        .from("messages")
        .update({
          delivery_status: RESERVED_STATUS,
          error_code: null,
          provider: provider.name,
          sender_id: sender.id,
          from_number: sender.phoneNumber,
          segments,
          attempt_count: prior.attempt_count + 1,
          message_source: messageSource,
          ...messageAttributionColumns(attribution),
        })
        .eq("id", prior.id);
      messageId = prior.id;
    }
  }

  if (!messageId) {
    const reservation = await supabaseAdmin
      .from("messages")
      .insert({
        business_id: input.businessId,
        lead_id: lead.id,
        conversation_id: conversationId,
        direction: "outbound",
        body: input.body,
        provider: provider.name,
        sender_id: sender.id,
        from_number: sender.phoneNumber,
        segments,
        delivery_status: RESERVED_STATUS,
        message_kind: input.kind,
        idempotency_key: input.idempotencyKey ?? null,
        attempt_count: 1,
        message_source: messageSource,
        delivery_event_count: 0,
        ...messageAttributionColumns(attribution),
      })
      .select("id")
      .single();
    if (reservation.error || !reservation.data) {
      await releaseSegments();
      if (isUniqueViolation(reservation.error)) {
        return { sent: false, duplicate: true, reason: "Already sent (duplicate suppressed)." };
      }
      return {
        sent: false,
        retriable: true,
        reason: "Could not reserve the outbound message — nothing was sent.",
      };
    }
    messageId = reservation.data.id;
  }

  let result;
  try {
    result = await provider.sendMessage({ to: lead.mobile_number, body: input.body, sender });
  } catch (error) {
    const detail = provider.formatProviderError(error);
    const failure = classifyCarrierFailure(error);

    if (failure === "unknown_outcome") {
      // The carrier may have accepted it. Keep the segments reserved, park the
      // row as `unknown` (which holds the idempotency key, so no automatic
      // resend) and surface it for reconciliation.
      await supabaseAdmin
        .from("messages")
        .update({ delivery_status: UNKNOWN_STATUS, error_code: detail.slice(0, 200) })
        .eq("id", messageId);
      await audit({
        businessId: input.businessId,
        eventType: "sms_carrier_outcome_unknown",
        entityType: "message",
        entityId: messageId,
        metadata: { kind: input.kind, segments, detail: detail.slice(0, 200) },
      });
      return {
        sent: false,
        retriable: false,
        messageId,
        reason: `Carrier outcome unknown — held for reconciliation, not resent: ${detail}`,
      };
    }

    // Confirmed pre-dispatch rejection: release the reservation and stay retriable.
    await releaseSegments();
    await supabaseAdmin
      .from("messages")
      .update({ delivery_status: "failed", error_code: detail.slice(0, 200) })
      .eq("id", messageId);
    await recordSmsUsage({ businessId: input.businessId, failures: 1 });
    return { sent: false, retriable: true, messageId, reason: detail };
  }

  // A successful provider response only proves ACCEPTANCE. `provider_accepted`
  // is the strongest status we may write here; `delivered` only ever comes from
  // a verified delivery receipt (or the simulated provider, which has no carrier).
  const acceptedAt = new Date().toISOString();
  const acceptanceStatus =
    result.deliveryStatus === "queued" || result.deliveryStatus === "unknown"
      ? "provider_accepted"
      : result.deliveryStatus;

  const { data: message } = await supabaseAdmin
    .from("messages")
    .update({
      provider: result.provider,
      provider_message_id: result.providerMessageId,
      provider_cost: result.providerCost ?? null,
      delivery_status: acceptanceStatus,
      provider_raw_status: result.deliveryStatus,
      error_code: result.errorCode ?? null,
      provider_accepted_at: acceptedAt,
      sent_at: acceptanceStatus === "provider_accepted" ? null : acceptedAt,
      ...(acceptanceStatus === "delivered" ? { delivered_at: acceptedAt } : {}),
    })
    .eq("id", messageId)
    .select("id")
    .single();

  await recordSmsUsage({
    businessId: input.businessId,
    segmentsOut: segments,
    messagesOut: 1,
    providerCost: result.providerCost ?? 0,
  });

  // Bought credits fund overage regardless of which carrier delivered it.
  // Texto also consumes its provider-side credit for included sends.
  if (usesPurchasedCredit || provider.name === "texto") {
    await recordMessageSpend(input.businessId, segments);
  }

  const leadUpdate: Record<string, unknown> = {
    last_outbound_sms_status: acceptanceStatus,
    last_outbound_sms_at: acceptedAt,
    ...(acceptanceStatus === "delivered" ? { last_delivered_sms_at: acceptedAt } : {}),
  };
  if (!lead.first_contacted_at) leadUpdate["first_contacted_at"] = new Date().toISOString();
  if (["new"].includes(lead.status)) leadUpdate["status"] = "contacted";
  else if (lead.status === "customer_replied" && input.kind !== "follow_up")
    leadUpdate["status"] = "waiting_for_customer";
  await supabaseAdmin.from("leads").update(leadUpdate as never).eq("id", lead.id);

  await scheduleNextFollowUp({ businessId: input.businessId, leadId: lead.id, business });

  await audit({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: `sms_sent_${input.kind}`,
    entityType: "lead",
    entityId: lead.id,
    metadata: { segments, sender: sender.phoneNumber },
  });

  return { sent: true, messageId: message?.id ?? messageId };
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

  // A confirmed booking ends the sequence: the customer already has the
  // confirmation and the owner already has the alert.
  const { data: bookingState } = await supabaseAdmin
    .from("leads")
    .select("status, booking_status")
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (bookingState && followUpSuppressedByBooking(bookingState)) {
    await supabaseAdmin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString(), next_follow_up_at: null })
      .eq("id", conversation.id);
    return;
  }

  // Next *enabled* step: disabled steps are skipped, not treated as the end.
  const { data: rule } = await supabaseAdmin
    .from("automation_rules")
    .select("delay_minutes, step")
    .eq("business_id", input.businessId)
    .eq("rule_type", "follow_up")
    .eq("active", true)
    .gt("step", conversation.follow_up_step)
    .order("step", { ascending: true })
    .limit(1)
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

export const INBOUND_LEAD_COLUMNS =
  "id, business_id, status, sms_suppressed_at, reachability_state, reachability_evidence, reachability_evidence_at, last_successful_delivery_at, last_permanent_failure_at, last_inbound_reply_at";

/**
 * Most recent *active* lead for a mobile number within one tenant.
 * Soft-deleted leads (deleted_at set) are never matched: a reply must not
 * attach to a lead the owner has removed from the inbox.
 */
export function findActiveLeadByMobile(
  client: { from: (table: string) => any },
  businessId: string,
  mobile: string,
) {
  return client
    .from("leads")
    .select(INBOUND_LEAD_COLUMNS)
    .eq("business_id", businessId)
    .eq("mobile_number", mobile)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
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
}): Promise<{ handled: boolean; reason?: string; leadId?: string; replay?: boolean }> {
  const provider = getProvider(input.providerName);
  const inbound = provider.handleInboundMessage(input.payload);
  if (!inbound) return { handled: false, reason: "Payload missing sender or body." };

  const businessId = input.sender.businessId;
  const mobile = normaliseAuMobile(inbound.from) ?? inbound.from;
  const { data: lead } = await findActiveLeadByMobile(supabaseAdmin, businessId, mobile);


  if (!lead) return { handled: false, reason: `No lead matches ${mobile} for this business.` };
  // Defence in depth: the lead must belong to the tenant that owns the number.
  assertTenantMatch(businessId, lead.business_id);

  const conversationId = await conversationIdFor(lead.id);
  const { segments } = countSegments(inbound.body);
  const idempotencyKey = `in:${inbound.providerMessageId}`;

  // A webhook retry may re-enter here after a mid-way failure. The inbound row,
  // the usage counter and the audit event are written exactly once; the state
  // updates below are set-to-value, so replaying them is harmless.
  const { data: existingInbound } = await supabaseAdmin
    .from("messages")
    .select("id")
    .eq("business_id", businessId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  const alreadyPersisted = Boolean(existingInbound?.id);

  let inboundMessage: { id: string } | null = existingInbound ?? null;
  if (!alreadyPersisted) {
    const { data: created } = await supabaseAdmin
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
        idempotency_key: idempotencyKey,
        received_at: inbound.receivedAt,
      })
      .select("id")
      .single();
    inboundMessage = created ?? null;
    await recordSmsUsage({ businessId, segmentsIn: segments });
  }


  const optOut = isOptOutMessage(inbound.body);

  await supabaseAdmin
    .from("conversations")
    .update({
      last_message_at: inbound.receivedAt,
      next_follow_up_at: null,
      status: optOut ? "closed" : "needs_attention",
    })
    .eq("lead_id", lead.id);

  // A reply proves the number is contactable, but it never rewrites the
  // delivery status of earlier outbound messages — it is recorded separately.
  // An inbound reply is direct evidence the number was in use at that time, so
  // it restores reachable_recently while the failure history stays intact.
  const update: Record<string, unknown> = {
    first_reply_at: inbound.receivedAt,
    last_reply_at: inbound.receivedAt,
    ...reachabilityUpdateFor(lead as ReachabilityRecord, {
      kind: "inbound_reply",
      at: inbound.receivedAt,
    }),
  };
  if (optOut) {
    update["status"] = "opted_out";
    update["opted_out_at"] = inbound.receivedAt;
    update["consent_record"] = {
      opted_out: true,
      at: inbound.receivedAt,
      source_message: inbound.body,
    };
    // Consent events are an append-only log: only write on first handling.
    if (!alreadyPersisted) await recordConsentEvent({
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

  // A reply (or STOP) stops queued automated sends, including pending retries.
  await supabaseAdmin
    .from("automation_jobs")
    .update({
      status: "cancelled",
      failure_reason: optOut ? "Lead opted out." : "Customer replied.",
      next_attempt_at: null,
    })
    .eq("lead_id", lead.id)
    .eq("status", "pending")
    .in("job_type", ["acknowledgement", "follow_up"]);



  // Audit exactly once per inbound event, even if a retry re-ran the handler.
  if (!alreadyPersisted) {
    await audit({
      businessId,
      eventType: optOut ? "opt_out_recorded" : "inbound_reply",
      entityType: "lead",
      entityId: lead.id,
    });
  }

  return { handled: true, leadId: lead.id, replay: alreadyPersisted };
}

/**
 * Delivery receipt, constrained to the business that owns the sender number.
 *
 * This path never sends an SMS, never creates a message or conversation, and
 * never triggers automation — it only records the verified delivery outcome.
 */
export async function handleDeliveryStatus(input: {
  providerName: string;
  payload: Record<string, unknown>;
  sender: ResolvedSender;
  providerCost?: number;
}): Promise<{
  handled: boolean;
  reason?: string;
  applied?: boolean;
  status?: string;
  suppressed?: boolean;
}> {
  const provider = getProvider(input.providerName);
  const update = provider.handleDeliveryStatus(input.payload);
  if (!update) return { handled: false, reason: "Payload missing provider message id." };

  const { applyDeliveryEvent } = await import("@/lib/sms/delivery.server");
  const result = await applyDeliveryEvent({
    providerName: provider.name,
    businessId: input.sender.businessId,
    providerMessageId: update.providerMessageId,
    status: update.deliveryStatus,
    rawStatus: update.rawStatus ?? null,
    failureCode: update.errorCode ?? null,
    eventId: update.eventId ?? null,
    occurredAt: update.occurredAt ?? null,
    ...(input.providerCost !== undefined ? { providerCost: input.providerCost } : {}),
  });

  if (!result.handled) {
    return { handled: false, reason: "Unknown message id for this business." };
  }
  // Delivery-state changes are not new outbound messages: usage is never
  // incremented here. Only the daily failure counter reflects a first-time
  // terminal failure.
  if (result.applied && (result.status === "failed" || result.status === "undelivered")) {
    await recordSmsUsage({ businessId: input.sender.businessId, failures: 1 });
  }
  return {
    handled: true,
    applied: result.applied,
    ...(result.status ? { status: result.status } : {}),
    ...(result.suppressed ? { suppressed: true } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

/**
 * Turns every due follow-up into a durable job, then runs all due jobs
 * (including acknowledgements that were interrupted and SMS retries).
 * Safe to run repeatedly.
 */
export async function processDueFollowUps(): Promise<{
  processed: number;
  sent: number;
  queued: number;
  jobs: Array<{ jobId: string; jobType: string; status: string; attempt: number; reason?: string }>;
  skipped: Array<{ leadId: string; reason: string }>;
}> {
  const now = new Date();
  const { enqueueJob, processDueJobs } = await import("@/lib/jobs.server");
  const { data: due } = await supabaseAdmin
    .from("conversations")
    .select("id, business_id, lead_id, follow_up_step, automation_paused, next_follow_up_at")
    .lte("next_follow_up_at", now.toISOString())
    .not("next_follow_up_at", "is", null)
    .limit(100);

  const skipped: Array<{ leadId: string; reason: string }> = [];
  let queued = 0;

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

    // Next enabled step. Disabled steps are skipped, not treated as the end.
    const { data: rule } = await supabaseAdmin
      .from("automation_rules")
      .select("message_template, step")
      .eq("business_id", conversation.business_id)
      .eq("rule_type", "follow_up")
      .eq("active", true)
      .gt("step", conversation.follow_up_step)
      .order("step", { ascending: true })
      .limit(1)
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
      .select("id, name, status, opted_out_at, booking_status")
      .eq("id", conversation.lead_id)
      .maybeSingle();
    if (!lead) continue;

    // Confirmed booking: stop chasing, and clear the timer for good.
    if (followUpSuppressedByBooking(lead)) {
      await supabaseAdmin
        .from("conversations")
        .update({ next_follow_up_at: null })
        .eq("id", conversation.id);
      skipped.push({ leadId: lead.id, reason: "Booking confirmed — follow-ups stopped." });
      continue;
    }


    // The job now owns this step; clear the conversation timer so the same
    // step is not queued twice. Retries live on the job row.
    await supabaseAdmin
      .from("conversations")
      .update({ follow_up_step: rule.step, next_follow_up_at: null })
      .eq("id", conversation.id);

    const enqueued = await enqueueJob({
      businessId: conversation.business_id,
      leadId: lead.id,
      jobType: "follow_up",
      step: rule.step,
      idempotencyKey: `${lead.id}:follow_up:${rule.step}`,
      payload: {
        body: renderTemplate(rule.message_template, {
          first_name: firstName(lead.name),
          business_name: business.name,
        }),
      },
    });
    if (enqueued.created) queued += 1;
  }

  const jobs = await processDueJobs();
  const sent = jobs.filter((job) => job.status === "succeeded" && job.jobType !== "owner_alert").length;

  return { processed: due?.length ?? 0, sent, queued, jobs, skipped };
}


export { audit as recordAuditEvent };
