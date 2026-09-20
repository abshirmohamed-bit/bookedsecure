// Owner-controlled recovery from an SMS automation pause.
//
// Policy this module encodes:
//   * a recipient-permanent delivery failure pauses automated SMS for the lead
//   * a later delivery receipt or inbound reply updates reachability evidence
//   * that positive evidence NEVER resumes automation by itself
//   * only the business owner may clear the pause, after explicit confirmation
//   * clearing the pause sends nothing. it only restores eligibility
//
// Pure module: no I/O, so the server action, the UI and the tests share exactly
// the same wording and the same decisions. It never claims a number is dead.

import { assessReachability, type ReachabilityRecord } from "@/lib/sms/reachability";

export type SuppressionRecoveryLead = ReachabilityRecord & {
  sms_suppression_reason?: string | null;
  last_sms_failure_code?: string | null;
};

export type SuppressionRecoveryView = {
  /** Automated SMS is currently paused for this lead. */
  suppressed: boolean;
  /** Reachability evidence recorded after the pause began. */
  reachableRecently: boolean;
  /** The owner-only resume action should be offered. */
  canResume: boolean;
  /** Plain-language reason automation was paused. */
  pausedReason: string | null;
  pausedAt: string | null;
  /** Positive evidence since the pause, if any. */
  evidence: string | null;
  evidenceAt: string | null;
  evidenceKind: "reply" | "delivery" | null;
};

export const AUTOMATION_PAUSED_LABEL =
  "Paused after a previous permanent delivery failure";

export const RESUME_ACTION_LABEL = "Review and resume automation";

/** Sentences shown in the confirmation dialog, in order. */
export function resumeConfirmationPoints(view: SuppressionRecoveryView): string[] {
  return [
    `Why automation was paused: ${
      view.pausedReason ?? "a permanent delivery failure was reported by the provider"
    }${view.pausedAt ? ` (${view.pausedAt})` : ""}.`,
    view.evidence
      ? `Evidence recorded since: ${view.evidence}${view.evidenceAt ? ` (${view.evidenceAt})` : ""}.`
      : "No delivery receipt or reply has been recorded since the pause.",
    "Resuming clears the SMS suppression pause for this lead.",
    "No message will be sent immediately.",
    "Future eligible automation may run under the existing sequence, quiet-hours, opt-out, suppression, idempotency and usage protections.",
    "The permanent-failure history, delivery history and reachability evidence are all kept.",
  ];
}

/**
 * Derive the owner-facing state. Reachability and automation eligibility are
 * deliberately reported as two separate facts: a lead can be reachable recently
 * and still paused.
 */
export function assessSuppressionRecovery(
  lead: SuppressionRecoveryLead,
): SuppressionRecoveryView {
  const suppressed = Boolean(lead.sms_suppressed_at);
  const delivered = lead.last_successful_delivery_at ?? null;
  const replied = lead.last_inbound_reply_at ?? null;
  const pausedAt = lead.sms_suppressed_at ?? null;

  const since = (value: string | null): boolean =>
    Boolean(value) && (!pausedAt || Date.parse(value!) >= Date.parse(pausedAt));

  const repliedSince = since(replied);
  const deliveredSince = since(delivered);
  const assessment = assessReachability(lead);
  const reachableRecently =
    assessment.state === "reachable_recently" && (repliedSince || deliveredSince);

  const evidenceKind = repliedSince ? "reply" : deliveredSince ? "delivery" : null;

  return {
    suppressed,
    reachableRecently,
    canResume: suppressed,
    pausedReason: lead.sms_suppression_reason ?? null,
    pausedAt,
    evidence: evidenceKind
      ? evidenceKind === "reply"
        ? "Customer replied by SMS. the number was in use at that time."
        : "Provider confirmed delivery. the number accepted a message at that time."
      : null,
    evidenceAt: evidenceKind === "reply" ? replied : evidenceKind === "delivery" ? delivered : null,
    evidenceKind,
  };
}
