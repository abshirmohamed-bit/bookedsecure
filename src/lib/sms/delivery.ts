// Delivery observability: the internal delivery-state model, monotonic state
// transitions, and Telnyx failure classification.
//
// Pure module. no I/O, so the engine, the webhook handler, the reconciliation
// path and the tests all share exactly the same decisions.

export const DELIVERY_STATUSES = [
  "queued",
  "provider_accepted",
  "sent",
  "delivered",
  "failed",
  "undelivered",
  "unknown",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Terminal success. */
export const TERMINAL_SUCCESS: DeliveryStatus = "delivered";
/** Terminal failures. */
export const TERMINAL_FAILURES: DeliveryStatus[] = ["failed", "undelivered"];

export function isTerminal(status: string): boolean {
  return status === TERMINAL_SUCCESS || TERMINAL_FAILURES.includes(status as DeliveryStatus);
}

export function isPendingStatus(status: string): boolean {
  return status === "queued" || status === "provider_accepted" || status === "sent" || status === "unknown";
}

/**
 * Progress rank. A delivery event may only move a message forward, so a late or
 * out-of-order `sent`/`queued` event can never overwrite a terminal state.
 * `unknown` sorts below everything: it is a placeholder, not progress.
 */
const RANK: Record<DeliveryStatus, number> = {
  unknown: 0,
  queued: 1,
  provider_accepted: 2,
  sent: 3,
  delivered: 4,
  failed: 4,
  undelivered: 4,
};

export function statusRank(status: string): number {
  return RANK[status as DeliveryStatus] ?? 0;
}

export type TransitionDecision = {
  apply: boolean;
  /** Why the event was ignored. for logs and audit, never customer data. */
  reason?: "terminal_state" | "not_forward" | "same_state" | "unknown_status";
};

/**
 * The single transition gate. Allowed edges:
 *   queued -> provider_accepted -> sent -> delivered | failed | undelivered
 *   provider_accepted -> delivered | failed | undelivered
 * A terminal state is never overwritten, in either direction.
 */
export function decideTransition(current: string, next: string): TransitionDecision {
  if (!DELIVERY_STATUSES.includes(next as DeliveryStatus) || next === "unknown") {
    return { apply: false, reason: "unknown_status" };
  }
  if (isTerminal(current)) return { apply: false, reason: "terminal_state" };
  if (current === next) return { apply: false, reason: "same_state" };
  return statusRank(next) > statusRank(current)
    ? { apply: true }
    : { apply: false, reason: "not_forward" };
}

// ---------------------------------------------------------------------------
// Failure classification (Telnyx messaging error codes)
// ---------------------------------------------------------------------------

export type FailureClass =
  /** Will not succeed on retry, and the recipient number is the cause. */
  | "permanent"
  /** Will not succeed until sender/account configuration is fixed. not the lead's fault. */
  | "configuration"
  /** Retryable carrier/transport condition. */
  | "temporary"
  /** No reliable provider code: never assume the number is dead. */
  | "unknown";

/**
 * Source: Telnyx "Messaging Error Code Reference" (delivery errors).
 * Only codes documented as recipient-permanent suppress a lead.
 */
const PERMANENT_RECIPIENT: Record<string, string> = {
  "40001": "Not routable. destination is a landline or non-routable number.",
  "40003": "Blocked as spam permanently by the recipient carrier.",
  "40009": "Message content rejected by the carrier.",
  "40012": "Invalid destination number. carrier rejected the recipient.",
  "40300": "Recipient has opted out (STOP).",
  "40309": "Destination region is not supported.",
  "40310": "Destination number is invalid.",
};

/** Sender/account-side permanent problems: fix configuration, do not blame the lead. */
const CONFIGURATION: Record<string, string> = {
  "40010": "Sending number is not registered for this campaign.",
  "40019": "Sender campaign/number tagging is invalid.",
  "40100": "Sending number is not messaging-enabled.",
  "40305": "Sending number is not assigned to the messaging profile.",
  "40307": "Sender ID does not match the messaging profile.",
  "40311": "Messaging profile secret is incorrect.",
  "40312": "Messaging profile is disabled.",
  "40313": "Messaging profile secret is missing.",
  "40314": "Messaging is disabled for this sender.",
  "40315": "Sending number health is too poor to deliver.",
  "40322": "Message content was blocked by the carrier.",
  "40325": "Alphanumeric sender ID is invalid.",
  "40329": "Toll-free sender is not verified.",
  "40333": "Messaging spend limit reached.",
};

const TEMPORARY: Record<string, string> = {
  "40002": "Blocked as spam. retry later with different content or pacing.",
  "40004": "Recipient carrier rejected the message for an unknown reason.",
  "40005": "Temporary sending-rate problem.",
  "40006": "Recipient carrier is temporarily unavailable.",
  "40008": "Carrier did not acknowledge delivery. undeliverable for now.",
  "40011": "Rate limit exceeded.",
  "40014": "Message expired in the queue.",
  "40016": "Carrier sending limit exceeded.",
  "40017": "Carrier flagged the message as spam.",
  "40018": "Carrier content filtering applied.",
  "40020": "Traffic temporarily blocked by the carrier.",
  "40318": "Provider queue full.",
  "40320": "Sending number is temporarily unusable (provisioning).",
};

/** Fallback text patterns, used only when no provider code is available. */
const TEMPORARY_TEXT = /timeout|timed out|temporar|congest|unavailable|rate.?limit|try again|queue/i;

export type FailureClassification = {
  failureClass: FailureClass;
  code: string | null;
  reason: string;
  /** Permanent recipient failures suppress future automated SMS to that lead. */
  suppressLead: boolean;
  /** A Telnyx 40300 means the recipient opted out. */
  optOut: boolean;
};

export function classifyDeliveryFailure(input: {
  code?: string | null;
  rawStatus?: string | null;
  detail?: string | null;
}): FailureClassification {
  const code = input.code && String(input.code).trim() !== "" ? String(input.code).trim() : null;

  if (code && PERMANENT_RECIPIENT[code]) {
    return {
      failureClass: "permanent",
      code,
      reason: PERMANENT_RECIPIENT[code]!,
      suppressLead: true,
      optOut: code === "40300",
    };
  }
  if (code && CONFIGURATION[code]) {
    return {
      failureClass: "configuration",
      code,
      reason: CONFIGURATION[code]!,
      suppressLead: false,
      optOut: false,
    };
  }
  if (code && TEMPORARY[code]) {
    return {
      failureClass: "temporary",
      code,
      reason: TEMPORARY[code]!,
      suppressLead: false,
      optOut: false,
    };
  }

  const detail = (input.detail ?? "").trim();
  if (detail && TEMPORARY_TEXT.test(detail)) {
    return {
      failureClass: "temporary",
      code,
      reason: "Temporary carrier or transport problem reported by the provider.",
      suppressLead: false,
      optOut: false,
    };
  }

  // No reliable code: never assert the number is deactivated.
  return {
    failureClass: "unknown",
    code,
    reason: code
      ? `Provider reported delivery failure (code ${code}).`
      : "Provider reported delivery failure without a code.",
    suppressLead: false,
    optOut: false,
  };
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared by conversation view, inbox and summary)
// ---------------------------------------------------------------------------

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  queued: "Queued",
  provider_accepted: "Accepted by provider",
  sent: "Sent",
  delivered: "Delivered",
  failed: "Failed",
  undelivered: "Undelivered",
  unknown: "Awaiting confirmation",
};

export function deliveryLabel(status: string | null | undefined): string {
  if (!status) return "No SMS yet";
  return DELIVERY_LABELS[status as DeliveryStatus] ?? "Awaiting confirmation";
}

export const FAILURE_CLASS_LABELS: Record<FailureClass, string> = {
  permanent: "Permanent",
  configuration: "Configuration",
  temporary: "Temporary",
  unknown: "Unclassified",
};

// ---------------------------------------------------------------------------
// Tenant-scoped summary
// ---------------------------------------------------------------------------

export type DeliverySummaryInput = {
  delivery_status: string;
  failure_class?: string | null;
  message_source?: string | null;
};

export type DeliverySummary = {
  total: number;
  providerAccepted: number;
  sent: number;
  delivered: number;
  pending: number;
  failed: number;
  undelivered: number;
  temporaryFailures: number;
  permanentFailures: number;
  finalOutcomes: number;
  /** delivered / messages with a final delivery outcome; null while none are final. */
  deliveryRate: number | null;
  failureRate: number | null;
  bySource: Array<{ source: string; total: number; delivered: number; failed: number; pending: number }>;
};

/** Delivery rate = delivered / (delivered + failed + undelivered). Pending never counts. */
export function summariseDelivery(rows: DeliverySummaryInput[]): DeliverySummary {
  const summary: DeliverySummary = {
    total: rows.length,
    providerAccepted: 0,
    sent: 0,
    delivered: 0,
    pending: 0,
    failed: 0,
    undelivered: 0,
    temporaryFailures: 0,
    permanentFailures: 0,
    finalOutcomes: 0,
    deliveryRate: null,
    failureRate: null,
    bySource: [],
  };

  const sources = new Map<string, { source: string; total: number; delivered: number; failed: number; pending: number }>();

  for (const row of rows) {
    const status = row.delivery_status;
    if (status === "provider_accepted") summary.providerAccepted += 1;
    if (status === "sent") summary.sent += 1;
    if (status === "delivered") summary.delivered += 1;
    if (status === "failed") summary.failed += 1;
    if (status === "undelivered") summary.undelivered += 1;
    if (isPendingStatus(status)) summary.pending += 1;
    if (isTerminal(status)) summary.finalOutcomes += 1;
    if (TERMINAL_FAILURES.includes(status as DeliveryStatus)) {
      if (row.failure_class === "temporary") summary.temporaryFailures += 1;
      else if (row.failure_class === "permanent" || row.failure_class === "configuration")
        summary.permanentFailures += 1;
    }

    const key = row.message_source ?? "unknown";
    const bucket = sources.get(key) ?? { source: key, total: 0, delivered: 0, failed: 0, pending: 0 };
    bucket.total += 1;
    if (status === "delivered") bucket.delivered += 1;
    if (TERMINAL_FAILURES.includes(status as DeliveryStatus)) bucket.failed += 1;
    if (isPendingStatus(status)) bucket.pending += 1;
    sources.set(key, bucket);
  }

  if (summary.finalOutcomes > 0) {
    summary.deliveryRate = summary.delivered / summary.finalOutcomes;
    summary.failureRate = (summary.failed + summary.undelivered) / summary.finalOutcomes;
  }
  summary.bySource = [...sources.values()].sort((a, b) => b.total - a.total);
  return summary;
}

// ---------------------------------------------------------------------------
// Lead-level filters
// ---------------------------------------------------------------------------

export const SMS_LEAD_FILTERS = [
  "all",
  "sms_delivered",
  "sms_pending",
  "sms_failed",
  "sms_undelivered",
  "sms_suppressed",
  "no_reply_after_delivery",
] as const;

export type SmsLeadFilter = (typeof SMS_LEAD_FILTERS)[number];

export const SMS_FILTER_LABELS: Record<SmsLeadFilter, string> = {
  all: "All leads",
  sms_delivered: "SMS delivered",
  sms_pending: "SMS pending",
  sms_failed: "SMS failed",
  sms_undelivered: "SMS undelivered",
  sms_suppressed: "SMS suppressed",
  no_reply_after_delivery: "No reply after delivery",
};

export type SmsFilterLead = {
  last_outbound_sms_status?: string | null;
  last_delivered_sms_at?: string | null;
  sms_suppressed_at?: string | null;
  last_reply_at?: string | null;
  first_reply_at?: string | null;
};

export function matchesSmsFilter(lead: SmsFilterLead, filter: SmsLeadFilter): boolean {
  const status = lead.last_outbound_sms_status ?? null;
  switch (filter) {
    case "all":
      return true;
    case "sms_delivered":
      return status === "delivered";
    case "sms_pending":
      return status !== null && isPendingStatus(status);
    case "sms_failed":
      return status === "failed";
    case "sms_undelivered":
      return status === "undelivered";
    case "sms_suppressed":
      return Boolean(lead.sms_suppressed_at);
    case "no_reply_after_delivery":
      return Boolean(lead.last_delivered_sms_at) && !lead.last_reply_at && !lead.first_reply_at;
    default:
      return true;
  }
}
