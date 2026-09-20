// Evidence-based reachability model.
//
// This module exists to correct a specific modelling error: `sms_suppressed_at`
// was being read as proof that a mobile number is permanently inactive. It is
// not. A2P SMS gives us delivery receipts, not handset or subscriber truth, and
// there is no read receipt at all.
//
// What we can honestly say:
//   * a provider delivery receipt  -> the number accepted a message at that time
//   * an inbound reply             -> a human used that number at that time
//   * a permanent provider failure -> that send did not arrive, and automated
//                                     sending should stop pending review
//
// So a permanent failure produces `suppressed_pending_review`, never a claim of
// permanent death, and any later delivery or reply restores
// `reachable_recently` while the failure history stays on the lead.
//
// Pure module: no I/O, so the delivery pipeline, the inbound path and the tests
// share exactly the same decisions.

export const REACHABILITY_STATES = [
  "unknown",
  "reachable_recently",
  "unreachable_recently",
  "suppressed_pending_review",
] as const;

export type ReachabilityState = (typeof REACHABILITY_STATES)[number];

export const REACHABILITY_LABELS: Record<ReachabilityState, string> = {
  unknown: "Reachability unknown",
  reachable_recently: "Reachable recently",
  unreachable_recently: "Unreachable recently",
  suppressed_pending_review: "Suppressed. needs review",
};

/** Plain-language explanations. Deliberately never claim a number is dead. */
export const REACHABILITY_DESCRIPTIONS: Record<ReachabilityState, string> = {
  unknown: "No delivery receipt or reply yet. nothing is known about this number.",
  reachable_recently:
    "A message was delivered or the customer replied. This proves contact at that time, not permanently.",
  unreachable_recently:
    "The last attempt failed permanently at the provider. The number is not proven inactive.",
  suppressed_pending_review:
    "Automated SMS is paused after a permanent delivery failure, pending owner review. The number is not proven inactive.",
};

/** Evidence already stored on the lead. All timestamps are ISO strings. */
export type ReachabilityRecord = {
  reachability_state?: string | null;
  reachability_evidence?: string | null;
  reachability_evidence_at?: string | null;
  last_successful_delivery_at?: string | null;
  last_permanent_failure_at?: string | null;
  last_inbound_reply_at?: string | null;
  sms_suppressed_at?: string | null;
};

export type ReachabilitySignal =
  /** Provider confirmed delivery. */
  | { kind: "delivered"; at: string }
  /** Customer sent an inbound SMS. */
  | { kind: "inbound_reply"; at: string }
  /** Recipient-permanent provider failure; suppresses automated SMS pending review. */
  | { kind: "permanent_failure"; at: string; reason?: string | null; code?: string | null }
  /** Sender/account configuration failure: not the lead's number. */
  | { kind: "configuration_failure"; at: string; reason?: string | null }
  /** Retryable carrier condition: never suppresses, never marks unreachable. */
  | { kind: "temporary_failure"; at: string; reason?: string | null };

export type ReachabilityAssessment = {
  state: ReachabilityState;
  evidence: string | null;
  evidenceAt: string | null;
  /** Whether automated SMS should be suppressed pending review. */
  suppress: boolean;
};

function time(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function latest(...values: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const value of values) {
    if (value && time(value) > time(best)) best = value;
  }
  return best;
}

/**
 * Derive the reachability state from stored evidence alone. The newest positive
 * signal (delivery receipt or inbound reply) always wins over an older
 * permanent failure. recovery is automatic and never needs a manual reset.
 */
export function assessReachability(record: ReachabilityRecord): ReachabilityAssessment {
  const delivered = record.last_successful_delivery_at ?? null;
  const replied = record.last_inbound_reply_at ?? null;
  const failed = record.last_permanent_failure_at ?? null;
  const suppressedAt = record.sms_suppressed_at ?? null;

  const positive = latest(delivered, replied);
  const negative = latest(failed, suppressedAt);

  if (positive && time(positive) >= time(negative)) {
    const byReply = time(replied) >= time(delivered);
    return {
      state: "reachable_recently",
      evidence: byReply
        ? "Customer replied by SMS. the number was in use at that time."
        : "Provider confirmed delivery. the number accepted a message at that time.",
      evidenceAt: positive,
      suppress: false,
    };
  }

  if (negative) {
    const state: ReachabilityState = suppressedAt ? "suppressed_pending_review" : "unreachable_recently";
    return {
      state,
      evidence: REACHABILITY_DESCRIPTIONS[state],
      evidenceAt: negative,
      suppress: Boolean(suppressedAt),
    };
  }

  return { state: "unknown", evidence: null, evidenceAt: null, suppress: false };
}

/**
 * Column patch for a new signal. Temporary and configuration failures record
 * nothing about the number itself: they are not evidence about the recipient.
 * Historical failure evidence is never cleared, only superseded.
 */
export function reachabilityUpdateFor(
  record: ReachabilityRecord,
  signal: ReachabilitySignal,
): Record<string, string | null> {
  const next: ReachabilityRecord = { ...record };

  switch (signal.kind) {
    case "delivered":
      next.last_successful_delivery_at = latest(record.last_successful_delivery_at, signal.at);
      break;
    case "inbound_reply":
      next.last_inbound_reply_at = latest(record.last_inbound_reply_at, signal.at);
      break;
    case "permanent_failure":
      next.last_permanent_failure_at = latest(record.last_permanent_failure_at, signal.at);
      next.sms_suppressed_at = record.sms_suppressed_at ?? signal.at;
      break;
    case "temporary_failure":
    case "configuration_failure":
      // Not evidence about the recipient number: no state change at all.
      return {};
  }

  const assessment = assessReachability(next);
  const evidence =
    signal.kind === "permanent_failure" && assessment.state !== "reachable_recently"
      ? `${signal.reason ?? "Permanent delivery failure reported by the provider."} ${
          REACHABILITY_DESCRIPTIONS[assessment.state]
        }`
      : assessment.evidence;

  const patch: Record<string, string | null> = {
    reachability_state: assessment.state,
    reachability_evidence: evidence,
    reachability_evidence_at: assessment.evidenceAt,
  };

  if (signal.kind === "delivered") patch["last_successful_delivery_at"] = next.last_successful_delivery_at ?? null;
  if (signal.kind === "inbound_reply") patch["last_inbound_reply_at"] = next.last_inbound_reply_at ?? null;
  if (signal.kind === "permanent_failure") patch["last_permanent_failure_at"] = next.last_permanent_failure_at ?? null;

  return patch;
}

/** True when a stored permanent failure is still worth showing after recovery. */
export function hasHistoricalFailure(record: ReachabilityRecord): boolean {
  return Boolean(record.last_permanent_failure_at ?? record.sms_suppressed_at);
}
