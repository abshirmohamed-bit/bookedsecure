// Pure, client-safe rollout policy for the CRM importer.
//
// SAFETY: this module is state maths and copy only. It never writes leads,
// conversations, messages, notifications, jobs, automation or pipeline state,
// and it never calls a messaging provider. It decides ONLY whether a tenant is
// allowed to perform an import at all, and how a completed import is summarised.

import {
  DEFAULT_COMMIT_STATE,
  evaluateCommitEligibility,
  type CommitBlockReason,
  type CommitEvaluableRow,
} from "@/lib/commit-gate";
import { isEligibleMobile } from "@/lib/row-review";

export const IMPORT_MODES = [
  "disabled",
  "preview_only",
  "canary_ready",
  "bounded_batch",
  "exception_only",
] as const;
export type ImportMode = (typeof IMPORT_MODES)[number];

/** Every tenant starts here. `exception_only` is never reached implicitly. */
export const DEFAULT_IMPORT_MODE: ImportMode = "preview_only";

/** Hard ceiling for the first live batch after the canary. */
export const BOUNDED_BATCH_MAX_ROWS = 3;

export const IMPORT_MODE_LABELS: Record<ImportMode, string> = {
  disabled: "Disabled",
  preview_only: "Preview only",
  canary_ready: "Canary ready",
  bounded_batch: "Bounded batch",
  exception_only: "Exception only",
};

export const IMPORT_MODE_DESCRIPTIONS: Record<ImportMode, string> = {
  disabled: "No previewing, classification or importing runs for this business.",
  preview_only:
    "Uploads are parsed, staged, validated and classified. Nothing is written to live leads.",
  canary_ready:
    "One single eligible row may be imported as a verified canary. No batch importing is available.",
  bounded_batch: `The canary passed, so a bounded batch of at most ${BOUNDED_BATCH_MAX_ROWS} eligible rows may be imported.`,
  exception_only:
    "Clean rows import automatically through the import-only path. Everything uncertain is held for review.",
};

export type ImportAutomationState = {
  mode: ImportMode;
  mode_reason: string | null;
  paused: boolean;
  canary_passed_at: string | null;
  canary_batch_id: string | null;
  canary_row_number: number | null;
  canary_lead_id: string | null;
  idempotency_verified_at: string | null;
  bounded_batch_passed_at: string | null;
  bounded_batch_batch_id: string | null;
  bounded_batch_imported: number;
  exception_only_enabled_at: string | null;
  last_summary: ImportSummary | null;
  last_run_at: string | null;
};

export const DEFAULT_IMPORT_AUTOMATION_STATE: ImportAutomationState = {
  mode: DEFAULT_IMPORT_MODE,
  mode_reason: "Default state for a new business. Nothing has been imported yet.",
  paused: false,
  canary_passed_at: null,
  canary_batch_id: null,
  canary_row_number: null,
  canary_lead_id: null,
  idempotency_verified_at: null,
  bounded_batch_passed_at: null,
  bounded_batch_batch_id: null,
  bounded_batch_imported: 0,
  exception_only_enabled_at: null,
  last_summary: null,
  last_run_at: null,
};

function isMode(value: unknown): value is ImportMode {
  return IMPORT_MODES.includes(value as ImportMode);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Read persisted rollout state. Unknown or missing values fail safe. */
export function readImportAutomationState(row: unknown): ImportAutomationState {
  const raw = (row ?? {}) as Record<string, unknown>;
  if (!row) return { ...DEFAULT_IMPORT_AUTOMATION_STATE };
  return {
    mode: isMode(raw["mode"]) ? raw["mode"] : DEFAULT_IMPORT_MODE,
    mode_reason: str(raw["mode_reason"]),
    paused: raw["paused"] === true,
    canary_passed_at: str(raw["canary_passed_at"]),
    canary_batch_id: str(raw["canary_batch_id"]),
    canary_row_number:
      typeof raw["canary_row_number"] === "number" ? (raw["canary_row_number"] as number) : null,
    canary_lead_id: str(raw["canary_lead_id"]),
    idempotency_verified_at: str(raw["idempotency_verified_at"]),
    bounded_batch_passed_at: str(raw["bounded_batch_passed_at"]),
    bounded_batch_batch_id: str(raw["bounded_batch_batch_id"]),
    bounded_batch_imported:
      typeof raw["bounded_batch_imported"] === "number"
        ? (raw["bounded_batch_imported"] as number)
        : 0,
    exception_only_enabled_at: str(raw["exception_only_enabled_at"]),
    last_summary: (raw["last_summary"] as ImportSummary | null) ?? null,
    last_run_at: str(raw["last_run_at"]),
  };
}

export const canaryPassed = (state: ImportAutomationState): boolean =>
  Boolean(state.canary_passed_at && state.canary_lead_id);
export const idempotencyVerified = (state: ImportAutomationState): boolean =>
  Boolean(state.idempotency_verified_at);
export const boundedBatchPassed = (state: ImportAutomationState): boolean =>
  Boolean(state.bounded_batch_passed_at);

// --- deliberate mode transitions ---------------------------------------------

export const MODE_TRANSITION_REASONS = [
  "unknown_mode",
  "not_the_next_step",
  "canary_not_passed",
  "idempotency_not_verified",
  "bounded_batch_not_passed",
] as const;
export type ModeTransitionReason = (typeof MODE_TRANSITION_REASONS)[number];

export const MODE_TRANSITION_LABELS: Record<ModeTransitionReason, string> = {
  unknown_mode: "That import mode does not exist.",
  not_the_next_step:
    "Import modes advance one deliberate step at a time: preview only → canary ready → bounded batch → exception only.",
  canary_not_passed: "The one-row canary import has not been verified yet.",
  idempotency_not_verified: "Re-running the canary has not been verified as creating no duplicate.",
  bounded_batch_not_passed: "A bounded batch has not been verified yet.",
};

export type TransitionResult =
  { ok: true; mode: ImportMode; reason: string } | { ok: false; reasons: ModeTransitionReason[] };

/**
 * Deliberate, one-step-at-a-time transitions. Anything can be turned off, and
 * `disabled` can only resume at `preview_only` — no shortcut to automation.
 */
export function evaluateModeTransition(
  state: ImportAutomationState,
  next: unknown,
): TransitionResult {
  if (!isMode(next)) return { ok: false, reasons: ["unknown_mode"] };
  if (next === "disabled") {
    return { ok: true, mode: next, reason: "Turned off by the business owner." };
  }
  if (state.mode === "disabled") {
    if (next !== "preview_only") return { ok: false, reasons: ["not_the_next_step"] };
    return { ok: true, mode: next, reason: "Re-enabled at preview only by the business owner." };
  }
  if (next === state.mode) {
    return { ok: true, mode: next, reason: state.mode_reason ?? "Unchanged." };
  }

  const order = ["preview_only", "canary_ready", "bounded_batch", "exception_only"] as const;
  const from = order.indexOf(state.mode as (typeof order)[number]);
  const to = order.indexOf(next as (typeof order)[number]);
  // Stepping back down is always allowed; stepping up is one step at a time.
  if (to < from) {
    return { ok: true, mode: next, reason: "Stepped back by the business owner." };
  }
  if (to !== from + 1) return { ok: false, reasons: ["not_the_next_step"] };

  const reasons: ModeTransitionReason[] = [];
  if (next === "bounded_batch" || next === "exception_only") {
    if (!canaryPassed(state)) reasons.push("canary_not_passed");
    if (!idempotencyVerified(state)) reasons.push("idempotency_not_verified");
  }
  if (next === "exception_only" && !boundedBatchPassed(state)) {
    reasons.push("bounded_batch_not_passed");
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const copy: Record<string, string> = {
    canary_ready: "Enabled by the business owner so a single canary row can be imported.",
    bounded_batch: `Enabled by the business owner after the verified canary. Limited to ${BOUNDED_BATCH_MAX_ROWS} rows per batch.`,
    exception_only: "Enabled explicitly by the business owner after a verified bounded batch.",
  };
  return { ok: true, mode: next, reason: copy[next] ?? "Changed by the business owner." };
}

// --- import permission gates -------------------------------------------------

export const IMPORT_GATE_REASONS = [
  "paused",
  "mode_disabled",
  "preview_only_mode",
  "canary_not_passed",
  "idempotency_not_verified",
  "bounded_batch_not_passed",
  "mode_not_bounded_batch",
  "mode_not_exception_only",
  "row_limit_exceeded",
  "no_rows_selected",
] as const;
export type ImportGateReason = (typeof IMPORT_GATE_REASONS)[number];

export const IMPORT_GATE_LABELS: Record<ImportGateReason, string> = {
  paused: "Automatic imports are paused for this business.",
  mode_disabled: "CRM importing is turned off for this business.",
  preview_only_mode:
    "This business is in preview-only mode, so nothing can be written to live leads.",
  canary_not_passed: "The verified one-row canary import has not passed yet.",
  idempotency_not_verified: "Canary re-run safety has not been verified yet.",
  bounded_batch_not_passed: "A bounded batch has not been verified yet.",
  mode_not_bounded_batch: "Bounded batch importing is not enabled for this business.",
  mode_not_exception_only: "Exception-only importing is not enabled for this business.",
  row_limit_exceeded: `A bounded batch may import at most ${BOUNDED_BATCH_MAX_ROWS} rows.`,
  no_rows_selected: "No eligible rows were selected.",
};

export type GateResult = { allowed: boolean; reasons: ImportGateReason[] };

/** Canary: exactly one row, only in `canary_ready` or later, never when paused. */
export function evaluateCanaryGate(state: ImportAutomationState): GateResult {
  const reasons: ImportGateReason[] = [];
  if (state.paused) reasons.push("paused");
  if (state.mode === "disabled") reasons.push("mode_disabled");
  if (state.mode === "preview_only") reasons.push("preview_only_mode");
  return { allowed: reasons.length === 0, reasons };
}

/** Bounded batch: capped at three rows and only after a verified canary. */
export function evaluateBoundedBatchGate(
  state: ImportAutomationState,
  requestedRows: number,
): GateResult {
  const reasons: ImportGateReason[] = [];
  if (state.paused) reasons.push("paused");
  if (state.mode === "disabled") reasons.push("mode_disabled");
  if (state.mode === "preview_only") reasons.push("preview_only_mode");
  if (state.mode === "canary_ready") reasons.push("mode_not_bounded_batch");
  if (!canaryPassed(state)) reasons.push("canary_not_passed");
  if (!idempotencyVerified(state)) reasons.push("idempotency_not_verified");
  if (requestedRows <= 0) reasons.push("no_rows_selected");
  if (requestedRows > BOUNDED_BATCH_MAX_ROWS) reasons.push("row_limit_exceeded");
  return { allowed: reasons.length === 0, reasons };
}

/** Exception-only automatic import: the strictest gate. */
export function evaluateExceptionOnlyGate(state: ImportAutomationState): GateResult {
  const reasons: ImportGateReason[] = [];
  if (state.paused) reasons.push("paused");
  if (state.mode === "disabled") reasons.push("mode_disabled");
  if (state.mode !== "exception_only") reasons.push("mode_not_exception_only");
  if (!canaryPassed(state)) reasons.push("canary_not_passed");
  if (!idempotencyVerified(state)) reasons.push("idempotency_not_verified");
  if (!boundedBatchPassed(state)) reasons.push("bounded_batch_not_passed");
  return { allowed: reasons.length === 0, reasons };
}

/** Truncate a candidate list to the bounded-batch ceiling, lowest row first. */
export function limitBoundedBatch<T extends { row_number: number }>(candidates: T[]): T[] {
  return [...candidates]
    .sort((a, b) => a.row_number - b.row_number)
    .slice(0, BOUNDED_BATCH_MAX_ROWS);
}

// --- per-row outcomes and durable summary ------------------------------------

export const ROW_OUTCOMES = [
  "auto_imported",
  "manually_imported",
  "already_committed",
  "pending",
  "excluded",
  "blocked",
  "failed",
  "reconciliation_required",
] as const;
export type RowOutcome = (typeof ROW_OUTCOMES)[number];

/** Deliberately avoids the word "include": only these two created a live lead. */
export const ROW_OUTCOME_LABELS: Record<RowOutcome, string> = {
  auto_imported: "Auto-imported (live lead created)",
  manually_imported: "Manually imported (live lead created)",
  already_committed: "Already committed — nothing created",
  pending: "Pending review",
  excluded: "Excluded",
  blocked: "Blocked",
  failed: "Failed",
  reconciliation_required: "Reconciliation required",
};

export type RowResult = {
  row_number: number;
  outcome: RowOutcome;
  lead_id: string | null;
  idempotency_key: string | null;
  reasons: CommitBlockReason[];
  error: string | null;
};

export type ImportSummary = {
  mode: ImportMode;
  batch_id: string;
  ran_at: string;
  total_uploaded: number;
  auto_imported: number;
  manually_imported: number;
  already_committed: number;
  pending_review: number;
  potential_duplicates: number;
  duplicate_lookup_unavailable: number;
  invalid_phones: number;
  non_mobile_phones: number;
  excluded_rows: number;
  failed_rows: number;
  reconciliation_required_rows: number;
  /** Invariants of the import-only path. Every one of these must stay 0. */
  conversations_created: 0;
  sms_sent: 0;
  emails_sent: 0;
  owner_alerts: 0;
  jobs_created: 0;
  pipeline_changes: 0;
  automation_runs: 0;
  provider_calls: 0;
  rows: RowResult[];
};

/**
 * Build the durable post-import summary. Pure: it reports what the import-only
 * path did, and hard-codes the side-effect counters to zero because that path
 * structurally cannot create conversations, messages, alerts, jobs, pipeline
 * changes, automation runs or provider calls.
 */
export function buildImportSummary(input: {
  mode: ImportMode;
  batchId: string;
  ranAt: string;
  rows: CommitEvaluableRow[];
  results: RowResult[];
}): ImportSummary {
  const { rows, results } = input;
  const byRow = new Map(results.map((result) => [result.row_number, result]));
  const outcomeOf = (row: CommitEvaluableRow): RowOutcome => {
    const recorded = byRow.get(row.row_number);
    if (recorded) return recorded.outcome;
    const commit = row.commit ?? DEFAULT_COMMIT_STATE;
    if (commit.reconciliation_required) return "reconciliation_required";
    if (commit.status === "committed" || commit.lead_id) return "already_committed";
    if (commit.status === "failed") return "failed";
    if (row.review?.decision === "exclude") return "excluded";
    if (row.review?.decision === "pending") return "pending";
    return "blocked";
  };
  const count = (outcome: RowOutcome) => rows.filter((row) => outcomeOf(row) === outcome).length;

  const blockedFor = (reason: CommitBlockReason) =>
    rows.filter((row) => {
      const recorded = byRow.get(row.row_number);
      const reasons = recorded?.reasons?.length
        ? recorded.reasons
        : evaluateCommitEligibility(input.batchId, row).reasons;
      return reasons.includes(reason);
    }).length;

  return {
    mode: input.mode,
    batch_id: input.batchId,
    ran_at: input.ranAt,
    total_uploaded: rows.length,
    auto_imported: results.filter((result) => result.outcome === "auto_imported").length,
    manually_imported: results.filter((result) => result.outcome === "manually_imported").length,
    already_committed: count("already_committed"),
    pending_review: count("pending"),
    potential_duplicates: blockedFor("potential_duplicate"),
    duplicate_lookup_unavailable:
      blockedFor("duplicate_not_checked") + blockedFor("duplicate_lookup_error"),
    invalid_phones: rows.filter((row) => !isEligibleMobile(row.mobile_number)).length,
    non_mobile_phones: rows.filter(
      (row) =>
        Boolean(row.mobile_number) &&
        !isEligibleMobile(row.mobile_number) &&
        !row.validation_errors.some((issue) => issue.code === "invalid_phone"),
    ).length,
    excluded_rows: count("excluded"),
    failed_rows: count("failed"),
    reconciliation_required_rows: count("reconciliation_required"),
    conversations_created: 0,
    sms_sent: 0,
    emails_sent: 0,
    owner_alerts: 0,
    jobs_created: 0,
    pipeline_changes: 0,
    automation_runs: 0,
    provider_calls: 0,
    rows: results,
  };
}

/** Plain-language explanation of why the current mode is active. */
export function modeExplanation(state: ImportAutomationState): string {
  if (state.paused) {
    return `${IMPORT_MODE_LABELS[state.mode]}, but automatic imports are paused. Uploads can still be previewed and classified; nothing is written to live leads until you resume.`;
  }
  return state.mode_reason ?? IMPORT_MODE_DESCRIPTIONS[state.mode];
}
