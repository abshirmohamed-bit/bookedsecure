// Phase 4 (step 1): pure activation-gate evaluation.
//
// This module decides *whether* an agent action may run live. It performs no
// I/O, sends nothing, and cannot itself activate anything. Live execution is
// only ever permitted when EVERY gate below passes on server-verified facts.
//
// Hard rules enforced here (asserted by tests):
//  - a client-supplied mode is never trusted: `resolveExecutionMode` ignores
//    any requested mode and derives the mode from server-verified gates only;
//  - tenant opt-in alone never authorises outreach — campaign approval,
//    sequence approval, template-version approval, an explicit lead scope and
//    an explicit execution authorisation are all independently required;
//  - there is no implicit "all leads" audience: the lead must appear in the
//    campaign's explicit scope;
//  - `capture_consent` is a REAL outbound SMS action and is gated exactly like
//    `send_message` (consent-capture excepted), never treated as internal.

import type { ActionKind } from "./sequence-actions";

export const EXECUTION_MODES = ["dry_run", "live"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const GATE_IDS = [
  "tenant_opt_in",
  "agent_enabled",
  "global_kill_switch",
  "tenant_kill_switch",
  "campaign_approved",
  "sequence_approved",
  "template_version_approved",
  "lead_scope",
  "execution_authorisation",
  "lead_eligibility",
  "consent",
  "reachability",
  "suppression",
  "opt_out",
  "tenant_takeover",
  "automation_paused",
  "booking_conflict",
  "quiet_hours",
  "daily_volume_limit",
  "hourly_rate_limit",
  "activation_lead_cap",
  "plan_freshness",
  "tenant_scope",
  "owner_review",
] as const;
export type GateId = (typeof GATE_IDS)[number];

/**
 * How recently a manual outbound message counts as the owner actively handling
 * the conversation. Applies to agent execution eligibility only; manual
 * messaging behaviour is untouched.
 */
export const MANUAL_OUTBOUND_RECENCY_HOURS = 72;

/** Human-handling facts. All optional: absent facts never block. */
export type OwnerHandlingFacts = {
  /** `conversations.status` for this lead, if a conversation row exists. */
  conversationStatus?: string | null;
  /** Most recent manual (human-authored) outbound message timestamp. */
  lastManualOutboundAt?: string | null;
  /** True when the newest outbound message on the conversation is manual. */
  latestOutboundIsManual?: boolean;
  /** Newest inbound customer reply timestamp. */
  lastInboundReplyAt?: string | null;
  /** An owner-review flag is present on the lead or conversation. */
  ownerReviewFlag?: boolean;
  /** A human takeover event is currently active. */
  humanTakeoverActive?: boolean;
  /** Evaluation instant; defaults to now. */
  nowIso?: string;
};

const time = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
};

/**
 * Pure owner-handling evaluation. Any human involvement signal blocks agent
 * execution with `owner_review`; it never changes manual messaging.
 */
export function evaluateOwnerHandling(facts: OwnerHandlingFacts): readonly GateFailure[] {
  const out: GateFailure[] = [];
  const add = (detail: string) => out.push({ gate: "owner_review", detail });

  const now = time(facts.nowIso) ?? Date.now();
  const manualAt = time(facts.lastManualOutboundAt);
  const replyAt = time(facts.lastInboundReplyAt);
  const manualIsRecent =
    manualAt !== null && now - manualAt <= MANUAL_OUTBOUND_RECENCY_HOURS * 60 * 60 * 1000;

  if (facts.conversationStatus === "owner_handling") add("conversation status is owner_handling");
  if (facts.conversationStatus === "needs_attention" && manualIsRecent)
    add("conversation needs attention and has recent manual outbound activity");
  if (facts.latestOutboundIsManual === true) add("latest outbound message is manual");
  if (manualAt !== null && replyAt !== null && manualAt > replyAt)
    add("owner manually contacted the lead after the latest inbound reply");
  if (facts.ownerReviewFlag === true) add("owner review flag is present");
  if (facts.humanTakeoverActive === true) add("a human takeover event is active");

  return out;
}


/** Action kinds that put an SMS on the wire. `capture_consent` is one of them. */
export const OUTBOUND_ACTION_KINDS: readonly ActionKind[] = ["capture_consent", "send_message"];

export type GateFailure = { gate: GateId; detail: string };

export type GateFacts = {
  /** Action being considered. */
  actionKind: ActionKind;
  /** Tenant scope. */
  businessId: string;
  leadBusinessId: string;
  campaignBusinessId: string;

  /** Tenant activation state. */
  tenantOptedInAt: string | null;
  agentEnabled: boolean;
  tenantKillSwitchAt: string | null;
  globalKillSwitchAt: string | null;

  /** Campaign / sequence / template approval. */
  campaignStatus: string;
  campaignDisabledAt: string | null;
  campaignApprovedAt: string | null;
  sequenceApprovedAt: string | null;
  campaignSequenceId: string;
  plannedSequenceId: string;
  approvedTemplateVersion: number;
  plannedTemplateVersion: number;
  /** Explicit lead scope; an empty scope authorises nobody. */
  scopeLeadIds: readonly string[];
  leadId: string;
  executionAuthorisedAt: string | null;
  executionAuthorisationKind: "canary" | "bounded_batch" | null;

  /** Lead eligibility. */
  requiresOwnerReview: boolean;
  consentGranted: boolean;
  consentCaptureAction: boolean;
  consentDeclined: boolean;
  optedOut: boolean;
  suppressed: boolean;
  reachable: boolean;
  tenantTakeover: boolean;
  automationPaused: boolean;
  hasConflictingBooking: boolean;
  quietHoursNow: boolean;
  /**
   * Policy path for this message. Defaults to `sequence_follow_up`, which
   * always enforces quiet hours.
   */
  messagePath?: "new_lead_response" | "sequence_follow_up";
  /**
   * Server-verified new-lead-response exemption (see `message-path.ts`). Only a
   * granted exemption on the new-lead path may run inside quiet hours; it never
   * relaxes any other gate.
   */
  quietHoursExemptionGranted?: boolean;

  /** Limits. */
  sentToday: number;
  dailySendCap: number;
  sentThisHour: number;
  hourlySendCap: number;
  leadsInActivation: number;
  maxLeadsPerActivation: number;

  /** Re-plan equality: the plan must still be the current plan. */
  planStillCurrent: boolean;
} & OwnerHandlingFacts;


export type GateResult = {
  mode: ExecutionMode;
  allowed: boolean;
  failures: readonly GateFailure[];
};

function isOutbound(kind: ActionKind): boolean {
  return OUTBOUND_ACTION_KINDS.includes(kind);
}

/**
 * Evaluate every activation gate. Returns all failures (not just the first) so
 * a dry-run preview can show the owner the complete picture.
 */
export function evaluateActivationGates(facts: GateFacts): readonly GateFailure[] {
  const f: GateFailure[] = [];
  const fail = (gate: GateId, detail: string) => f.push({ gate, detail });

  // Tenant scope first — a mismatch is never recoverable.
  if (facts.leadBusinessId !== facts.businessId)
    fail("tenant_scope", "lead belongs to another business");
  if (facts.campaignBusinessId !== facts.businessId)
    fail("tenant_scope", "campaign belongs to another business");

  if (!facts.tenantOptedInAt) fail("tenant_opt_in", "tenant has not opted in to agent execution");
  if (!facts.agentEnabled) fail("agent_enabled", "agent is disabled for this tenant");
  if (facts.globalKillSwitchAt) fail("global_kill_switch", "platform kill switch is active");
  if (facts.tenantKillSwitchAt) fail("tenant_kill_switch", "tenant kill switch is active");

  if (!facts.campaignApprovedAt) fail("campaign_approved", "campaign is not approved");
  if (facts.campaignDisabledAt) fail("campaign_approved", "campaign is disabled");
  if (facts.campaignStatus === "rolled_back") fail("campaign_approved", "campaign was rolled back");
  if (!["approved", "authorised", "running"].includes(facts.campaignStatus))
    fail("campaign_approved", `campaign status is ${facts.campaignStatus}`);
  if (!facts.sequenceApprovedAt) fail("sequence_approved", "sequence is not approved");
  if (facts.campaignSequenceId !== facts.plannedSequenceId)
    fail("sequence_approved", "planned sequence differs from the approved sequence");
  if (facts.approvedTemplateVersion !== facts.plannedTemplateVersion)
    fail("template_version_approved", "template version differs from the approved version");

  if (facts.scopeLeadIds.length === 0) fail("lead_scope", "campaign has no explicit lead scope");
  else if (!facts.scopeLeadIds.includes(facts.leadId))
    fail("lead_scope", "lead is not in the campaign's explicit scope");
  if (!facts.executionAuthorisedAt)
    fail("execution_authorisation", "execution has not been explicitly authorised");
  if (facts.executionAuthorisedAt && facts.executionAuthorisationKind === null)
    fail("execution_authorisation", "authorisation kind must be canary or bounded_batch");

  if (facts.requiresOwnerReview) fail("lead_eligibility", "lead requires owner review");
  if (facts.optedOut) fail("opt_out", "lead has opted out");
  if (facts.suppressed) fail("suppression", "lead is suppressed");
  if (facts.tenantTakeover) fail("tenant_takeover", "owner has taken over the conversation");
  if (facts.automationPaused) fail("automation_paused", "automation is paused for this lead");
  if (facts.hasConflictingBooking) fail("booking_conflict", "lead already has a conflicting booking");

  if (isOutbound(facts.actionKind)) {
    if (!facts.reachable) fail("reachability", "lead is not reachable by SMS");
    if (facts.consentDeclined) fail("consent", "consent was declined");
    if (!facts.consentGranted && !facts.consentCaptureAction)
      fail("consent", "consent has not been granted");
    if (facts.consentCaptureAction && facts.consentGranted)
      fail("consent", "consent already granted; consent capture is unnecessary");
    if (facts.quietHoursNow) {
      const exempt =
        facts.messagePath === "new_lead_response" && facts.quietHoursExemptionGranted === true;
      if (!exempt)
        fail(
          "quiet_hours",
          facts.messagePath === "new_lead_response"
            ? "inside quiet hours — new-lead response did not meet every exemption condition"
            : "inside quiet hours — sequence follow-up deferred, not dropped",
        );
    }
    if (facts.dailySendCap <= 0) fail("daily_volume_limit", "daily send cap is not configured");
    else if (facts.sentToday >= facts.dailySendCap)
      fail("daily_volume_limit", "daily send cap reached");
    if (facts.hourlySendCap <= 0) fail("hourly_rate_limit", "hourly send cap is not configured");
    else if (facts.sentThisHour >= facts.hourlySendCap)
      fail("hourly_rate_limit", "hourly send cap reached");
  }

  if (facts.maxLeadsPerActivation <= 0)
    fail("activation_lead_cap", "activation lead cap is not configured");
  else if (facts.leadsInActivation > facts.maxLeadsPerActivation)
    fail("activation_lead_cap", "activation exceeds the tenant lead cap");

  if (!facts.planStillCurrent) fail("plan_freshness", "plan is stale — re-plan before executing");

  // Human involvement blocks agent execution only; manual messaging is untouched.
  f.push(...evaluateOwnerHandling(facts));


  return f;
}

/**
 * Derive the execution mode from server-verified gates ONLY.
 *
 * A requested mode is accepted as a *downgrade* signal and nothing else: asking
 * for "live" can never produce live execution on its own.
 */
export function resolveExecutionMode(input: {
  requestedMode?: string | undefined;
  serverVerifiedGateFailures: readonly GateFailure[];
}): GateResult {
  const failures = input.serverVerifiedGateFailures;
  if (input.requestedMode !== "live") {
    return { mode: "dry_run", allowed: false, failures };
  }
  if (failures.length > 0) return { mode: "dry_run", allowed: false, failures };
  return { mode: "live", allowed: true, failures: [] };
}
