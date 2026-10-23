// Pure, client-safe commit-gate helpers for the CRM importer.
//
// SAFETY: this module is read-only maths. It never writes leads, conversations,
// messages, jobs, automation or pipeline state, and never calls a provider.
// It only decides which staged preview rows *would* be eligible for a live
// commit, and builds the commit simulation that the UI renders.

import {
  DEFAULT_CLASSIFICATION,
  DEFAULT_REVIEW,
  isEligibleMobile,
  type ClassificationReason,
  type RowClassification,
  type RowReview,
} from "@/lib/row-review";

export const COMMIT_SIMULATION_LABEL = "SIMULATE COMMIT. NO LIVE DATA WILL CHANGE";
export const CANARY_LABEL = "IMPORT ONE CANARY LEAD";
export const SIMULATION_WARNING =
  "Simulation only. No leads are created, no messages are sent and no live data changes.";

/** Batch statuses that may still be committed from (uncommitted staging only). */
export const COMMITTABLE_BATCH_STATUSES = ["uploaded", "previewed"] as const;

export const COMMIT_STATUSES = ["not_committed", "committed", "failed"] as const;
export type CommitStatus = (typeof COMMIT_STATUSES)[number];

export type RowCommitState = {
  status: CommitStatus;
  idempotency_key: string | null;
  lead_id: string | null;
  committed_at: string | null;
  attempted_at: string | null;
  error: string | null;
  /** True when a live lead exists but preview bookkeeping could not be saved. */
  reconciliation_required: boolean;
};

export const DEFAULT_COMMIT_STATE: RowCommitState = {
  status: "not_committed",
  idempotency_key: null,
  lead_id: null,
  committed_at: null,
  attempted_at: null,
  error: null,
  reconciliation_required: false,
};

/**
 * Deterministic source-row identity. Derived only from the batch id and the
 * stable staged row number, so the same source row always yields the same key.
 */
export function commitIdempotencyKey(batchId: string, rowNumber: number): string {
  if (!batchId || !Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("A commit idempotency key needs a batch id and a positive row number.");
  }
  return `crm-import:${batchId}:row:${rowNumber}`;
}

export function readCommitState(payload: unknown): RowCommitState {
  const raw = (payload as { commit?: unknown } | null)?.commit as
    | Partial<RowCommitState>
    | undefined;
  if (!raw) return { ...DEFAULT_COMMIT_STATE };
  const status = (COMMIT_STATUSES as readonly string[]).includes(raw.status as string)
    ? (raw.status as CommitStatus)
    : "not_committed";
  return {
    status,
    idempotency_key: typeof raw.idempotency_key === "string" ? raw.idempotency_key : null,
    lead_id: typeof raw.lead_id === "string" ? raw.lead_id : null,
    committed_at: typeof raw.committed_at === "string" ? raw.committed_at : null,
    attempted_at: typeof raw.attempted_at === "string" ? raw.attempted_at : null,
    error: typeof raw.error === "string" ? raw.error : null,
    reconciliation_required: raw.reconciliation_required === true,
  };
}

export const COMMIT_BLOCK_REASONS = [
  "pending",
  "excluded",
  "invalid_phone",
  "validation_issues",
  "duplicate_not_checked",
  "potential_duplicate",
  "duplicate_lookup_error",
  "already_committed",
  "previous_attempt_failed",
  "manual_review_required",
  "missing_idempotency_key",
  "batch_already_committed",
  "foreign_tenant",
  "row_not_found",
  "state_changed",
  "unsafe_lead_creation_path",
] as const;
export type CommitBlockReason = (typeof COMMIT_BLOCK_REASONS)[number];

export const COMMIT_BLOCK_LABELS: Record<CommitBlockReason, string> = {
  pending: "Still pending review",
  excluded: "Manually excluded",
  invalid_phone: "No valid Australian mobile",
  validation_issues: "Unresolved validation issues",
  duplicate_not_checked: "Duplicate status not checked",
  potential_duplicate: "Potential duplicate of an existing lead",
  duplicate_lookup_error: "Duplicate lookup error",
  already_committed: "Already committed",
  previous_attempt_failed: "A previous commit attempt failed",
  manual_review_required: "Classification still requires manual review",
  missing_idempotency_key: "Missing source-row idempotency key",
  batch_already_committed: "This upload has already been committed",
  foreign_tenant: "Row does not belong to this business",
  row_not_found: "Row no longer exists",
  state_changed: "Row state changed since the simulation",
  unsafe_lead_creation_path: "Lead creation path has unproven downstream side effects",
};

/** Classification reasons that permanently disqualify a row from committing. */
const HARD_CLASSIFICATION_REASONS: ClassificationReason[] = [
  "invalid_phone",
  "not_mobile",
  "missing_phone",
  "invalid_email",
  "missing_name",
  "potential_duplicate",
  "duplicate_check_unavailable",
  "duplicate_lookup_error",
  "uncertain_data",
];

export type CommitEvaluableRow = {
  row_number: number;
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  review?: RowReview | null;
  classification?: RowClassification | null;
  commit?: RowCommitState | null;
};

export type CommitEligibility = {
  row_number: number;
  eligible: boolean;
  idempotency_key: string | null;
  reasons: CommitBlockReason[];
};

/**
 * Read-only eligibility calculation for exactly one staged row. Tenant and batch
 * ownership are enforced by the caller (server-side) before this runs.
 */
export function evaluateCommitEligibility(
  batchId: string,
  row: CommitEvaluableRow,
): CommitEligibility {
  const review = row.review?.decision ? row.review : { ...DEFAULT_REVIEW };
  const classification = row.classification?.classification
    ? row.classification
    : { ...DEFAULT_CLASSIFICATION };
  const commit = row.commit ?? { ...DEFAULT_COMMIT_STATE };
  const reasons: CommitBlockReason[] = [];

  if (commit.status === "committed" || commit.lead_id) reasons.push("already_committed");
  if (commit.status === "failed") reasons.push("previous_attempt_failed");
  if (review.decision === "pending") reasons.push("pending");
  if (review.decision === "exclude") reasons.push("excluded");
  if (!isEligibleMobile(row.mobile_number)) reasons.push("invalid_phone");
  if (row.validation_errors.length > 0) reasons.push("validation_issues");
  if (classification.duplicate_status === "not_checked") reasons.push("duplicate_not_checked");
  if (classification.duplicate_status === "potential_duplicate") reasons.push("potential_duplicate");
  if (classification.duplicate_status === "lookup_error") reasons.push("duplicate_lookup_error");
  if (row.dedupe_match_lead_id || row.duplicate_of_row !== null) {
    if (!reasons.includes("potential_duplicate")) reasons.push("potential_duplicate");
  }
  if (classification.classification_reasons.some((r) => HARD_CLASSIFICATION_REASONS.includes(r))) {
    reasons.push("manual_review_required");
  }

  let key: string | null = null;
  try {
    key = commitIdempotencyKey(batchId, row.row_number);
  } catch {
    key = null;
  }
  if (!key) reasons.push("missing_idempotency_key");

  return {
    row_number: row.row_number,
    eligible: reasons.length === 0,
    idempotency_key: key,
    reasons,
  };
}

export type SimulatedCandidate = {
  row_number: number;
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  idempotency_key: string;
  /** Whether the include decision came from the classifier or a person. */
  source: "auto" | "manual";
};

export type CommitSimulation = {
  label: typeof COMMIT_SIMULATION_LABEL;
  warning: typeof SIMULATION_WARNING;
  batch_id: string;
  total_rows: number;
  total_candidates: number;
  would_create: number;
  blocked_by_validation: number;
  blocked_by_duplicate_status: number;
  already_committed: number;
  skipped_pending: number;
  skipped_excluded: number;
  previous_failures: number;
  candidates: SimulatedCandidate[];
  blocked: { row_number: number; reasons: CommitBlockReason[] }[];
};

/** Build the commit simulation. Pure: no writes, no provider calls. */
export function buildCommitSimulation(
  batchId: string,
  rows: CommitEvaluableRow[],
): CommitSimulation {
  const evaluated = rows.map((row) => ({ row, result: evaluateCommitEligibility(batchId, row) }));
  const candidates = evaluated.filter((entry) => entry.result.eligible);
  const blocked = evaluated.filter((entry) => !entry.result.eligible);
  const count = (reason: CommitBlockReason) =>
    blocked.filter((entry) => entry.result.reasons.includes(reason)).length;

  return {
    label: COMMIT_SIMULATION_LABEL,
    warning: SIMULATION_WARNING,
    batch_id: batchId,
    total_rows: rows.length,
    total_candidates: candidates.length,
    would_create: candidates.length,
    blocked_by_validation: blocked.filter((entry) =>
      entry.result.reasons.some((reason) =>
        (["validation_issues", "invalid_phone", "manual_review_required"] as CommitBlockReason[]).includes(
          reason,
        ),
      ),
    ).length,
    blocked_by_duplicate_status: blocked.filter((entry) =>
      entry.result.reasons.some((reason) =>
        (
          ["potential_duplicate", "duplicate_not_checked", "duplicate_lookup_error"] as CommitBlockReason[]
        ).includes(reason),
      ),
    ).length,
    already_committed: count("already_committed"),
    skipped_pending: count("pending"),
    skipped_excluded: count("excluded"),
    previous_failures: count("previous_attempt_failed"),
    candidates: candidates.map((entry) => ({
      row_number: entry.row.row_number,
      name: entry.row.name,
      mobile_number: entry.row.mobile_number,
      email: entry.row.email,
      idempotency_key: entry.result.idempotency_key!,
      source: entry.row.review?.source === "manual" ? "manual" : "auto",
    })),
    blocked: blocked.map((entry) => ({
      row_number: entry.row.row_number,
      reasons: entry.result.reasons,
    })),
  };
}

export type CanaryOutcome =
  | { status: "blocked"; reasons: CommitBlockReason[]; detail: string }
  | { status: "already_committed"; row_number: number; lead_id: string | null }
  | { status: "potential_duplicate"; row_number: number; existing_lead_id: string }
  | { status: "committed"; row_number: number; lead_id: string; idempotency_key: string }
  | { status: "failed"; row_number: number; error: string }
  | { status: "reconciliation_required"; row_number: number; lead_id: string; error: string };

/** Row status shown in the UI. `include` never means "imported". */
export function rowCommitLabel(row: CommitEvaluableRow, batchId: string): string {
  const commit = row.commit ?? { ...DEFAULT_COMMIT_STATE };
  if (commit.reconciliation_required) return "Reconciliation required";
  if (commit.status === "committed") return "Canary imported";
  if (commit.status === "failed") return "Failed";
  const result = evaluateCommitEligibility(batchId, row);
  if (result.eligible) {
    return row.review?.source === "manual"
      ? "Manually included candidate"
      : "Auto-included candidate";
  }
  if (result.reasons.includes("excluded")) return "Excluded";
  if (result.reasons.includes("pending")) return "Pending";
  return "Blocked";
}
