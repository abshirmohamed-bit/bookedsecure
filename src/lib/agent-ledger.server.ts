// Phase 4 (step 1): the agent action ledger.
//
// `agent_actions` is the single write-ahead record and idempotency authority for
// every agent action. This module records, claims, completes and rolls back
// ledger rows. It NEVER sends an SMS, calls a provider, enqueues a job, creates
// a booking or notifies an owner — the executor (a later step, still gated off)
// is the only caller allowed to invoke tools, and it must hold a claim first.
//
// Rollback is non-destructive by contract: nothing here deletes ledger rows,
// messages, bookings, sequence decisions or audit events. Rollback marks rows
// `rolled_back` with reason, actor, timestamp and activation id.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ActionKind, PlannedAction, SequencePlan } from "./sequence-actions";
import type { ExecutionMode } from "./agent-gates";

export const LEDGER_STATUSES = [
  "planned",
  "claimed",
  "succeeded",
  "blocked",
  "failed",
  "abandoned",
  "rolled_back",
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Statuses a claim may transition from. `succeeded` is terminal. */
export const CLAIMABLE_STATUSES: readonly LedgerStatus[] = ["planned", "failed"];

export type LedgerRow = {
  id: string;
  business_id: string;
  lead_id: string | null;
  sequence_id: string;
  action_kind: string;
  template_id: string | null;
  idempotency_key: string;
  mode: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  blocked_reason: string | null;
  failure_reason: string | null;
  result_ref: string | null;
  result_kind: string | null;
  campaign_id: string | null;
  activation_id: string | null;
  rolled_back_at: string | null;
};

const COLUMNS =
  "id, business_id, lead_id, sequence_id, action_kind, template_id, idempotency_key, mode, status, attempt_count, max_attempts, blocked_reason, failure_reason, result_ref, result_kind, campaign_id, activation_id, rolled_back_at";

export async function findLedgerAction(input: {
  businessId: string;
  mode: ExecutionMode;
  idempotencyKey: string;
}): Promise<LedgerRow | null> {
  const { data } = await supabaseAdmin
    .from("agent_actions")
    .select(COLUMNS)
    .eq("business_id", input.businessId)
    .eq("mode", input.mode)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  return (data as LedgerRow | null) ?? null;
}

/**
 * Record a planned action. Idempotent: an existing row for the same
 * (business, mode, idempotency key) is returned untouched, so a replay never
 * creates a second action and never resets a completed one.
 */
export async function recordPlannedAction(input: {
  businessId: string;
  leadId: string | null;
  sequenceId: string;
  action: PlannedAction;
  mode: ExecutionMode;
  campaignId?: string | null;
  activationId?: string | null;
  planSnapshot?: unknown;
  scheduledFor?: Date | null;
}): Promise<LedgerRow | null> {
  const key = input.action.idempotencyKey;
  if (!key) return null;

  const existing = await findLedgerAction({
    businessId: input.businessId,
    mode: input.mode,
    idempotencyKey: key,
  });
  if (existing) return existing;

  const { data } = await supabaseAdmin
    .from("agent_actions")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId,
      sequence_id: input.sequenceId,
      action_kind: input.action.kind,
      template_id: input.action.templateId,
      idempotency_key: key,
      mode: input.mode,
      status: input.action.eligible ? "planned" : "blocked",
      blocked_reason: input.action.blockedReason,
      scheduled_for: input.scheduledFor ? input.scheduledFor.toISOString() : null,
      campaign_id: input.campaignId ?? null,
      activation_id: input.activationId ?? null,
      plan_snapshot: (input.planSnapshot ?? null) as never,
    })
    .select(COLUMNS)
    .maybeSingle();

  // A concurrent insert loses the unique race; return the winner's row.
  return (
    (data as LedgerRow | null) ??
    (await findLedgerAction({
      businessId: input.businessId,
      mode: input.mode,
      idempotencyKey: key,
    }))
  );
}

/** Record a whole dry-run plan for owner preview. Never claimable while dry_run. */
export async function recordPlanPreview(plan: SequencePlan, activationId?: string | null) {
  const rows: LedgerRow[] = [];
  for (const action of plan.actions) {
    const row = await recordPlannedAction({
      businessId: plan.businessId,
      leadId: plan.leadId,
      sequenceId: plan.sequence,
      action,
      mode: "dry_run",
      activationId: activationId ?? null,
      planSnapshot: plan,
    });
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Attempt to claim an action for execution. The conditional update IS the lock:
 * exactly one caller can move `planned|failed` → `claimed`, everyone else gets
 * null and must stop. Live claims additionally require `mode = 'live'`.
 */
export async function claimAction(input: {
  actionId: string;
  businessId: string;
  mode: ExecutionMode;
}): Promise<LedgerRow | null> {
  const { data } = await supabaseAdmin
    .from("agent_actions")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", input.actionId)
    .eq("business_id", input.businessId)
    .eq("mode", input.mode)
    .is("rolled_back_at", null)
    .in("status", CLAIMABLE_STATUSES as unknown as string[])
    .select(COLUMNS)
    .maybeSingle();
  return (data as LedgerRow | null) ?? null;
}

export async function completeAction(input: {
  actionId: string;
  businessId: string;
  resultKind: "message" | "job" | "booking_offer" | "notification" | "audit_event";
  resultRef: string | null;
}): Promise<void> {
  await supabaseAdmin
    .from("agent_actions")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      result_kind: input.resultKind,
      result_ref: input.resultRef,
      failure_reason: null,
    })
    .eq("id", input.actionId)
    .eq("business_id", input.businessId);
}

export async function blockAction(input: {
  actionId: string;
  businessId: string;
  reason: string;
}): Promise<void> {
  await supabaseAdmin
    .from("agent_actions")
    .update({
      status: "blocked",
      blocked_reason: input.reason,
      completed_at: new Date().toISOString(),
    })
    .eq("id", input.actionId)
    .eq("business_id", input.businessId);
}

/**
 * Record a failure. Transient failures return to `planned` for the existing
 * retry backoff; a permanent failure, or exhausted attempts, is terminal.
 */
export async function failAction(input: {
  actionId: string;
  businessId: string;
  reason: string;
  retriable: boolean;
  attemptCount: number;
  maxAttempts: number;
}): Promise<LedgerStatus> {
  const exhausted = input.attemptCount >= input.maxAttempts;
  const status: LedgerStatus = input.retriable && !exhausted ? "failed" : "abandoned";
  await supabaseAdmin
    .from("agent_actions")
    .update({
      status,
      failure_reason: input.reason,
      attempt_count: input.attemptCount,
      completed_at: status === "abandoned" ? new Date().toISOString() : null,
    })
    .eq("id", input.actionId)
    .eq("business_id", input.businessId);
  return status;
}

/** Kill switch / rollback: stop open actions without touching history. */
export async function abandonOpenActions(input: {
  businessId: string;
  reason: string;
  activationId?: string | null;
}): Promise<number> {
  let query = supabaseAdmin
    .from("agent_actions")
    .update({
      status: "abandoned",
      failure_reason: input.reason,
      completed_at: new Date().toISOString(),
    })
    .eq("business_id", input.businessId)
    .eq("mode", "live")
    .in("status", ["planned", "claimed", "failed"]);
  if (input.activationId) query = query.eq("activation_id", input.activationId);
  const { data } = await query.select("id");
  return (data ?? []).length;
}

/**
 * Non-destructive rollback. Marks actions `rolled_back` with reason, actor,
 * time and activation. Deletes nothing: messages, bookings, jobs, provenance,
 * sequence decisions and audit events all remain readable.
 */
export async function rollbackActivation(input: {
  businessId: string;
  activationId: string;
  reason: string;
  actorUserId: string | null;
  leadIds?: readonly string[];
}): Promise<{ rolledBack: number; leadIds: string[] }> {
  let query = supabaseAdmin
    .from("agent_actions")
    .update({
      status: "rolled_back",
      rolled_back_at: new Date().toISOString(),
      rollback_reason: input.reason,
      rollback_actor: input.actorUserId,
    })
    .eq("business_id", input.businessId)
    .eq("activation_id", input.activationId)
    .is("rolled_back_at", null)
    .neq("status", "succeeded");
  if (input.leadIds && input.leadIds.length > 0)
    query = query.in("lead_id", input.leadIds as string[]);

  const { data } = await query.select("id, lead_id");
  const rows = (data ?? []) as { id: string; lead_id: string | null }[];

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.actorUserId,
    event_type: "agent_activation_rolled_back",
    entity_type: "sequence_campaign",
    entity_id: input.activationId,
    metadata: {
      reason: input.reason,
      activation_id: input.activationId,
      actions_rolled_back: rows.length,
      lead_ids: rows.map((r) => r.lead_id).filter(Boolean),
    } as never,
  });

  return {
    rolledBack: rows.length,
    leadIds: rows.map((r) => r.lead_id).filter((v): v is string => Boolean(v)),
  };
}

/** Actions that are safe to execute for this claim holder. */
export function isExecutable(row: LedgerRow, kind: ActionKind): boolean {
  return (
    row.status === "claimed" &&
    row.mode === "live" &&
    row.rolled_back_at === null &&
    row.action_kind === kind
  );
}
