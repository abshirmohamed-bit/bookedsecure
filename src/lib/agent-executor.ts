// Phase 4 (step 3): the agent executor — pure decision core.
//
// The executor is a THIN DISPATCHER. It owns no domain logic: it does not
// compose SMS, does not evaluate quiet hours, suppression, stop-keywords, segments,
// availability, slots, bookings, notifications or follow-up timing. Those all
// live in their existing modules and are reached only through the tool call
// recorded on a `PlannedAction` — never re-implemented here.
//
// What this module does:
//  1. accepts a dry-run `PlannedAction` plus a fresh re-plan and fresh
//     server-verified gate result;
//  2. verifies the ledger action reference (existence, tenant, lead, kind);
//  3. rejects stale plans (sequence change, action change, booking-state change);
//  4. requires a held atomic claim;
//  5. refuses execution while live execution is disabled;
//  6. returns a structured blocked result.
//
// Hard invariants (asserted by tests):
//  - `LIVE_EXECUTION_ENABLED` is false, so `decideExecution` can never return a
//    dispatchable outcome regardless of gates, ledger state or caller input;
//  - no caller-supplied field can turn live execution on: the mode comes only
//    from `resolveExecutionMode` on server-verified gate facts;
//  - booking confirmation is not an action kind at all — booking confirmation stays
//    owned by the idempotent `commitWebChatBooking` path.

import type { GateFailure, GateResult } from "./agent-gates";
import type { LedgerRow } from "./agent-ledger.server";
import type { ActionKind, PlannedAction, SequencePlan } from "./sequence-actions";

/**
 * Master switch for Phase 4 live execution. Step 3 ships it OFF and no code
 * path may read a caller value in its place. Turning this on is a separate,
 * explicitly approved activation step.
 */
export const LIVE_EXECUTION_ENABLED = false as const;

export const REFUSAL_REASONS = [
  "live_execution_disabled",
  "unknown_action_reference",
  "cross_tenant_action_reference",
  "action_lead_mismatch",
  "action_kind_mismatch",
  "action_rolled_back",
  "action_not_claimable",
  "claim_not_held",
  "plan_missing",
  "plan_stale_sequence",
  "plan_stale_action",
  "plan_stale_booking_state",
  "gates_blocked",
  "booking_confirmation_not_executable",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

export type ExecutorInput = {
  businessId: string;
  leadId: string;
  /** Ledger row for this action, or null when the reference is unknown. */
  ledgerRow: LedgerRow | null;
  /** True only when an atomic conditional-update claim was actually won. */
  claimHeld: boolean;
  /** The action that was planned earlier and recorded in the ledger. */
  plannedAction: PlannedAction;
  /** Fresh re-plan from live state, or null when the lead can no longer plan. */
  replan: SequencePlan | null;
  /** Booking status recorded at plan time vs. the current one. */
  plannedBookingStatus: string;
  currentBookingStatus: string;
  /** Fresh server-verified gate result (never derived from caller input). */
  gateResult: GateResult;
};

export type ExecutorResult = {
  /** Always false in step 3. */
  executed: false;
  /** Always true in step 3. */
  blocked: true;
  /** Tool that would have been invoked once activation is approved. */
  wouldInvokeTool: PlannedAction["tool"] | null;
  reason: RefusalReason;
  detail: string;
  mode: GateResult["mode"];
  gateFailures: readonly GateFailure[];
  /** Ledger row id when the reference resolved, for audit correlation. */
  actionId: string | null;
};

function refuse(
  input: ExecutorInput,
  reason: RefusalReason,
  detail: string,
  wouldInvokeTool: PlannedAction["tool"] | null = null,
): ExecutorResult {
  return {
    executed: false,
    blocked: true,
    wouldInvokeTool,
    reason,
    detail,
    mode: input.gateResult.mode,
    gateFailures: input.gateResult.failures,
    actionId: input.ledgerRow?.id ?? null,
  };
}

/** Action kinds the executor may ever dispatch. Booking confirm is absent. */
export const DISPATCHABLE_ACTION_KINDS: readonly ActionKind[] = [
  "capture_consent",
  "send_message",
  "schedule_follow_up",
  "offer_booking",
  "handoff",
  "record_audit",
];

/**
 * Decide what the executor does. Pure: no I/O, no sends, no writes.
 *
 * Evaluation order is deliberate and fixed — reference validity, tenant scope,
 * plan freshness, gates, claim, then the live-execution switch — so a blocked
 * result always names the earliest and most specific reason.
 */
export function decideExecution(input: ExecutorInput): ExecutorResult {
  const row = input.ledgerRow;
  const kind = input.plannedAction.kind;

  // 1. Action reference.
  if (!row) return refuse(input, "unknown_action_reference", "no ledger row for this action");
  if (row.business_id !== input.businessId)
    return refuse(input, "cross_tenant_action_reference", "ledger action belongs to another business");
  if (row.lead_id !== null && row.lead_id !== input.leadId)
    return refuse(input, "action_lead_mismatch", "ledger action belongs to another lead");
  if (row.action_kind !== kind)
    return refuse(input, "action_kind_mismatch", "ledger action kind differs from the planned action");
  if (row.rolled_back_at !== null)
    return refuse(input, "action_rolled_back", "ledger action was rolled back");
  if (!DISPATCHABLE_ACTION_KINDS.includes(kind))
    return refuse(input, "booking_confirmation_not_executable", `action kind ${kind} is not dispatchable`);

  // 2. Plan freshness — a stale plan is never executed, it is re-planned.
  if (!input.replan) return refuse(input, "plan_missing", "lead can no longer be planned");
  if (input.replan.sequence !== row.sequence_id)
    return refuse(input, "plan_stale_sequence", "sequence changed since the plan was recorded");
  const stillPlanned = input.replan.actions.some(
    (a) =>
      a.kind === kind &&
      a.templateId === input.plannedAction.templateId &&
      a.idempotencyKey === input.plannedAction.idempotencyKey &&
      a.eligible,
  );
  if (!stillPlanned)
    return refuse(input, "plan_stale_action", "action is no longer part of the current plan");
  if (input.plannedBookingStatus !== input.currentBookingStatus)
    return refuse(input, "plan_stale_booking_state", "booking state changed since the plan was recorded");

  // 3. Gates — every gate must pass on server-verified facts.
  if (!input.gateResult.allowed || input.gateResult.mode !== "live")
    return refuse(
      input,
      "gates_blocked",
      input.gateResult.failures.map((f) => f.gate).join(",") || "execution not authorised",
      input.plannedAction.tool,
    );

  // 4. The atomic ledger claim is the execution lock.
  if (!input.claimHeld) return refuse(input, "claim_not_held", "ledger claim was not won");
  if (row.status !== "claimed")
    return refuse(input, "action_not_claimable", `ledger status is ${row.status}`);

  // 5. Live execution switch. Step 3 stops here, unconditionally.
  return refuse(
    input,
    "live_execution_disabled",
    "live execution is disabled; no tool was invoked",
    input.plannedAction.tool,
  );
}

/** True only if a real tool call would be dispatched. Always false in step 3. */
export function executionWouldDispatch(result: ExecutorResult): boolean {
  return LIVE_EXECUTION_ENABLED && result.executed === true;
}
