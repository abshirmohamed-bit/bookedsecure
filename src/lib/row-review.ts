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

export type ReviewSource = "auto" | "manual";

export type RowReview = {
  decision: RowDecision;
  exclusion_reason: ExclusionReason | null;
  /** Whether the decision came from the classifier or from a person. */
  source?: ReviewSource;
};

export const DEFAULT_REVIEW: RowReview = {
  decision: "pending",
  exclusion_reason: null,
  source: "auto",
};

export type ReviewableRow = {
  row_number: number;
  mobile_number: string | null;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  review: RowReview;
  classification?: RowClassification;
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
    | { decision?: unknown; exclusion_reason?: unknown; source?: unknown }
    | undefined;
  if (!raw || !isDecision(raw.decision)) return { ...DEFAULT_REVIEW };
  // Legacy rows carry no source. A recorded non-pending decision is treated as
  // manual so the classifier can never overwrite it.
  const source: ReviewSource =
    raw.source === "auto" || raw.source === "manual"
      ? raw.source
      : raw.decision === "pending"
        ? "auto"
        : "manual";
  return {
    decision: raw.decision,
    exclusion_reason:
      raw.decision === "exclude" && isExclusionReason(raw.exclusion_reason)
        ? raw.exclusion_reason
        : null,
    source,
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
    return { decision: "exclude", exclusion_reason: next.exclusion_reason, source: "manual" };
  }
  return { decision: next.decision, exclusion_reason: null, source: "manual" };
}

// --- automated preview classification ----------------------------------------
// Deterministic, pure and preview-only. It decides ONLY whether a staged row is
// eligible for the dry-run candidate set. `include` never means "create or
// update this lead" — the live import remains a separate future feature.

export const CLASSIFIER_VERSION = "preview-classifier-v1";

export const DUPLICATE_STATUSES = [
  "not_checked",
  "checked_no_match",
  "potential_duplicate",
  "lookup_error",
] as const;
export type DuplicateStatus = (typeof DUPLICATE_STATUSES)[number];

export const DUPLICATE_STATUS_LABELS: Record<DuplicateStatus, string> = {
  not_checked: "Not checked",
  checked_no_match: "Checked — no match",
  potential_duplicate: "Potential duplicate",
  lookup_error: "Lookup error",
};

export const CLASSIFICATION_REASONS = [
  "clean_eligible",
  "invalid_phone",
  "not_mobile",
  "missing_phone",
  "invalid_email",
  "missing_email",
  "missing_name",
  "potential_duplicate",
  "duplicate_check_unavailable",
  "duplicate_lookup_error",
  "uncertain_data",
] as const;
export type ClassificationReason = (typeof CLASSIFICATION_REASONS)[number];

export const CLASSIFICATION_REASON_LABELS: Record<ClassificationReason, string> = {
  clean_eligible: "Clean and eligible",
  invalid_phone: "Invalid phone",
  not_mobile: "Not a mobile number",
  missing_phone: "Missing phone",
  invalid_email: "Invalid email",
  missing_email: "Missing email",
  missing_name: "Missing name",
  potential_duplicate: "Potential duplicate of an existing lead",
  duplicate_check_unavailable: "Duplicate lookup unavailable",
  duplicate_lookup_error: "Duplicate lookup error",
  uncertain_data: "Uncertain or malformed data",
};

export type RowClassification = {
  classification: "auto_include" | "manual_review";
  classification_reasons: ClassificationReason[];
  duplicate_status: DuplicateStatus;
  classified_at: string;
  classifier_version: string;
};

/** Safe default for rows staged before classification existed. */
export const DEFAULT_CLASSIFICATION: RowClassification = {
  classification: "manual_review",
  classification_reasons: ["duplicate_check_unavailable"],
  duplicate_status: "not_checked",
  classified_at: "",
  classifier_version: "",
};

export type ClassifiableRow = {
  name: string | null;
  email: string | null;
  mobile_number: string | null;
  validation_errors: { code: string; field?: string; detail?: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
};

/** Outcome of the tenant-scoped, read-only duplicate preflight for a batch. */
export type DuplicateLookup = { state: "checked" | "not_checked" | "error" };

const KNOWN_UNCERTAIN_CODES = ["malformed_row", "unmappable_stage"] as const;
const HANDLED_CODES = [
  "missing_name",
  "invalid_phone",
  "unsupported_phone_type",
  "invalid_email",
  "missing_phone_and_email",
  "duplicate_phone_in_file",
  "duplicate_email_in_file",
  "duplicate_existing_phone",
  "duplicate_existing_email",
] as const;

function isDuplicateStatus(value: unknown): value is DuplicateStatus {
  return DUPLICATE_STATUSES.includes(value as DuplicateStatus);
}

function isClassificationReason(value: unknown): value is ClassificationReason {
  return CLASSIFICATION_REASONS.includes(value as ClassificationReason);
}

/** Resolve the row's duplicate status from the read-only preflight outcome. */
export function resolveDuplicateStatus(
  row: Pick<ClassifiableRow, "dedupe_match_lead_id" | "duplicate_of_row">,
  lookup: DuplicateLookup,
): DuplicateStatus {
  if (lookup.state === "error") return "lookup_error";
  if (lookup.state === "not_checked") return "not_checked";
  return hasExistingDuplicate(row) ? "potential_duplicate" : "checked_no_match";
}

/**
 * Deterministic preview classifier. A row becomes `auto_include` only when
 * every required condition passes AND the duplicate preflight confirmed
 * `checked_no_match`. It NEVER produces `exclude`.
 */
export function classifyRow(
  row: ClassifiableRow,
  lookup: DuplicateLookup,
  now: Date = new Date(),
): RowClassification {
  const codes = row.validation_errors.map((issue) => issue.code);
  const reasons = new Set<ClassificationReason>();

  if (!row.name) reasons.add("missing_name");
  if (codes.includes("invalid_phone")) reasons.add("invalid_phone");
  if (codes.includes("unsupported_phone_type")) reasons.add("not_mobile");
  if (!row.mobile_number && !codes.includes("invalid_phone") && !codes.includes("unsupported_phone_type")) {
    reasons.add("missing_phone");
  }
  if (!isEligibleMobile(row.mobile_number)) {
    if (!reasons.has("invalid_phone") && !reasons.has("not_mobile") && !reasons.has("missing_phone")) {
      reasons.add("invalid_phone");
    }
  }
  if (codes.includes("invalid_email")) reasons.add("invalid_email");
  // Email is optional for an import: a mobile number is what matters.
  if (
    codes.some((code) => (KNOWN_UNCERTAIN_CODES as readonly string[]).includes(code)) ||
    codes.some(
      (code) =>
        !(HANDLED_CODES as readonly string[]).includes(code) &&
        !(KNOWN_UNCERTAIN_CODES as readonly string[]).includes(code),
    )
  ) {
    reasons.add("uncertain_data");
  }

  const duplicateStatus = resolveDuplicateStatus(row, lookup);
  if (duplicateStatus === "potential_duplicate") reasons.add("potential_duplicate");
  if (duplicateStatus === "not_checked") reasons.add("duplicate_check_unavailable");
  if (duplicateStatus === "lookup_error") reasons.add("duplicate_lookup_error");

  const eligible = reasons.size === 0 && duplicateStatus === "checked_no_match";
  return {
    classification: eligible ? "auto_include" : "manual_review",
    classification_reasons: eligible ? ["clean_eligible"] : [...reasons],
    duplicate_status: duplicateStatus,
    classified_at: now.toISOString(),
    classifier_version: CLASSIFIER_VERSION,
  };
}

/** Read classification metadata out of a staged payload; defaults safely. */
export function readClassification(payload: unknown): RowClassification {
  const raw = (payload as { classification?: unknown; classification_reasons?: unknown; duplicate_status?: unknown; classified_at?: unknown; classifier_version?: unknown } | null) ?? null;
  if (!raw || (raw.classification !== "auto_include" && raw.classification !== "manual_review")) {
    return { ...DEFAULT_CLASSIFICATION, classification_reasons: [...DEFAULT_CLASSIFICATION.classification_reasons] };
  }
  const reasons = Array.isArray(raw.classification_reasons)
    ? raw.classification_reasons.filter(isClassificationReason)
    : [];
  return {
    classification: raw.classification,
    classification_reasons: reasons,
    duplicate_status: isDuplicateStatus(raw.duplicate_status) ? raw.duplicate_status : "not_checked",
    classified_at: typeof raw.classified_at === "string" ? raw.classified_at : "",
    classifier_version: typeof raw.classifier_version === "string" ? raw.classifier_version : "",
  };
}

/**
 * Merge classification into a row's review state. Manual decisions always win:
 * a manual `include`, `exclude` (with its reason) or explicit manual `pending`
 * is returned untouched. Only automatic/never-touched rows can be auto-included.
 */
export function applyClassificationToReview(
  current: RowReview | null | undefined,
  classification: RowClassification,
): RowReview {
  const review = current?.decision ? current : { ...DEFAULT_REVIEW };
  if (review.source === "manual") return review;
  if (review.decision !== "pending") return review;
  if (classification.classification !== "auto_include") {
    return { decision: "pending", exclusion_reason: null, source: "auto" };
  }
  return { decision: "include", exclusion_reason: null, source: "auto" };
}

export type DryRunSummary = {
  label: typeof DRY_RUN_LABEL;
  total_rows: number;
  pending_rows: number;
  included_rows: number;
  auto_included_rows: number;
  manually_included_rows: number;
  excluded_rows: number;
  included_with_phone_issues: number;
  included_with_valid_au_mobile: number;
  potential_existing_duplicates: number;
  would_skip_as_duplicate: number;
  would_block_sms_phone_ineligible: number;
  /** Aggregate duplicate preflight state across the batch. */
  duplicate_lookup_status: DuplicateStatus;
  /** True only when every row's duplicate lookup actually completed. */
  duplicate_lookup_verified: boolean;
  duplicate_not_checked_rows: number;
  duplicate_lookup_error_rows: number;
  /** Verified potential duplicates; null when the lookup did not complete. */
  potential_duplicates: number | null;
  classification_reason_counts: Record<string, number>;
};

/** Compute a dry-run summary. Read-only: no writes, no provider calls. */
export function buildDryRunSummary(input: ReviewableRow[]): DryRunSummary {
  // Older staged rows (and cached responses) may not carry a review or
  // classification object yet, so normalize to safe defaults before counting.
  const rows = input.map((row) => ({
    ...row,
    review: row.review?.decision ? row.review : { ...DEFAULT_REVIEW },
    classification: row.classification?.classification
      ? row.classification
      : { ...DEFAULT_CLASSIFICATION },
  }));
  const included = rows.filter((row) => row.review.decision === "include");

  const notChecked = rows.filter((row) => row.classification.duplicate_status === "not_checked");
  const lookupErrors = rows.filter((row) => row.classification.duplicate_status === "lookup_error");
  const verified = rows.length > 0 && notChecked.length === 0 && lookupErrors.length === 0;
  const aggregate: DuplicateStatus =
    lookupErrors.length > 0
      ? "lookup_error"
      : notChecked.length > 0
        ? "not_checked"
        : rows.some((row) => row.classification.duplicate_status === "potential_duplicate")
          ? "potential_duplicate"
          : "checked_no_match";

  const reasonCounts: Record<string, number> = {};
  for (const row of rows) {
    for (const reason of row.classification.classification_reasons) {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    }
  }

  return {
    label: DRY_RUN_LABEL,
    total_rows: rows.length,
    pending_rows: rows.filter((row) => row.review.decision === "pending").length,
    included_rows: included.length,
    auto_included_rows: included.filter((row) => row.review.source === "auto").length,
    manually_included_rows: included.filter((row) => row.review.source !== "auto").length,
    excluded_rows: rows.filter((row) => row.review.decision === "exclude").length,
    included_with_phone_issues: included.filter((row) => hasPhoneIssue(row)).length,
    included_with_valid_au_mobile: included.filter((row) => isEligibleMobile(row.mobile_number)).length,
    potential_existing_duplicates: rows.filter((row) => Boolean(row.dedupe_match_lead_id)).length,
    would_skip_as_duplicate: included.filter((row) => hasExistingDuplicate(row)).length,
    would_block_sms_phone_ineligible: included.filter((row) => !isEligibleMobile(row.mobile_number)).length,
    duplicate_lookup_status: aggregate,
    duplicate_lookup_verified: verified,
    duplicate_not_checked_rows: notChecked.length,
    duplicate_lookup_error_rows: lookupErrors.length,
    potential_duplicates: verified
      ? rows.filter((row) => row.classification.duplicate_status === "potential_duplicate").length
      : null,
    classification_reason_counts: reasonCounts,
  };
}

