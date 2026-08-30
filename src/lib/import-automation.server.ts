// Server-side rollout controller for the CRM importer.
//
// SAFETY BOUNDARY: the only live write this module can cause is a single lead
// row per staged source row, via `importStagedRowAsLead` in
// import-lead.server.ts (reached through the commit gate). It never inserts
// conversations, messages, notifications, jobs or automation_jobs, never
// changes pipeline state beyond the imported lead's own status, never calls
// `captureLead`, and never calls Telnyx, Sinch or any other provider.
//
// Everything else here is tenant-scoped reads plus bookkeeping on
// import_automation_state, lead_import_rows and audit_events.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { commitIdempotencyKey, type CommitBlockReason } from "@/lib/commit-gate";
import { loadCommitRows, revalidateCandidate, type StagedCommitRow } from "@/lib/commit-gate.server";
import {
  BOUNDED_BATCH_MAX_ROWS,
  DEFAULT_IMPORT_AUTOMATION_STATE,
  buildImportSummary,
  evaluateBoundedBatchGate,
  evaluateCanaryGate,
  evaluateExceptionOnlyGate,
  evaluateModeTransition,
  limitBoundedBatch,
  readImportAutomationState,
  type ImportAutomationState,
  type ImportGateReason,
  type ImportMode,
  type ImportSummary,
  type ModeTransitionReason,
  type RowResult,
} from "@/lib/import-automation";

type Client = SupabaseClient<Database>;

const TABLE = "import_automation_state";

/** Read the tenant's rollout state, creating the safe default row on first use. */
export async function loadAutomationState(
  client: Client,
  businessId: string,
): Promise<ImportAutomationState> {
  const { data } = await client
    .from(TABLE as never)
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();
  if (data) return readImportAutomationState(data);

  // First use: persist the default `preview_only` row. A concurrent insert is
  // harmless — we simply fall back to the default in memory.
  await client.from(TABLE as never).insert({
    business_id: businessId,
    mode: DEFAULT_IMPORT_AUTOMATION_STATE.mode,
    mode_reason: DEFAULT_IMPORT_AUTOMATION_STATE.mode_reason,
    paused: false,
  } as never);
  return { ...DEFAULT_IMPORT_AUTOMATION_STATE };
}

async function patchState(
  client: Client,
  businessId: string,
  patch: Record<string, unknown>,
): Promise<ImportAutomationState> {
  await loadAutomationState(client, businessId);
  await client
    .from(TABLE as never)
    .update(patch as never)
    .eq("business_id", businessId);
  return loadAutomationState(client, businessId);
}

async function audit(
  client: Client,
  businessId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  entity?: { type: string; id: string | null },
): Promise<void> {
  await client.from("audit_events").insert({
    business_id: businessId,
    event_type: eventType,
    entity_type: entity?.type ?? "import_automation_state",
    entity_id: entity?.id ?? null,
    metadata: metadata as never,
  } as never);
}

/** Tenant-scoped kill switch. Previewing and classification keep working. */
export async function setImportPaused(
  client: Client,
  businessId: string,
  paused: boolean,
): Promise<ImportAutomationState> {
  const state = await patchState(client, businessId, {
    paused,
    mode_reason: paused
      ? "Automatic imports paused by the business owner. Previewing and classification still run."
      : "Automatic imports resumed by the business owner.",
  });
  await audit(client, businessId, paused ? "crm_import_paused" : "crm_import_resumed", {
    paused,
    mode: state.mode,
  });
  return state;
}

export type ModeChangeResult =
  | { ok: true; state: ImportAutomationState }
  | { ok: false; reasons: ModeTransitionReason[]; state: ImportAutomationState };

/** Deliberate, owner-driven mode change. Never advances on its own. */
export async function changeImportMode(
  client: Client,
  businessId: string,
  next: unknown,
): Promise<ModeChangeResult> {
  const state = await loadAutomationState(client, businessId);
  const decision = evaluateModeTransition(state, next);
  if (!decision.ok) return { ok: false, reasons: decision.reasons, state };

  const patch: Record<string, unknown> = { mode: decision.mode, mode_reason: decision.reason };
  if (decision.mode === "exception_only") patch["exception_only_enabled_at"] = new Date().toISOString();
  const updated = await patchState(client, businessId, patch);
  await audit(client, businessId, "crm_import_mode_changed", {
    from: state.mode,
    to: decision.mode,
    reason: decision.reason,
  });
  return { ok: true, state: updated };
}

// --- verified canary execution ------------------------------------------------

export type CanaryCheck = { check: string; passed: boolean; detail: string };

export type CanaryVerification = {
  status: "passed" | "blocked" | "failed";
  gate_reasons: ImportGateReason[];
  lead_id: string | null;
  row_number: number;
  checks: CanaryCheck[];
  rerun_status: string | null;
  leads_before: number;
  leads_after: number;
  state: ImportAutomationState;
};

async function countLeads(client: Client, businessId: string): Promise<number> {
  const { count } = await client
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  return count ?? 0;
}

async function countFor(
  client: Client,
  table: "conversations" | "messages" | "jobs" | "notifications" | "automation_jobs",
  businessId: string,
  leadId: string,
): Promise<number> {
  const { count } = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("lead_id", leadId);
  return count ?? 0;
}

/**
 * Runs the one-row canary as a real controlled execution and only then records
 * the gate as passed. Tests alone can never set `canary_passed_at`: this
 * function requires an actual live lead, verified zero side effects, and a
 * verified idempotent re-run.
 */
export async function verifyCanaryImport(
  client: Client,
  businessId: string,
  batchId: string,
  rowNumber: number,
): Promise<CanaryVerification> {
  const state = await loadAutomationState(client, businessId);
  const gate = evaluateCanaryGate(state);
  if (!gate.allowed) {
    return {
      status: "blocked",
      gate_reasons: gate.reasons,
      lead_id: null,
      row_number: rowNumber,
      checks: [],
      rerun_status: null,
      leads_before: 0,
      leads_after: 0,
      state,
    };
  }

  const { commitCanaryRow } = await import("@/lib/commit-gate.server");
  const leadsBefore = await countLeads(client, businessId);
  const first = await commitCanaryRow(client, businessId, batchId, rowNumber);

  if (first.status !== "committed") {
    const leadsAfter = await countLeads(client, businessId);
    return {
      status: first.status === "already_committed" ? "blocked" : "failed",
      gate_reasons: [],
      lead_id: "lead_id" in first ? (first.lead_id ?? null) : null,
      row_number: rowNumber,
      checks: [
        {
          check: "exactly_one_live_lead_created",
          passed: false,
          detail: `The canary returned "${first.status}", so the gate was not passed.`,
        },
      ],
      rerun_status: null,
      leads_before: leadsBefore,
      leads_after: leadsAfter,
      state,
    };
  }

  const leadId = first.lead_id;
  const midLeads = await countLeads(client, businessId);
  const [conversations, messages, jobs, alerts, automation] = await Promise.all([
    countFor(client, "conversations", businessId, leadId),
    countFor(client, "messages", businessId, leadId),
    countFor(client, "jobs", businessId, leadId),
    countFor(client, "notifications", businessId, leadId),
    countFor(client, "automation_jobs", businessId, leadId),
  ]);

  const { data: staged } = await client
    .from("lead_import_rows")
    .select("resulting_lead_id, normalized_payload")
    .eq("batch_id", batchId)
    .eq("business_id", businessId)
    .eq("row_number", rowNumber)
    .maybeSingle();
  const commit = ((staged?.normalized_payload ?? {}) as { commit?: Record<string, unknown> }).commit ?? {};

  // Re-run the same canary: it must be a no-op.
  const second = await commitCanaryRow(client, businessId, batchId, rowNumber);
  const leadsAfter = await countLeads(client, businessId);

  const checks: CanaryCheck[] = [
    {
      check: "exactly_one_live_lead_created",
      passed: midLeads === leadsBefore + 1,
      detail: `Live leads went from ${leadsBefore} to ${midLeads}.`,
    },
    {
      check: "no_conversation_created",
      passed: conversations === 0,
      detail: `${conversations} conversations exist for the imported lead.`,
    },
    {
      check: "no_sms_or_message_created",
      passed: messages === 0,
      detail: `${messages} messages exist for the imported lead.`,
    },
    {
      check: "no_owner_alert_queued",
      passed: alerts === 0,
      detail: `${alerts} notifications exist for the imported lead.`,
    },
    {
      check: "no_job_created",
      passed: jobs === 0,
      detail: `${jobs} jobs exist for the imported lead.`,
    },
    {
      check: "no_automation_queued",
      passed: automation === 0,
      detail: `${automation} automation jobs exist for the imported lead.`,
    },
    {
      check: "preview_row_records_live_lead",
      passed: staged?.resulting_lead_id === leadId,
      detail: `Preview row links lead ${staged?.resulting_lead_id ?? "—"}.`,
    },
    {
      check: "preview_row_records_committed_status",
      passed: commit["status"] === "committed" && typeof commit["committed_at"] === "string",
      detail: `Recorded commit status ${String(commit["status"] ?? "—")} at ${String(commit["committed_at"] ?? "—")}.`,
    },
    {
      check: "rerun_returns_already_committed",
      passed: second.status === "already_committed",
      detail: `The second run returned "${second.status}".`,
    },
    {
      check: "rerun_creates_zero_additional_leads",
      passed: leadsAfter === midLeads,
      detail: `Live leads stayed at ${leadsAfter} after the second run.`,
    },
  ];

  const passed = checks.every((entry) => entry.passed);
  const now = new Date().toISOString();
  const rerunOk =
    checks.find((entry) => entry.check === "rerun_returns_already_committed")?.passed === true &&
    checks.find((entry) => entry.check === "rerun_creates_zero_additional_leads")?.passed === true;

  const updated = await patchState(client, businessId, {
    canary_passed_at: passed ? now : null,
    canary_batch_id: batchId,
    canary_row_number: rowNumber,
    canary_lead_id: passed ? leadId : null,
    idempotency_verified_at: rerunOk ? now : null,
    last_run_at: now,
    mode_reason: passed
      ? "The one-row canary import was executed and verified with zero side effects."
      : "The canary import ran but at least one safety check failed. Automatic importing stays blocked.",
  });

  await audit(
    client,
    businessId,
    passed ? "crm_import_canary_verified" : "crm_import_canary_verification_failed",
    {
      batch_id: batchId,
      row_number: rowNumber,
      lead_id: leadId,
      leads_before: leadsBefore,
      leads_after: leadsAfter,
      rerun_status: second.status,
      checks,
    },
    { type: "lead", id: leadId },
  );

  return {
    status: passed ? "passed" : "failed",
    gate_reasons: [],
    lead_id: leadId,
    row_number: rowNumber,
    checks,
    rerun_status: second.status,
    leads_before: leadsBefore,
    leads_after: leadsAfter,
    state: updated,
  };
}

// --- bounded batch and exception-only imports ---------------------------------

export type BatchImportResult =
  | { status: "blocked"; reasons: ImportGateReason[]; state: ImportAutomationState }
  | { status: "unavailable" }
  | { status: "batch_already_committed" }
  | { status: "ok"; summary: ImportSummary; state: ImportAutomationState };

/** Import exactly one revalidated row, or record why it was held. */
async function importOne(
  client: Client,
  businessId: string,
  batchId: string,
  row: StagedCommitRow,
  mode: ImportMode,
): Promise<RowResult> {
  const manual = row.review?.source === "manual";
  const revalidated = await revalidateCandidate(client, businessId, batchId, row.row_number);
  if (!revalidated.ok) {
    const outcome = revalidated.outcome;
    const reasons: CommitBlockReason[] =
      outcome.status === "blocked"
        ? outcome.reasons
        : outcome.status === "potential_duplicate"
          ? ["potential_duplicate"]
          : outcome.status === "already_committed"
            ? ["already_committed"]
            : [];
    return {
      row_number: row.row_number,
      outcome: outcome.status === "already_committed" ? "already_committed" : "blocked",
      lead_id: outcome.status === "already_committed" ? (outcome.lead_id ?? null) : null,
      idempotency_key: null,
      reasons,
      error: null,
    };
  }

  const { importStagedRowAsLead } = await import("@/lib/import-lead.server");
  const outcome = await importStagedRowAsLead(client, {
    businessId,
    batchId,
    rowNumber: row.row_number,
    idempotencyKey: revalidated.idempotencyKey,
  });

  const base = {
    row_number: row.row_number,
    idempotency_key: revalidated.idempotencyKey,
    reasons: [] as CommitBlockReason[],
  };
  if (outcome.status === "committed") {
    await audit(
      client,
      businessId,
      "crm_import_row_imported",
      {
        batch_id: batchId,
        row_number: row.row_number,
        lead_id: outcome.lead_id,
        idempotency_key: revalidated.idempotencyKey,
        import_mode: mode,
        classification: row.classification?.classification ?? null,
        duplicate_status: row.classification?.duplicate_status ?? null,
        decision_source: manual ? "manual" : "auto",
      },
      { type: "lead", id: outcome.lead_id },
    );
    return {
      ...base,
      outcome: manual ? "manually_imported" : "auto_imported",
      lead_id: outcome.lead_id,
      error: null,
    };
  }
  if (outcome.status === "already_committed") {
    return { ...base, outcome: "already_committed", lead_id: outcome.lead_id ?? null, error: null };
  }
  if (outcome.status === "reconciliation_required") {
    // Stop for this row; never blindly retry a write that already landed.
    return {
      ...base,
      outcome: "reconciliation_required",
      lead_id: outcome.lead_id,
      error: outcome.error,
    };
  }
  return {
    ...base,
    outcome: "failed",
    lead_id: null,
    error: outcome.status === "failed" ? outcome.error : "The row could not be imported.",
  };
}

async function finishRun(
  client: Client,
  businessId: string,
  batchId: string,
  mode: ImportMode,
  rows: StagedCommitRow[],
  results: RowResult[],
  extraPatch: Record<string, unknown> = {},
): Promise<{ summary: ImportSummary; state: ImportAutomationState }> {
  const ranAt = new Date().toISOString();
  // Re-read rows so commit bookkeeping written during the run is reflected.
  const reloaded = (await loadCommitRows(client, businessId, batchId))?.rows ?? rows;
  const summary = buildImportSummary({ mode, batchId, ranAt, rows: reloaded, results });
  const state = await patchState(client, businessId, {
    last_summary: summary as unknown as Record<string, unknown>,
    last_run_at: ranAt,
    ...extraPatch,
  });
  await audit(client, businessId, "crm_import_run_completed", {
    batch_id: batchId,
    import_mode: mode,
    summary,
  });
  return { summary, state };
}

/**
 * Bounded batch: at most three eligible rows, each independently revalidated
 * immediately before its own write. Pending, excluded, invalid-phone and
 * duplicate rows are never touched. Safe to re-run: committed rows return
 * `already_committed` and create nothing.
 */
export async function runBoundedBatch(
  client: Client,
  businessId: string,
  batchId: string,
  rowNumbers: number[],
): Promise<BatchImportResult> {
  const state = await loadAutomationState(client, businessId);
  const requested = [...new Set(rowNumbers)];
  const gate = evaluateBoundedBatchGate(state, requested.length);
  if (!gate.allowed) return { status: "blocked", reasons: gate.reasons, state };

  const loaded = await loadCommitRows(client, businessId, batchId);
  if (!loaded) return { status: "unavailable" };
  if (!loaded.batch.committable) return { status: "batch_already_committed" };

  const selected = limitBoundedBatch(
    loaded.rows.filter((row) => requested.includes(row.row_number)),
  );

  const results: RowResult[] = [];
  for (const row of selected) {
    results.push(await importOne(client, businessId, batchId, row, state.mode));
  }

  const created = results.filter(
    (result) => result.outcome === "auto_imported" || result.outcome === "manually_imported",
  ).length;
  const clean =
    results.length > 0 &&
    results.every(
      (result) =>
        result.outcome === "auto_imported" ||
        result.outcome === "manually_imported" ||
        result.outcome === "already_committed",
    );

  const { summary, state: updated } = await finishRun(
    client,
    businessId,
    batchId,
    state.mode,
    loaded.rows,
    results,
    clean
      ? {
          bounded_batch_passed_at: new Date().toISOString(),
          bounded_batch_batch_id: batchId,
          bounded_batch_imported: created,
          mode_reason: `A bounded batch of ${results.length} rows completed cleanly. Exception-only mode still requires an explicit decision.`,
        }
      : {
          mode_reason:
            "The last bounded batch did not complete cleanly, so exception-only mode stays blocked.",
        },
  );
  return { status: "ok", summary, state: updated };
}

/**
 * Exception-only import: automatically imports every row that passes every
 * commit condition, and leaves anything invalid, uncertain, duplicate, excluded
 * or already committed visible as an exception requiring review.
 */
export async function runExceptionOnlyImport(
  client: Client,
  businessId: string,
  batchId: string,
): Promise<BatchImportResult> {
  const state = await loadAutomationState(client, businessId);
  const gate = evaluateExceptionOnlyGate(state);
  if (!gate.allowed) return { status: "blocked", reasons: gate.reasons, state };

  const loaded = await loadCommitRows(client, businessId, batchId);
  if (!loaded) return { status: "unavailable" };
  if (!loaded.batch.committable) return { status: "batch_already_committed" };

  const { evaluateCommitEligibility } = await import("@/lib/commit-gate");
  const candidates = loaded.rows.filter(
    (row) => evaluateCommitEligibility(batchId, row).eligible,
  );

  const results: RowResult[] = [];
  for (const row of candidates) {
    results.push(await importOne(client, businessId, batchId, row, state.mode));
  }

  const { summary, state: updated } = await finishRun(
    client,
    businessId,
    batchId,
    state.mode,
    loaded.rows,
    results,
  );
  return { status: "ok", summary, state: updated };
}

/** Read-only overview for the rollout status panel. */
export async function loadAutomationOverview(
  client: Client,
  businessId: string,
): Promise<{ state: ImportAutomationState; bounded_batch_max: number }> {
  return {
    state: await loadAutomationState(client, businessId),
    bounded_batch_max: BOUNDED_BATCH_MAX_ROWS,
  };
}

export { commitIdempotencyKey };
