// Pure, client-safe row-review + dry-run helpers for the preview-only CRM importer.
// This module NEVER writes leads, conversations, messages, jobs or automation,
// and never calls a messaging provider. Review state lives inside the staging
// row's normalized_payload (preview-only), so the legacy `decision` column keeps
// its existing `pending` value untouched.

export const ROW_DECISIONS = ["pending", "include", "exclude"] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

export const EXCLUSION_REASONS = [
  "invalid_phone",
  "not_mobile",
  "duplicate",
  "bad_data",
  "not_relevant",
  "manually_excluded",
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABELS: Record<ExclusionReason, string> = {
  invalid_phone: "Invalid phone",
  not_mobile: "Not a mobile number",
  duplicate: "Duplicate",
  bad_data: "Bad data",
  not_relevant: "Not relevant",
  manually_excluded: "Manually excluded",
};

export const DRY_RUN_LABEL = "DRY RUN ONLY — NO LIVE DATA WILL CHANGE";

/** Validation codes that make a row's phone unusable for SMS. */
export const PHONE_ISSUE_CODES = [
  "invalid_phone",
  "unsupported_phone_type",
  "missing_phone_and_email",
] as const;

export type RowReview = { decision: RowDecision; exclusion_reason: ExclusionReason | null };

export const DEFAULT_REVIEW: RowReview = { decision: "pending", exclusion_reason: null };

export type ReviewableRow = {
  row_number: number;
  mobile_number: string | null;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  review: RowReview;
};

export class RowDecisionError extends Error {}

function isDecision(value: unknown): value is RowDecision {
  return ROW_DECISIONS.includes(value as RowDecision);
}

export function isExclusionReason(value: unknown): value is ExclusionReason {
  return EXCLUSION_REASONS.includes(value as ExclusionReason);
}

/** Read review state out of a staged normalized_payload; defaults to pending. */
export function readReview(payload: unknown): RowReview {
  const raw = (payload as { review?: unknown } | null)?.review as
    | { decision?: unknown; exclusion_reason?: unknown }
    | undefined;
  if (!raw || !isDecision(raw.decision)) return { ...DEFAULT_REVIEW };
  return {
    decision: raw.decision,
    exclusion_reason:
      raw.decision === "exclude" && isExclusionReason(raw.exclusion_reason)
        ? raw.exclusion_reason
        : null,
  };
}

/** True when the row's phone cannot be used (invalid, non-mobile or absent). */
export function hasPhoneIssue(row: Pick<ReviewableRow, "mobile_number" | "validation_errors">): boolean {
  if (row.validation_errors.some((issue) => (PHONE_ISSUE_CODES as readonly string[]).includes(issue.code))) {
    return true;
  }
  return !isEligibleMobile(row.mobile_number);
}

/** Valid Australian mobile in E.164 form. */
export function isEligibleMobile(mobile: string | null): boolean {
  return Boolean(mobile && /^\+614\d{8}$/.test(mobile));
}

export function hasExistingDuplicate(
  row: Pick<ReviewableRow, "dedupe_match_lead_id" | "duplicate_of_row">,
): boolean {
  return Boolean(row.dedupe_match_lead_id) || row.duplicate_of_row !== null;
}

/**
 * Validate a requested decision change for one row. Rows with phone issues can
 * never become `include` — they stay pending or are manually excluded. Excluded
 * rows must carry one of the allowed reasons.
 */
export function resolveDecisionChange(
  row: Pick<ReviewableRow, "mobile_number" | "validation_errors">,
  next: { decision: unknown; exclusion_reason?: unknown },
): RowReview {
  if (!isDecision(next.decision)) throw new RowDecisionError("Unknown row decision.");
  if (next.decision === "include" && hasPhoneIssue(row)) {
    throw new RowDecisionError(
      "This row has a phone issue, so it cannot be included. Leave it pending or exclude it.",
    );
  }
  if (next.decision === "exclude") {
    if (!isExclusionReason(next.exclusion_reason)) {
      throw new RowDecisionError("Choose a reason for excluding this row.");
    }
    return { decision: "exclude", exclusion_reason: next.exclusion_reason };
  }
  return { decision: next.decision, exclusion_reason: null };
}

export type DryRunSummary = {
  label: typeof DRY_RUN_LABEL;
  total_rows: number;
  pending_rows: number;
  included_rows: number;
  excluded_rows: number;
  included_with_phone_issues: number;
  included_with_valid_au_mobile: number;
  potential_existing_duplicates: number;
  would_skip_as_duplicate: number;
  would_block_sms_phone_ineligible: number;
};

/** Compute a dry-run summary. Read-only: no writes, no provider calls. */
export function buildDryRunSummary(input: ReviewableRow[]): DryRunSummary {
  // Older staged rows (and cached responses) may not carry a review object yet,
  // so normalize to the default `pending` review before counting.
  const rows = input.map((row) => ({
    ...row,
    review: row.review?.decision ? row.review : { ...DEFAULT_REVIEW },
  }));
  const included = rows.filter((row) => row.review.decision === "include");

  return {
    label: DRY_RUN_LABEL,
    total_rows: rows.length,
    pending_rows: rows.filter((row) => row.review.decision === "pending").length,
    included_rows: included.length,
    excluded_rows: rows.filter((row) => row.review.decision === "exclude").length,
    included_with_phone_issues: included.filter((row) => hasPhoneIssue(row)).length,
    included_with_valid_au_mobile: included.filter((row) => isEligibleMobile(row.mobile_number)).length,
    potential_existing_duplicates: rows.filter((row) => Boolean(row.dedupe_match_lead_id)).length,
    would_skip_as_duplicate: included.filter((row) => hasExistingDuplicate(row)).length,
    would_block_sms_phone_ineligible: included.filter((row) => !isEligibleMobile(row.mobile_number)).length,
  };
}
