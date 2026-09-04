// Phase 4 (step 3): the agent executor — server wiring.
//
// Thin dispatcher only. This module loads state through EXISTING loaders,
// re-plans through the existing dry-run planner, re-evaluates the existing
// gates, resolves the ledger row, and then refuses because live execution is
// disabled. It contains no SMS composition, quiet-hour, suppression, stop-keywords,
// segment, availability, slot, booking, notification or follow-up-timing logic,
// and it calls no provider.
//
// While `LIVE_EXECUTION_ENABLED` is false this module performs NO writes at
// all: the claim and every ledger status write sit behind that constant, so the
// executor is unreachable for live execution and side-effect free.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authoriseAgentAction } from "./agent-gates.server";
import { findLedgerAction, claimAction, type LedgerRow } from "./agent-ledger.server";
import { planLeadSequence } from "./sequence-plan.server";
import { decideExecution, LIVE_EXECUTION_ENABLED, type ExecutorResult } from "./agent-executor";
import type { PlannedAction, SequencePlan } from "./sequence-actions";

export type ExecuteAgentActionInput = {
  businessId: string;
  leadId: string;
  campaignId: string;
  /** Idempotency key of the ledger action to execute. */
  idempotencyKey: string;
  /** Dry-run action recorded earlier; the executor never invents actions. */
  plannedAction: PlannedAction;
  plannedSequenceId: string;
  plannedTemplateVersion: number;
  plannedBookingStatus: string;
  /**
   * Advisory only and deliberately ignored for authorisation: the mode is
   * derived by `resolveExecutionMode` from server-verified gate facts.
   */
  requestedMode?: string | undefined;
  now?: Date;
};

/**
 * Claim the ledger row atomically. While live execution is disabled this never
 * touches the database, so no claim can be taken and no row can be mutated.
 */
async function claimForExecution(row: LedgerRow, businessId: string): Promise<boolean> {
  if (!LIVE_EXECUTION_ENABLED) return false;
  const claimed = await claimAction({ actionId: row.id, businessId, mode: "live" });
  return claimed !== null;
}

/**
 * Execute one planned agent action. Returns a structured blocked result in step
 * 3 for every possible input.
 */
export async function executeAgentAction(input: ExecuteAgentActionInput): Promise<ExecutorResult> {
  const now = input.now ?? new Date();

  // Ledger reference and live lead state, read-only.
  const [ledgerRow, leadRes] = await Promise.all([
    findLedgerAction({
      businessId: input.businessId,
      mode: "live",
      idempotencyKey: input.idempotencyKey,
    }),
    supabaseAdmin
      .from("leads")
      .select("id, booking_status")
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .maybeSingle(),
  ]);

  // Fresh re-plan through the existing dry-run planner (no writes, no sends).
  const replan: SequencePlan | null = await planLeadSequence({
    businessId: input.businessId,
    leadId: input.leadId,
    now,
  });

  const planStillCurrent =
    replan !== null &&
    replan.sequence === input.plannedSequenceId &&
    replan.actions.some(
      (a) => a.kind === input.plannedAction.kind && a.idempotencyKey === input.plannedAction.idempotencyKey,
    );

  // Fresh server-verified gates (tenant, campaign, consent, suppression,
  // takeover, pause, kill switches, quiet hours, caps, plan freshness).
  const gateResult = await authoriseAgentAction({
    businessId: input.businessId,
    leadId: input.leadId,
    campaignId: input.campaignId,
    actionKind: input.plannedAction.kind,
    plannedSequenceId: input.plannedSequenceId,
    plannedTemplateVersion: input.plannedTemplateVersion,
    planStillCurrent,
    requestedMode: input.requestedMode,
    now,
  });

  const claimHeld = ledgerRow ? await claimForExecution(ledgerRow, input.businessId) : false;

  return decideExecution({
    businessId: input.businessId,
    leadId: input.leadId,
    ledgerRow: ledgerRow ? { ...ledgerRow, status: claimHeld ? "claimed" : ledgerRow.status } : null,
    claimHeld,
    plannedAction: input.plannedAction,
    replan,
    plannedBookingStatus: input.plannedBookingStatus,
    currentBookingStatus: (leadRes.data?.booking_status ?? input.plannedBookingStatus) as string,
    gateResult,
  });
}
