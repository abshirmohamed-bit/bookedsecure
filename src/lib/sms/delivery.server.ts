// Applies a normalized delivery event to an outbound message, then rolls the
// outcome up to the lead.
//
// Hard rules enforced here:
//   * never sends an SMS, never creates a message, conversation, job or revenue
//   * never trusts a tenant id from a payload — the caller passes the business
//     resolved from the verified provider-number association
//   * a terminal state is never overwritten (see decideTransition)
//   * duplicate/late events are no-ops that still answer successfully

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  TERMINAL_FAILURES,
  classifyDeliveryFailure,
  decideTransition,
  type DeliveryStatus,
  type FailureClassification,
} from "./delivery";

type Client = typeof supabaseAdmin;

export type DeliveryEvent = {
  providerName: string;
  businessId: string;
  providerMessageId: string;
  /** Already normalized to the internal model by the provider adapter. */
  status: DeliveryStatus;
  rawStatus?: string | null;
  failureCode?: string | null;
  detail?: string | null;
  /** Provider event id / idempotency key for this delivery event. */
  eventId?: string | null;
  occurredAt?: string | null;
  providerCost?: number | null;
  /** Set by the read-only reconciliation path. */
  reconciliation?: boolean;
};

export type DeliveryEventResult = {
  handled: boolean;
  applied: boolean;
  messageId?: string;
  status?: string;
  failureClass?: FailureClassification["failureClass"];
  suppressed?: boolean;
  automationStopped?: boolean;
  reason?: string;
};

/** Diagnostics only: never a phone number, body or credential. */
function short(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").slice(0, 200);
}

export async function applyDeliveryEvent(
  event: DeliveryEvent,
  deps: { client?: Client } = {},
): Promise<DeliveryEventResult> {
  const client = deps.client ?? supabaseAdmin;
  const now = event.occurredAt ?? new Date().toISOString();

  const { data: message } = await client
    .from("messages")
    .select(
      "id, business_id, lead_id, conversation_id, direction, delivery_status, delivery_event_count, last_provider_event_id, provider",
    )
    .eq("business_id", event.businessId)
    .eq("provider_message_id", event.providerMessageId)
    .maybeSingle();

  // Unknown provider message id, or a message owned by another tenant: never
  // update anything, but record it so it is diagnosable.
  if (!message) {
    await client.from("audit_events").insert({
      business_id: event.businessId,
      event_type: "sms_delivery_event_unmatched",
      entity_type: "message",
      entity_id: null,
      metadata: {
        provider: event.providerName,
        status: event.status,
        raw_status: short(event.rawStatus),
        event_id: short(event.eventId),
      } as never,
    });
    return { handled: false, applied: false, reason: "unknown_provider_message_id" };
  }

  if (message.direction !== "outbound") {
    return { handled: false, applied: false, reason: "not_outbound_message", messageId: message.id };
  }

  // Same provider event replayed: idempotent no-op, safely acknowledged.
  if (event.eventId && message.last_provider_event_id === event.eventId) {
    return {
      handled: true,
      applied: false,
      messageId: message.id,
      status: message.delivery_status,
      reason: "duplicate_event",
    };
  }

  const decision = decideTransition(message.delivery_status, event.status);
  const failed = TERMINAL_FAILURES.includes(event.status);
  const classification = failed
    ? classifyDeliveryFailure({
        code: event.failureCode ?? null,
        rawStatus: event.rawStatus ?? null,
        detail: event.detail ?? null,
      })
    : null;

  // Provider metadata is always recorded, even when the state itself cannot move
  // forward — that is the audit trail for late and out-of-order events.
  const metadata: Record<string, unknown> = {
    provider_raw_status: event.rawStatus ?? null,
    last_provider_event_at: now,
    last_provider_event_id: event.eventId ?? null,
    delivery_event_count: (message.delivery_event_count ?? 0) + 1,
    ...(event.providerCost !== undefined && event.providerCost !== null
      ? { provider_cost: event.providerCost }
      : {}),
    ...(event.reconciliation ? { reconciled_at: now } : {}),
  };

  if (!decision.apply) {
    await client.from("messages").update(metadata as never).eq("id", message.id);
    return {
      handled: true,
      applied: false,
      messageId: message.id,
      status: message.delivery_status,
      reason: decision.reason ?? "ignored",
    };
  }

  const update: Record<string, unknown> = {
    ...metadata,
    delivery_status: event.status,
    ...(event.status === "provider_accepted" ? { provider_accepted_at: now } : {}),
    ...(event.status === "sent" ? { sent_at: now } : {}),
    ...(event.status === "delivered" ? { delivered_at: now } : {}),
  };

  if (classification) {
    update["failed_at"] = now;
    update["failure_code"] = classification.code;
    update["failure_reason"] = classification.reason;
    update["failure_class"] = classification.failureClass;
    update["error_code"] = classification.code ?? short(event.detail) || null;
  }

  await client.from("messages").update(update as never).eq("id", message.id);

  let automationStopped = false;
  if (classification?.suppressLead) {
    automationStopped = await suppressLeadForPermanentFailure(client, {
      businessId: event.businessId,
      leadId: message.lead_id,
      messageId: message.id,
      classification,
      at: now,
    });
    if (automationStopped) {
      await client.from("messages").update({ automation_stopped: true } as never).eq("id", message.id);
    }
  }

  await rollUpLeadDeliveryState(client, {
    businessId: event.businessId,
    leadId: message.lead_id,
    messageId: message.id,
    status: event.status,
    at: now,
    classification,
  });

  await client.from("audit_events").insert({
    business_id: event.businessId,
    event_type: `sms_delivery_${event.status}`,
    entity_type: "message",
    entity_id: message.id,
    metadata: {
      provider: event.providerName,
      raw_status: short(event.rawStatus),
      failure_code: classification?.code ?? null,
      failure_class: classification?.failureClass ?? null,
      reconciliation: Boolean(event.reconciliation),
    } as never,
  });

  return {
    handled: true,
    applied: true,
    messageId: message.id,
    status: event.status,
    ...(classification ? { failureClass: classification.failureClass } : {}),
    suppressed: Boolean(classification?.suppressLead),
    automationStopped,
  };
}

/**
 * Permanent recipient failure: suppress future automated SMS and stop any live
 * follow-up sequence. The lead, its conversation, messages, jobs and revenue are
 * all left intact — only messaging eligibility changes.
 */
async function suppressLeadForPermanentFailure(
  client: Client,
  input: {
    businessId: string;
    leadId: string;
    messageId: string;
    classification: FailureClassification;
    at: string;
  },
): Promise<boolean> {
  await client
    .from("leads")
    .update({
      sms_suppressed_at: input.at,
      sms_suppression_reason: input.classification.reason,
      ...(input.classification.optOut
        ? { opted_out_at: input.at, status: "opted_out" }
        : {}),
    } as never)
    .eq("id", input.leadId)
    .eq("business_id", input.businessId);

  // Stop the active automated sequence: no further scheduled sends, and pending
  // automated jobs are cancelled. This never dispatches anything.
  await client
    .from("conversations")
    .update({ automation_paused: true, next_follow_up_at: null } as never)
    .eq("lead_id", input.leadId)
    .eq("business_id", input.businessId);

  await client
    .from("automation_jobs")
    .update({
      status: "cancelled",
      failure_reason: "SMS permanently undeliverable.",
      next_attempt_at: null,
    } as never)
    .eq("lead_id", input.leadId)
    .eq("status", "pending")
    .in("job_type", ["acknowledgement", "follow_up"]);

  await client.from("audit_events").insert({
    business_id: input.businessId,
    event_type: "sms_suppressed_permanent_failure",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      message_id: input.messageId,
      failure_code: input.classification.code,
      failure_class: input.classification.failureClass,
    } as never,
  });

  return true;
}

/**
 * Durable lead-level state. Only the newest outbound message may set
 * `last_outbound_sms_status`, so a late event on an older message cannot make a
 * lead look failed after a newer message was delivered. Suppression is a
 * separate, explicit flag and is never cleared here.
 */
async function rollUpLeadDeliveryState(
  client: Client,
  input: {
    businessId: string;
    leadId: string;
    messageId: string;
    status: DeliveryStatus;
    at: string;
    classification: FailureClassification | null;
  },
): Promise<void> {
  const { data: latest } = await client
    .from("messages")
    .select("id, created_at")
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .eq("direction", "outbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const update: Record<string, unknown> = {};

  if (!latest || latest.id === input.messageId) {
    update["last_outbound_sms_status"] = input.status;
    update["last_outbound_sms_at"] = input.at;
  }
  if (input.status === "delivered") update["last_delivered_sms_at"] = input.at;
  if (input.classification) {
    update["last_sms_failure_at"] = input.at;
    update["last_sms_failure_reason"] = input.classification.reason;
    update["last_sms_failure_code"] = input.classification.code;
  }
  if (Object.keys(update).length === 0) return;

  await client
    .from("leads")
    .update(update as never)
    .eq("id", input.leadId)
    .eq("business_id", input.businessId);
}
