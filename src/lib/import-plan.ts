// Pure planning and plain-language copy for the one-step contact import.
//
// There is no review queue and no held bucket. Every staged row lands in
// exactly one of four honest buckets:
//   save         . a new contact we can save
//   update       . we already have this contact; fill only its empty fields
//   already_there. this upload row was already saved before (idempotent replay)
//   skip         . unusable for texting (no valid mobile, or a repeat in the file)
//
// Nothing here reads or writes data; the server re-derives the same plan from
// freshly loaded rows immediately before any write.

export type ImportBucket = "save" | "update" | "already_there" | "skip";

export type SkipReason = "no_mobile" | "repeat_in_file" | "unreadable_row";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  no_mobile: "no usable Australian mobile number",
  repeat_in_file: "the same person appears earlier in this file",
  unreadable_row: "the row could not be read",
};

/** The minimum a row must expose to be planned. Matches staged preview rows. */
export type PlannableRow = {
  row_number: number;
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  validation_errors: { code: string }[];
  dedupe_match_lead_id: string | null;
  duplicate_of_row: number | null;
  /** Set once this row has already produced a live lead. */
  commit_lead_id?: string | null;
};

export type PlannedRow = {
  row_number: number;
  bucket: ImportBucket;
  skip_reason: SkipReason | null;
  name: string | null;
  mobile_number: string | null;
  matched_lead_id: string | null;
};

export type ImportPlan = {
  batch_id: string;
  total: number;
  save: number;
  update: number;
  already_there: number;
  skipped: number;
  skip_reason_counts: Record<SkipReason, number>;
  rows: PlannedRow[];
  /** Rows the save action will act on (save + update). */
  actionable_rows: number[];
};

const MOBILE_PATTERN = /^\+614\d{8}$/;

/** True only for a repaired, texteable Australian mobile number. */
export function isTexteableMobile(value: string | null | undefined): boolean {
  return typeof value === "string" && MOBILE_PATTERN.test(value.trim());
}

/** Decide the single bucket one row belongs to. */
export function planImportRow(row: PlannableRow): PlannedRow {
  const base = {
    row_number: row.row_number,
    name: row.name,
    mobile_number: row.mobile_number,
    matched_lead_id: row.dedupe_match_lead_id ?? null,
  };
  const codes = row.validation_errors.map((issue) => issue.code);

  if (row.commit_lead_id) return { ...base, bucket: "already_there", skip_reason: null };
  if (codes.includes("malformed_row") && !isTexteableMobile(row.mobile_number)) {
    return { ...base, bucket: "skip", skip_reason: "unreadable_row" };
  }
  if (!isTexteableMobile(row.mobile_number)) {
    return { ...base, bucket: "skip", skip_reason: "no_mobile" };
  }
  if (row.duplicate_of_row) return { ...base, bucket: "skip", skip_reason: "repeat_in_file" };
  if (row.dedupe_match_lead_id) return { ...base, bucket: "update", skip_reason: null };
  return { ...base, bucket: "save", skip_reason: null };
}

/** Plan a whole batch. Deterministic and order-preserving. */
export function planImport(batchId: string, rows: PlannableRow[]): ImportPlan {
  const planned = rows
    .filter((row) => row.row_number > 0)
    .map((row) => planImportRow(row))
    .sort((a, b) => a.row_number - b.row_number);

  const counts: Record<SkipReason, number> = {
    no_mobile: 0,
    repeat_in_file: 0,
    unreadable_row: 0,
  };
  for (const row of planned) if (row.skip_reason) counts[row.skip_reason] += 1;

  return {
    batch_id: batchId,
    total: planned.length,
    save: planned.filter((row) => row.bucket === "save").length,
    update: planned.filter((row) => row.bucket === "update").length,
    already_there: planned.filter((row) => row.bucket === "already_there").length,
    skipped: planned.filter((row) => row.bucket === "skip").length,
    skip_reason_counts: counts,
    rows: planned,
    actionable_rows: planned
      .filter((row) => row.bucket === "save" || row.bucket === "update")
      .map((row) => row.row_number),
  };
}

function contacts(count: number): string {
  return count === 1 ? "1 contact" : `${count} contacts`;
}

/** Plain-language summary of what the upload contains, before anything is saved. */
export function planSummaryLines(plan: ImportPlan): string[] {
  const lines = [`We read ${contacts(plan.total)} in your file.`];
  if (plan.save > 0) lines.push(`${contacts(plan.save)} are new and ready to save.`);
  if (plan.update > 0) {
    lines.push(`${contacts(plan.update)} are already in your inbox. we'll fill in any gaps.`);
  }
  if (plan.already_there > 0) {
    lines.push(`${contacts(plan.already_there)} from this file were saved earlier.`);
  }
  if (plan.skipped > 0) {
    const reasons = (Object.entries(plan.skip_reason_counts) as [SkipReason, number][])
      .filter(([, count]) => count > 0)
      .map(([reason, count]) => `${count} · ${SKIP_REASON_LABELS[reason]}`);
    lines.push(`${contacts(plan.skipped)} were left out (${reasons.join(", ")}).`);
  }
  if (plan.save === 0 && plan.update === 0) {
    lines.push("There is nothing left to save from this file.");
  }
  return lines;
}

export const SAVE_ACTION_LABEL = "Save contacts to my inbox";
export const NO_MESSAGES_COPY = "No texts are ever sent to imported contacts.";
export const PREPARE_COPY = "Getting your contacts ready. fixing phone formats and matching names…";
export const PREPARE_STEPS = [
  "Reading your columns, however they are named",
  "Repairing Australian mobile numbers",
  "Filling in missing names from email addresses",
  "Checking against contacts you already have",
];

// --- what actually happened ---------------------------------------------------

export type SaveOutcome = "saved" | "updated" | "already_there" | "skipped" | "failed";

export const SAVE_OUTCOME_LABELS: Record<SaveOutcome, string> = {
  saved: "saved to your inbox",
  updated: "already there. missing details filled in",
  already_there: "already saved earlier",
  skipped: "left out",
  failed: "could not be saved",
};

export type SaveResultRow = {
  row_number: number;
  name: string | null;
  outcome: SaveOutcome;
  detail: string | null;
};

export type SaveReport = {
  saved: number;
  updated: number;
  already_there: number;
  skipped: number;
  failed: number;
  rows: SaveResultRow[];
};

export function buildSaveReport(rows: SaveResultRow[]): SaveReport {
  const count = (outcome: SaveOutcome) => rows.filter((row) => row.outcome === outcome).length;
  return {
    saved: count("saved"),
    updated: count("updated"),
    already_there: count("already_there"),
    skipped: count("skipped"),
    failed: count("failed"),
    rows,
  };
}

/** Honest one-line result, including partial failure. */
export function saveHeadline(report: SaveReport): string {
  const parts: string[] = [];
  if (report.saved > 0) parts.push(`${contacts(report.saved)} saved`);
  if (report.updated > 0) parts.push(`${report.updated} updated`);
  if (report.already_there > 0) parts.push(`${report.already_there} already there`);
  if (report.skipped > 0) parts.push(`${report.skipped} left out`);
  if (report.failed > 0) parts.push(`${report.failed} could not be saved`);
  if (parts.length === 0) return "Nothing needed saving.";
  return `${parts.join(", ")}.`;
}
