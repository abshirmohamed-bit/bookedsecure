// Pure, client-safe presentation logic for the simple ("Lite") CRM import view.
//
// SAFETY: this module is maths and copy only. It never writes leads,
// conversations, messages, jobs, automation or pipeline state, never calls a
// provider, and never performs IO of any kind. It derives its numbers from the
// SAME shared preview rows and the SAME shared eligibility engine that the
// advanced view uses (`evaluateCommitEligibility`) — there is no second
// validation implementation.

import {
  BOUNDED_BATCH_MAX_ROWS,
  type ImportAutomationState,
  type ImportSummary,
  type RowOutcome,
  type RowResult,
} from "@/lib/import-automation";
import {
  evaluateCommitEligibility,
  readCommitState,
  type CommitBlockReason,
  type CommitEvaluableRow,
} from "@/lib/commit-gate";


export const IMPORT_VIEWS = ["lite", "advanced"] as const;
export type ImportView = (typeof IMPORT_VIEWS)[number];

/** Lite mode is the default experience for every authenticated user. */
export const DEFAULT_IMPORT_VIEW: ImportView = "lite";

export const LITE_VIEW_LABEL = "Simple view";
export const ADVANCED_VIEW_LABEL = "Advanced View";
export const SYNC_ACTION_LABEL = "Sync Eligible Contacts";
export const HELD_HEADLINE = "Some contacts need your review";
export const HELD_SAFETY_COPY =
  "These contacts were held safely so nothing incorrect is added to your CRM.";
export const HELD_NEXT_STEP_COPY =
  "Open Advanced View to correct the affected rows or decide how they should be handled.";
export const LITE_NO_MESSAGES_COPY =
  "Saved contacts are never messaged automatically. You choose if and when to contact them.";
export const EXCEPTION_ANCHOR_ID = "import-exceptions";

/** Technical vocabulary that must never appear in the simple view. */
export const TECHNICAL_TERMS = [
  "commit gate",
  "idempotency",
  "database constraint",
  "raw schema",
  "bounded batch",
  "provider session",
] as const;

export type LiteHoldReason =
  | "needs_phone_fix"
  | "possible_duplicate"
  | "needs_a_check"
  | "you_excluded_it"
  | "already_saved";

export const LITE_HOLD_REASON_LABELS: Record<LiteHoldReason, string> = {
  needs_phone_fix: "Phone number needs a correction",
  possible_duplicate: "Might already be in your CRM",
  needs_a_check: "Some details need a quick check",
  you_excluded_it: "You chose not to save this contact",
  already_saved: "Already saved to your CRM",
};

export type LiteSummary = {
  /** Every staged contact in the upload. */
  total: number;
  /** Contacts that pass every shared check and can be synced. */
  clean: number;
  /** Contacts deliberately held back. Excludes already-saved contacts. */
  held: number;
  /** Held contacts the owner can actually act on in the advanced view. */
  reviewable: number;
  already_saved: number;
  hold_reason_counts: Record<LiteHoldReason, number>;
  /** Row numbers of the clean, eligible candidate set, lowest first. */
  eligible_rows: number[];
};

const EMPTY_REASONS: Record<LiteHoldReason, number> = {
  needs_phone_fix: 0,
  possible_duplicate: 0,
  needs_a_check: 0,
  you_excluded_it: 0,
  already_saved: 0,
};

/** Translate a technical block reason into plain business language. */
export function liteHoldReason(reasons: CommitBlockReason[]): LiteHoldReason {
  if (reasons.includes("already_committed")) return "already_saved";
  if (reasons.includes("invalid_phone")) return "needs_phone_fix";
  if (
    reasons.includes("potential_duplicate") ||
    reasons.includes("duplicate_not_checked") ||
    reasons.includes("duplicate_lookup_error")
  ) {
    return "possible_duplicate";
  }
  if (reasons.includes("excluded")) return "you_excluded_it";
  return "needs_a_check";
}

/**
 * Derive the simple summary from the shared preview rows. Read-only.
 * `clean` is exactly the set the shared eligibility engine would accept, so the
 * simple view can never offer a contact the advanced view would block.
 */
export function buildLiteSummary(batchId: string, rows: CommitEvaluableRow[]): LiteSummary {
  const counts: Record<LiteHoldReason, number> = { ...EMPTY_REASONS };
  const eligible: number[] = [];
  let alreadySaved = 0;

  for (const row of rows) {
    const commit = row.commit ?? readCommitState(null);
    const verdict = evaluateCommitEligibility(batchId, row);
    if (verdict.eligible) {
      eligible.push(row.row_number);
      continue;
    }
    if (commit.status === "committed" || commit.lead_id) {
      alreadySaved += 1;
      counts.already_saved += 1;
      continue;
    }
    counts[liteHoldReason(verdict.reasons)] += 1;
  }

  const held = rows.length - eligible.length - alreadySaved;
  return {
    total: rows.length,
    clean: eligible.length,
    held,
    reviewable: held,
    already_saved: alreadySaved,
    hold_reason_counts: counts,
    eligible_rows: [...eligible].sort((a, b) => a - b),
  };
}

/** Plain-language summary lines shown after validation. */
export function liteSummaryLines(summary: LiteSummary): string[] {
  const lines = [
    `We verified ${summary.total} ${summary.total === 1 ? "contact" : "contacts"}.`,
    `${summary.clean} ${summary.clean === 1 ? "is" : "are"} ready to save.`,
  ];
  if (summary.held > 0) {
    lines.push(
      `${summary.held} ${summary.held === 1 ? "was" : "were"} held safely because ${
        summary.held === 1 ? "it needs" : "they need"
      } review.`,
    );
  }
  if (summary.already_saved > 0) {
    lines.push(
      `${summary.already_saved} ${summary.already_saved === 1 ? "is" : "are"} already in your CRM.`,
    );
  }
  return lines;
}

export type AdvancedHighlight = {
  /** True only while reviewable exceptions remain. */
  highlight: boolean;
  /** Animated when motion is allowed; a static ring otherwise. */
  animated: boolean;
  className: string;
  annotation: string | null;
  ariaLabel: string;
};

const BASE_RING = "ring-2 ring-primary/60";

/**
 * Contextual attention treatment for the Advanced View button. Never an error
 * treatment: held contacts were deliberately protected, not failures.
 */
export function advancedHighlight(input: {
  held: number;
  reducedMotion?: boolean;
}): AdvancedHighlight {
  const held = Math.max(0, Math.trunc(input.held));
  if (held === 0) {
    return {
      highlight: false,
      animated: false,
      className: "",
      annotation: null,
      ariaLabel: `${ADVANCED_VIEW_LABEL} — detailed import controls`,
    };
  }
  const animated = input.reducedMotion !== true;
  return {
    highlight: true,
    animated,
    className: animated ? `${BASE_RING} animate-pulse` : BASE_RING,
    annotation: `${held} ${held === 1 ? "contact needs" : "contacts need"} review in ${ADVANCED_VIEW_LABEL}`,
    ariaLabel: `${ADVANCED_VIEW_LABEL} — ${held} ${held === 1 ? "contact needs" : "contacts need"} review`,
  };
}

export type SyncPath = "bounded" | "exception_only";

/**
 * Choose which EXISTING controlled execution path the simple sync uses. Both
 * paths run the same per-row revalidation, duplicate, idempotency, tenant,
 * rollout and pause checks on the server immediately before each write.
 */
export function chooseSyncPath(eligibleCount: number): SyncPath {
  return eligibleCount <= BOUNDED_BATCH_MAX_ROWS ? "bounded" : "exception_only";
}

export type SyncPlan =
  | { ok: false; reason: "nothing_to_sync" | "paused" | "not_enabled" }
  | { ok: true; path: SyncPath; rowNumbers: number[] };

/**
 * Client-side pre-flight for the simple sync button. Advisory only: the server
 * re-evaluates every gate, so a stale or tampered client cannot widen it.
 */
export function planLiteSync(
  summary: LiteSummary,
  state: ImportAutomationState | null | undefined,
): SyncPlan {
  if (summary.eligible_rows.length === 0) return { ok: false, reason: "nothing_to_sync" };
  if (state?.paused) return { ok: false, reason: "paused" };
  // Fail closed: only the two modes whose server gates permit a batch import.
  if (!state || (state.mode !== "bounded_batch" && state.mode !== "exception_only")) {
    return { ok: false, reason: "not_enabled" };
  }
  const path = chooseSyncPath(summary.eligible_rows.length);
  return {
    ok: true,
    path,
    rowNumbers:
      path === "bounded" ? summary.eligible_rows.slice(0, BOUNDED_BATCH_MAX_ROWS) : summary.eligible_rows,
  };
}

export const SYNC_BLOCK_COPY: Record<
  Extract<SyncPlan, { ok: false }>["reason"],
  string
> = {
  nothing_to_sync: "There are no contacts ready to save from this upload yet.",
  paused: "Saving contacts is paused for your business right now.",
  not_enabled: "Saving contacts to your CRM is not switched on for your business yet.",
};

// --- automated preparation ----------------------------------------------------

/**
 * Plain-language description of the automated preparation the simple view runs
 * for the owner. Every step is an EXISTING verified server step; this list is
 * copy only and performs nothing itself.
 *
 * 1-4 and 7 happen inside `previewCrmImport` -> `previewCrmCsv` (delimiter
 * detection, parsing, column mapping, date parsing, validation).
 * 5-6, 8-10 happen inside `repairCrmImportPhones` -> `repairPreviewBatch`
 * (deterministic phone repair with original-value and reason preservation,
 * revalidation, tenant-scoped duplicate preflight and classification).
 */
export const LITE_PREPARE_STEPS = [
  "Reading your file",
  "Matching your columns",
  "Correcting Australian phone formats",
  "Checking for contacts you already have",
  "Deciding what is safe to save",
] as const;

export const LITE_PREPARE_COPY = "Getting your contacts ready…";
export const LITE_PREPARE_SAFETY_COPY =
  "Your original values are always kept exactly as you uploaded them.";

// --- per-row sync outcomes ----------------------------------------------------

export type LiteSyncOutcome = "saved" | "already_saved" | "held" | "failed";

export const LITE_SYNC_OUTCOME_LABELS: Record<LiteSyncOutcome, string> = {
  saved: "Saved to your CRM",
  already_saved: "Already in your CRM — nothing was added again",
  held: "Held for your review",
  failed: "Could not be saved — safe to try again",
};

/** Translate one existing engine outcome into plain business language. */
export function liteSyncOutcome(outcome: RowOutcome): LiteSyncOutcome {
  switch (outcome) {
    case "auto_imported":
    case "manually_imported":
      return "saved";
    case "already_committed":
      return "already_saved";
    case "failed":
      return "failed";
    // A row that needs human reconciliation is never retried automatically.
    case "reconciliation_required":
      return "held";
    default:
      return "held";
  }
}

/**
 * A failed row may be retried; a saved, already-saved, held or
 * reconciliation-required row may not. Retrying never re-sends a saved row:
 * the shared eligibility engine reports it as `already_committed`, so it is not
 * offered as a candidate again.
 */
export function isLiteRetryable(result: RowResult): boolean {
  return result.outcome === "failed";
}

export type LiteSyncRow = {
  row_number: number;
  outcome: LiteSyncOutcome;
  retryable: boolean;
};

export type LiteSyncReport = {
  saved: number;
  already_saved: number;
  held: number;
  failed: number;
  /** True when at least one row was saved AND at least one row was not. */
  partial_failure: boolean;
  retryable_rows: number[];
  rows: LiteSyncRow[];
};

/**
 * Derive the per-row result display from the EXISTING run summary. Pure: it
 * reads `ImportSummary.rows`, which the server produced through
 * `revalidateCandidate` + `importStagedRowAsLead`.
 */
export function buildLiteSyncReport(summary: ImportSummary): LiteSyncReport {
  const rows: LiteSyncRow[] = summary.rows.map((result) => ({
    row_number: result.row_number,
    outcome: liteSyncOutcome(result.outcome),
    retryable: isLiteRetryable(result),
  }));
  const count = (outcome: LiteSyncOutcome) => rows.filter((row) => row.outcome === outcome).length;
  const saved = count("saved");
  const unresolved = count("held") + count("failed");
  return {
    saved,
    already_saved: count("already_saved"),
    held: count("held"),
    failed: count("failed"),
    partial_failure: saved > 0 && unresolved > 0,
    retryable_rows: rows.filter((row) => row.retryable).map((row) => row.row_number),
    rows,
  };
}

/**
 * Honest headline for a completed sync. Partial failure is never hidden behind
 * a generic success message.
 */
export function liteSyncHeadline(report: LiteSyncReport): string {
  const parts = [`${report.saved} ${report.saved === 1 ? "contact" : "contacts"} saved`];
  if (report.already_saved > 0) parts.push(`${report.already_saved} already in your CRM`);
  if (report.failed > 0) {
    parts.push(`${report.failed} could not be saved and can be tried again`);
  }
  if (report.held > 0) parts.push(`${report.held} still held for your review`);
  return `${parts.join(", ")}.`;
}
