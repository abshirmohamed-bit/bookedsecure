/**
 * Pure helpers for the CRM import history list.
 *
 * Uploads are identified by batch id, never by filename: the same CRM export
 * can legitimately be uploaded many times, so filename alone is ambiguous.
 */

export type ImportBatchSummary = {
  id: string;
  filename: string | null;
  status: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  created_at: string;
};

/** Statuses whose staged rows are safe to remove. `committed` is excluded. */
export const DELETABLE_BATCH_STATUSES = ["uploaded", "previewed", "failed", "cancelled"] as const;

const STATUS_LABELS: Record<string, string> = {
  uploaded: "Uploaded",
  previewed: "Previewed",
  failed: "Failed",
  cancelled: "Cancelled",
  committed: "Committed",
};

export function batchStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

export function canDeleteBatch(status: string): boolean {
  return (DELETABLE_BATCH_STATUSES as readonly string[]).includes(status);
}

/** Short, human-quotable batch identity, e.g. `#a1b2c3d4`. */
export function shortBatchId(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 8)}`;
}

/** Localised upload timestamp, e.g. `30 Aug 2026, 5:16 pm`. */
export function formatUploadTimestamp(iso: string, locale = "en-AU"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/** "Previewed · 4 rows · 2 issues · 1 duplicate" */
export function batchCountsLine(batch: ImportBatchSummary): string {
  return [
    batchStatusLabel(batch.status),
    plural(batch.total_rows, "row"),
    plural(batch.invalid_rows, "issue"),
    plural(batch.duplicate_rows, "duplicate"),
  ].join(" · ");
}

/** "30 Aug 2026, 5:16 pm · #a1b2c3d4" */
export function batchIdentityLine(batch: ImportBatchSummary, locale = "en-AU"): string {
  return `${formatUploadTimestamp(batch.created_at, locale)} · ${shortBatchId(batch.id)}`;
}

/**
 * Keeps the user's choice when it is still available, otherwise falls back to
 * the newest upload. Batches arrive newest-first from the server.
 */
export function resolveSelectedBatchId(
  batches: readonly ImportBatchSummary[],
  selectedId: string | null,
): string | null {
  if (selectedId && batches.some((batch) => batch.id === selectedId)) return selectedId;
  return batches[0]?.id ?? null;
}
