/**
 * PRESENTATION-ONLY helpers for the Advanced CRM import view.
 *
 * Pure formatting, grouping, filtering and pagination maths for read-only
 * display. Nothing here imports rows, changes rollout state, writes to the
 * database, sends SMS, or calls a provider.
 */

import {
  IMPORT_MODE_LABELS,
  ROW_OUTCOME_LABELS,
  type ImportSummary,
  type RowOutcome,
  type RowResult,
} from "@/lib/import-automation";
import { COMMIT_BLOCK_LABELS, type CommitBlockReason } from "@/lib/commit-gate";

export type MetricTone = "neutral" | "good" | "warn" | "bad";

export type SummaryMetric = { label: string; value: number; tone: MetricTone };

export type SummaryGroup = {
  id: "outcome" | "review" | "side_effects";
  title: string;
  hint: string;
  metrics: SummaryMetric[];
};

/** Amber when anything is waiting on a person, green when nothing is. */
const pending = (value: number): MetricTone => (value > 0 ? "warn" : "good");
/** Red when a failure or unexpected side effect exists, green when it does not. */
const failure = (value: number): MetricTone => (value > 0 ? "bad" : "good");

/**
 * Groups the durable import summary into Import outcome, Review and safety, and
 * Side effects. Every metric of the summary appears exactly once.
 */
export function buildSummaryGroups(summary: ImportSummary): SummaryGroup[] {
  return [
    {
      id: "outcome",
      title: "Import outcome",
      hint: "What the last import actually did to live leads.",
      metrics: [
        { label: "Total uploaded", value: summary.total_uploaded, tone: "neutral" },
        { label: "Auto-imported", value: summary.auto_imported, tone: "neutral" },
        { label: "Manually imported", value: summary.manually_imported, tone: "neutral" },
        { label: "Already committed", value: summary.already_committed, tone: "neutral" },
        { label: "Excluded rows", value: summary.excluded_rows, tone: "neutral" },
      ],
    },
    {
      id: "review",
      title: "Review and safety",
      hint: "Rows held back, plus anything needing a person.",
      metrics: [
        {
          label: "Pending review",
          value: summary.pending_review,
          tone: pending(summary.pending_review),
        },
        {
          label: "Potential duplicates",
          value: summary.potential_duplicates,
          tone: pending(summary.potential_duplicates),
        },
        {
          label: "Duplicate lookup unavailable",
          value: summary.duplicate_lookup_unavailable,
          tone: pending(summary.duplicate_lookup_unavailable),
        },
        {
          label: "Invalid phones",
          value: summary.invalid_phones,
          tone: pending(summary.invalid_phones),
        },
        {
          label: "Non-mobile phones",
          value: summary.non_mobile_phones,
          tone: pending(summary.non_mobile_phones),
        },
        { label: "Failed rows", value: summary.failed_rows, tone: failure(summary.failed_rows) },
        {
          label: "Reconciliation required",
          value: summary.reconciliation_required_rows,
          tone: failure(summary.reconciliation_required_rows),
        },
      ],
    },
    {
      id: "side_effects",
      title: "Side effects",
      hint: "The import-only path must never create any of these.",
      metrics: [
        {
          label: "Conversations created",
          value: summary.conversations_created,
          tone: failure(summary.conversations_created),
        },
        { label: "SMS sent", value: summary.sms_sent, tone: failure(summary.sms_sent) },
        { label: "Emails sent", value: summary.emails_sent, tone: failure(summary.emails_sent) },
        { label: "Owner alerts", value: summary.owner_alerts, tone: failure(summary.owner_alerts) },
        { label: "Jobs created", value: summary.jobs_created, tone: failure(summary.jobs_created) },
        {
          label: "Pipeline changes",
          value: summary.pipeline_changes,
          tone: failure(summary.pipeline_changes),
        },
        {
          label: "Automation runs",
          value: summary.automation_runs,
          tone: failure(summary.automation_runs),
        },
        {
          label: "Provider calls",
          value: summary.provider_calls,
          tone: failure(summary.provider_calls),
        },
      ],
    },
  ];
}

/** True when the last import created no side effects at all. */
export function sideEffectsClean(summary: ImportSummary): boolean {
  return (
    summary.conversations_created === 0 &&
    summary.sms_sent === 0 &&
    summary.emails_sent === 0 &&
    summary.owner_alerts === 0 &&
    summary.jobs_created === 0 &&
    summary.pipeline_changes === 0 &&
    summary.automation_runs === 0 &&
    summary.provider_calls === 0
  );
}

export function summaryHeadline(summary: ImportSummary): string {
  return `Last import. ${IMPORT_MODE_LABELS[summary.mode]}`;
}

// --- import activity ---------------------------------------------------------

export const ACTIVITY_FILTERS = [
  "all",
  "auto_imported",
  "manually_imported",
  "already_committed",
  "failed",
  "pending",
] as const;
export type ActivityFilter = (typeof ACTIVITY_FILTERS)[number];

export const ACTIVITY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  auto_imported: "Auto-imported",
  manually_imported: "Manually imported",
  already_committed: "Already committed",
  failed: "Failed",
  pending: "Pending",
};

/** How many events to reveal before paginating. */
export const ACTIVITY_PAGE_SIZE = 25;
/** Compact preview length before "View all activity". */
export const ACTIVITY_PREVIEW_SIZE = 5;

export type ActivityCounts = Record<ActivityFilter, number>;

export function activityCounts(rows: readonly RowResult[]): ActivityCounts {
  const of = (outcome: RowOutcome) => rows.filter((row) => row.outcome === outcome).length;
  return {
    all: rows.length,
    auto_imported: of("auto_imported"),
    manually_imported: of("manually_imported"),
    already_committed: of("already_committed"),
    failed: of("failed"),
    pending: of("pending"),
  };
}

export function matchesActivityFilter(row: RowResult, filter: ActivityFilter): boolean {
  return filter === "all" ? true : row.outcome === filter;
}

/** Row-number search. A blank or non-numeric query matches everything. */
export function matchesActivitySearch(row: RowResult, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;
  return String(row.row_number).includes(trimmed);
}

export function filterActivity(
  rows: readonly RowResult[],
  filter: ActivityFilter,
  query = "",
): RowResult[] {
  return rows.filter(
    (row) => matchesActivityFilter(row, filter) && matchesActivitySearch(row, query),
  );
}

/** 1-based page slice for the contained activity table. */
export function activityPage(
  rows: readonly RowResult[],
  page: number,
  pageSize = ACTIVITY_PAGE_SIZE,
): { rows: RowResult[]; page: number; pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(Math.max(1, Math.trunc(page) || 1), pageCount);
  const start = (current - 1) * pageSize;
  return { rows: rows.slice(start, start + pageSize), page: current, pageCount };
}

export function activityOutcomeTone(outcome: RowOutcome): MetricTone {
  if (outcome === "auto_imported" || outcome === "manually_imported") return "good";
  if (outcome === "failed" || outcome === "reconciliation_required" || outcome === "blocked")
    return "bad";
  if (outcome === "pending") return "warn";
  return "neutral";
}

/** Human-readable result text, identical in wording to the previous raw log. */
export function activityResultText(row: RowResult): string {
  const label = ROW_OUTCOME_LABELS[row.outcome as RowOutcome] ?? row.outcome;
  const reasons = row.reasons.length
    ? `. ${row.reasons.map((reason) => COMMIT_BLOCK_LABELS[reason as CommitBlockReason] ?? reason).join(", ")}`
    : "";
  const error = row.error ? `. ${row.error}` : "";
  return `${label}${reasons}${error}`;
}

/** Plain-text export of the full activity list for the clipboard. */
export function activityClipboardText(rows: readonly RowResult[], ranAt: string | null): string {
  const header = ranAt ? `Import activity (${ranAt})` : "Import activity";
  const lines = rows.map((row) => `Row ${row.row_number}: ${activityResultText(row)}`);
  return [header, ...lines].join("\n");
}

// --- canary verification result ----------------------------------------------

/** Concise visible wording for each verification check key. */
export const CANARY_CHECK_LABELS: Record<string, string> = {
  exactly_one_live_lead_created: "Exactly one live lead created",
  no_conversation_created: "No conversation created",
  no_sms_or_message_created: "No SMS or message created",
  no_owner_alert_queued: "No owner alert queued",
  no_job_created: "No job created",
  no_automation_queued: "No automation queued",
  preview_row_records_live_lead: "Preview row linked to live lead",
  preview_row_records_committed_status: "Preview row marked committed",
  rerun_returns_already_committed: "Rerun returned already_committed",
  rerun_creates_zero_additional_leads: "No additional lead created on rerun",
  original_canary_pass_intact: "Original canary pass intact",
};

export function canaryCheckLabel(check: string): string {
  return CANARY_CHECK_LABELS[check] ?? check.replace(/_/g, " ");
}

export type CanaryLikeResult = {
  status: "passed" | "idempotent_pass" | "blocked" | "failed";
  lead_id: string | null;
  row_number: number;
  checks: readonly { check: string; passed: boolean; detail: string }[];
  rerun_status: string | null;
  leads_before: number;
  leads_after: number;
};

export function canaryHeadline(status: CanaryLikeResult["status"]): {
  title: string;
  subtitle: string;
  tone: MetricTone;
} {
  if (status === "passed") {
    return {
      title: "Canary verified",
      subtitle: "Exactly one live lead was created",
      tone: "good",
    };
  }
  if (status === "idempotent_pass") {
    return {
      title: "Rerun verified",
      subtitle: "The row returned already_committed and no duplicate lead was created",
      tone: "good",
    };
  }
  if (status === "blocked") {
    return {
      title: "Canary blocked",
      subtitle: "Nothing was created",
      tone: "bad",
    };
  }
  return {
    title: "Canary failed",
    subtitle: "At least one safety check did not pass",
    tone: "bad",
  };
}

/**
 * Outcome metrics for the result card, derived from the verification checks.
 * `null` means the check was not part of this result.
 */
export function canaryOutcomeMetrics(result: CanaryLikeResult): SummaryMetric[] {
  const created =
    result.status === "passed" ? Math.max(0, result.leads_after - result.leads_before) : 0;
  const zeroFrom = (check: string): SummaryMetric["tone"] => {
    const entry = result.checks.find((item) => item.check === check);
    if (!entry) return "neutral";
    return entry.passed ? "good" : "bad";
  };
  return [
    { label: "Leads created", value: result.status === "passed" ? created || 1 : 0, tone: "good" },
    { label: "Conversations", value: 0, tone: zeroFrom("no_conversation_created") },
    { label: "Messages / SMS", value: 0, tone: zeroFrom("no_sms_or_message_created") },
    { label: "Owner alerts", value: 0, tone: zeroFrom("no_owner_alert_queued") },
    { label: "Jobs", value: 0, tone: zeroFrom("no_job_created") },
    { label: "Automation runs", value: 0, tone: zeroFrom("no_automation_queued") },
    { label: "Provider calls", value: 0, tone: "good" },
  ];
}

/** Full technical audit text, copyable and unchanged in substance. */
export function canaryTechnicalText(
  result: CanaryLikeResult,
  context: { batchId: string | null; ranAt: string | null },
): string {
  const lines = [
    `Status: ${result.status}`,
    `Batch ID: ${context.batchId ?? "Not recorded"}`,
    `Preview row: ${result.row_number}`,
    `Lead ID: ${result.lead_id ?? "Not recorded"}`,
    `Commit timestamp: ${context.ranAt ?? "Not recorded"}`,
    `Live leads before: ${result.leads_before}`,
    `Live leads after: ${result.leads_after}`,
    `Idempotency / rerun result: ${result.rerun_status ?? "Not recorded"}`,
    "Checks:",
    ...result.checks.map(
      (check) => `  ${check.passed ? "PASS" : "FAIL"}. ${check.check}: ${check.detail}`,
    ),
  ];
  return lines.join("\n");
}
