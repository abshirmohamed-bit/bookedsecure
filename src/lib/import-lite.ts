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
  if (!state || state.mode === "disabled" || state.mode === "preview_only") {
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
