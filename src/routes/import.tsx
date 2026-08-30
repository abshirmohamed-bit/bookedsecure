import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ERROR_LABELS, MAX_CSV_BYTES } from "@/lib/csv-import";
import {
  classifyCrmImportBatch,
  deleteCrmImportBatch,
  getCrmImportBatch,
  listCrmImportBatches,
  previewCrmImport,
  setCrmImportRowDecision,
} from "@/lib/csv-import.functions";
import {
  CLASSIFICATION_REASON_LABELS,
  DRY_RUN_LABEL,
  DUPLICATE_STATUS_LABELS,
  EXCLUSION_REASONS,
  EXCLUSION_REASON_LABELS,
  ROW_DECISIONS,
  buildDryRunSummary,
  hasPhoneIssue,
  type ClassificationReason,
  type ExclusionReason,
  type RowDecision,
} from "@/lib/row-review";
import {
  CANARY_LABEL,
  COMMIT_BLOCK_LABELS,
  COMMIT_SIMULATION_LABEL,
  SIMULATION_WARNING,
  readCommitState,
  rowCommitLabel,
  type CommitBlockReason,
} from "@/lib/commit-gate";
import { commitCrmCanaryRow, simulateCrmCommit } from "@/lib/commit-gate.functions";
import {
  batchCountsLine,
  batchIdentityLine,
  canDeleteBatch,
  formatUploadTimestamp,
  resolveSelectedBatchId,
  shortBatchId,
  type ImportBatchSummary,
} from "@/lib/import-history";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "CRM lead import preview — Glocast" },
      {
        name: "description",
        content:
          "Upload a historical CRM CSV and preview how each row maps to Glocast leads before anything is imported.",
      },
      { property: "og:title", content: "CRM lead import preview — Glocast" },
      {
        property: "og:description",
        content: "Preview-only CRM CSV mapping, validation and duplicate detection.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportPage,
});

type Preview = NonNullable<Awaited<ReturnType<typeof getCrmImportBatch>>>;

function ImportPage() {
  return (
    <AppShell title="CRM import (preview only)">
      <ImportView />
    </AppShell>
  );
}

function ImportView() {
  const fetchBatches = useServerFn(listCrmImportBatches);
  const upload = useServerFn(previewCrmImport);
  const fetchBatch = useServerFn(getCrmImportBatch);
  const removeBatch = useServerFn(deleteCrmImportBatch);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ImportBatchSummary | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["crm-import-batches"],
    queryFn: () => fetchBatches(),
  });

  const batches = (data?.batches ?? []) as ImportBatchSummary[];
  // Keep the user's choice; only auto-select when nothing valid is selected.
  const activeId = resolveSelectedBatchId(batches, selectedId);
  const activeBatch = batches.find((batch) => batch.id === activeId) ?? null;

  const preview = useQuery({
    queryKey: ["crm-import-batch", activeId],
    queryFn: () => fetchBatch({ data: { batchId: activeId! } }),
    // Only fetch batches that are still present in the freshly-loaded list, so a
    // deleted batch id can never be requested again.
    enabled: Boolean(activeBatch),
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_CSV_BYTES) throw new Error("The file is larger than 2 MB.");
      const content = await file.text();
      return upload({ data: { filename: file.name, content } });
    },
    onSuccess: (result) => {
      setSelectedId(result.batch.id);
      toast.success(`Preview ready — ${result.batch.total_rows} rows staged, nothing imported.`);
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void refetch();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (batchId: string) => removeBatch({ data: { batchId } }),
    onSuccess: async (result) => {
      setConfirmDelete(null);
      // Clear the selection so the newest remaining upload is picked up.
      if (selectedId === result.batchId || activeId === result.batchId) setSelectedId(null);
      // Drop the cached preview so nothing refetches the deleted batch.
      queryClient.removeQueries({ queryKey: ["crm-import-batch", result.batchId] });
      await refetch();
      toast.success("Preview deleted. No live data was changed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (data && data.role !== "owner") {
    return (
      <p className="text-sm text-muted-foreground">
        CRM lead import is only available to the business owner.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="panel space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Upload a CRM CSV</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Up to 2 MB and 2,000 rows, with a header row. This is a preview only — no leads are
            created, no SMS is sent and nothing is added to your live pipeline.
          </p>
        </div>
        <input
          type="file"
          aria-label="Choose a CRM CSV file to preview"
          accept=".csv,text/csv"
          disabled={uploadMutation.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadMutation.mutate(file);
          }}
          className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        {uploadMutation.isPending ? (
          <p className="text-xs text-muted-foreground">Parsing and validating…</p>
        ) : null}
      </section>

      {batches.length === 0 ? (
        <section className="panel p-6 text-center">
          <h2 className="text-sm font-semibold">No preview uploads yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Upload a CRM CSV to inspect historical data safely. Previewing does not create leads or
            send messages.
          </p>
        </section>
      ) : (
        <section className="panel p-4">
          <h2 className="text-sm font-semibold">Recent uploads</h2>
          <p id="upload-selector-label" className="mt-1 text-xs text-muted-foreground">
            Select an upload to review
          </p>
          <ul
            aria-labelledby="upload-selector-label"
            role="radiogroup"
            className="mt-3 space-y-2"
          >
            {batches.map((batch) => {
              const selected = batch.id === activeId;
              return (
                <li key={batch.id}>
                  <div
                    className={`flex flex-wrap items-start gap-2 rounded-md border p-3 sm:flex-nowrap sm:items-center ${
                      selected
                        ? "border-primary bg-secondary/60 ring-1 ring-primary/40"
                        : "border-border hover:bg-secondary/30"
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSelectedId(batch.id)}
                      className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <p className="truncate text-sm font-medium">
                        {batch.filename ?? "CSV upload"}
                        {selected ? (
                          <span className="ml-2 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                            Selected
                          </span>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {batchIdentityLine(batch)}
                      </p>
                      <p className="text-xs text-muted-foreground">{batchCountsLine(batch)}</p>
                    </button>
                    {canDeleteBatch(batch.status) ? (
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(batch)}
                        aria-label={`Delete preview ${batch.filename ?? "CSV upload"} ${shortBatchId(batch.id)}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete preview
                      </button>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        Committed uploads are kept
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {confirmDelete ? (
        <DeleteDialog
          batch={confirmDelete}
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
        />
      ) : null}

      {activeBatch && preview.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading preview…</p>
      ) : null}
      {preview.error ? (
        <p className="text-sm text-destructive">{(preview.error as Error).message}</p>
      ) : null}
      {activeBatch && !preview.isLoading && preview.isSuccess && !preview.data ? (
        <p className="text-sm text-muted-foreground">
          This preview is no longer available. Select another upload or upload a new CSV.
        </p>
      ) : null}
      {preview.data && preview.data.batch.id === activeId ? (
        <>
          <DryRunPanel preview={preview.data} />
          <CommitGatePanel preview={preview.data} />
          <PreviewTable preview={preview.data} />
        </>
      ) : null}
    </div>
  );
}

/** Explicit, keyboard-accessible confirmation. Nothing is deleted on selection. */
function DeleteDialog({
  batch,
  pending,
  onCancel,
  onConfirm,
}: {
  batch: ImportBatchSummary;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-preview-title"
        aria-describedby="delete-preview-body"
        className="panel w-full max-w-md space-y-3 p-4"
      >
        <h2 id="delete-preview-title" className="text-sm font-semibold">
          Delete this preview?
        </h2>
        <p id="delete-preview-body" className="text-xs text-muted-foreground">
          This will permanently remove the staged CSV rows for{" "}
          <span className="text-foreground">{batch.filename ?? "CSV upload"}</span> uploaded on{" "}
          {formatUploadTimestamp(batch.created_at)}. It will not delete live leads, conversations,
          messages, or jobs.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Keep preview
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Deleting…" : "Delete preview"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PreviewTable({ preview }: { preview: Preview }) {
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">
            Preview: {preview.batch.filename ?? "CSV upload"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Batch {shortBatchId(preview.batch.id)} · Uploaded{" "}
            {formatUploadTimestamp(preview.batch.created_at)}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {batchCountsLine(preview.batch)} · {preview.batch.valid_rows} clean
        </span>
      </div>
      {preview.unmapped_columns.length ? (
        <p className="text-xs text-muted-foreground">
          Unmapped columns kept with the original row: {preview.unmapped_columns.join(", ")}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Proposed mapping</th>
              <th className="py-2 pr-3">Issues</th>
              <th className="py-2 pr-3">Duplicate</th>
              <th className="py-2 pr-3">Classification</th>
              <th className="py-2 pr-3">Decision</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => {
              const payload = row.normalized_payload;
              const metadata = payload.source_metadata ?? {};
              return (
                <tr key={row.row_number} className="border-t border-border align-top">
                  <td className="py-2 pr-3">{row.row_number}</td>
                  <td className="py-2 pr-3">{row.name ?? "—"}</td>
                  <td className="py-2 pr-3">{row.mobile_number ?? "—"}</td>
                  <td className="py-2 pr-3">{row.email ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <div>status: {payload.proposed_status ?? "—"}</div>
                    <div>
                      source: {payload.source_channel_raw ?? "—"}
                      {payload.source_channel_raw ? ` → ${payload.source_channel}` : ""}
                    </div>

                    <div>form: {payload.source_form ?? "—"}</div>
                    <div>created: {payload.proposed_created_at ?? "—"}</div>
                    {Object.keys(metadata).length ? (
                      <div className="text-muted-foreground">
                        metadata:{" "}
                        {Object.entries(metadata)
                          .map(([key, value]) => `${key}=${value}`)
                          .join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    {row.validation_errors.length ? (
                      <ul className="space-y-0.5 text-destructive">
                        {row.validation_errors.map((issue, index) => (
                          <li key={`${issue.code}-${index}`}>
                            {ERROR_LABELS[issue.code] ?? issue.code}
                            {issue.detail ? ` (${issue.detail})` : ""}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-muted-foreground">none</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {row.dedupe_match_lead_id
                      ? `existing lead ${row.dedupe_match_lead_id.slice(0, 8)}…`
                      : row.duplicate_of_row
                        ? `row ${row.duplicate_of_row}`
                        : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <div>
                      {row.classification?.classification === "auto_include"
                        ? "auto include"
                        : "manual review"}
                    </div>
                    <div className="text-muted-foreground">
                      duplicates:{" "}
                      {DUPLICATE_STATUS_LABELS[row.classification?.duplicate_status ?? "not_checked"]}
                    </div>
                    {row.classification?.classification_reasons?.length ? (
                      <div className="text-muted-foreground">
                        {row.classification.classification_reasons
                          .map((reason) => CLASSIFICATION_REASON_LABELS[reason] ?? reason)
                          .join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">
                    <DecisionControl batchId={preview.batch.id} row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Preview only. Importing, merging and creating leads is not enabled yet.
      </p>
    </section>
  );
}

function DryRunPanel({ preview }: { preview: Preview }) {
  const runClassifier = useServerFn(classifyCrmImportBatch);
  const queryClient = useQueryClient();
  const summary = buildDryRunSummary(preview.rows);
  const classifyMutation = useMutation({
    mutationFn: () => runClassifier({ data: { batchId: preview.batch.id } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", preview.batch.id] });
      toast.success(
        `Classification complete — ${result.auto_included} auto-included. Nothing was imported.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const duplicateVerified = summary.duplicate_lookup_verified;
  const items: [string, string | number][] = [
    ["Total preview rows", summary.total_rows],
    ["Pending", summary.pending_rows],
    ["Automatically included", summary.auto_included_rows],
    ["Manually included", summary.manually_included_rows],
    ["Total included", summary.included_rows],
    ["Excluded", summary.excluded_rows],
    ["Included with phone issues", summary.included_with_phone_issues],
    ["Included with valid AU mobile", summary.included_with_valid_au_mobile],
    [
      "Potential duplicates of existing leads",
      duplicateVerified ? (summary.potential_duplicates ?? 0) : "Not checked",
    ],
    ["Duplicate lookup status", DUPLICATE_STATUS_LABELS[summary.duplicate_lookup_status]],
    ["Rows with duplicate status not checked", summary.duplicate_not_checked_rows],
    [
      "Would be skipped as duplicates",
      duplicateVerified ? summary.would_skip_as_duplicate : "Not checked",
    ],
    ["Would be blocked from SMS", summary.would_block_sms_phone_ineligible],
  ];
  const reasons = Object.entries(summary.classification_reason_counts).sort((a, b) => b[1] - a[1]);

  return (
    <section className="panel space-y-3 p-4" aria-label="Dry run summary">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{DRY_RUN_LABEL}</p>
        <h2 className="mt-1 text-sm font-semibold">Dry-run summary</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Calculated from automated classification and manual row decisions. Nothing is imported,
          merged, messaged, scheduled, or written to live leads.
        </p>
      </div>
      {!duplicateVerified ? (
        <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-foreground">
          Duplicate status: Not checked. Zero duplicates does not confirm that the live leads table
          contains no matches.
        </p>
      ) : null}
      <button
        type="button"
        disabled={classifyMutation.isPending}
        onClick={() => classifyMutation.mutate()}
        className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {classifyMutation.isPending
          ? "Running duplicate preflight…"
          : "Run duplicate preflight and classify"}
      </button>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <h3 className="text-xs font-semibold">Classification reasons</h3>
        {reasons.length ? (
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {reasons.map(([reason, count]) => (
              <li key={reason}>
                {CLASSIFICATION_REASON_LABELS[reason as ClassificationReason] ?? reason}: {count}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No classification data yet.</p>
        )}
      </div>
    </section>
  );
}


/** Per-row review control. Writes only preview review state. */
function DecisionControl({ batchId, row }: { batchId: string; row: Preview["rows"][number] }) {
  const setDecision = useServerFn(setCrmImportRowDecision);
  const queryClient = useQueryClient();
  const phoneIssue = hasPhoneIssue(row);
  const review = row.review ?? { decision: "pending" as RowDecision, exclusion_reason: null };
  const [reason, setReason] = useState<ExclusionReason>(
    review.exclusion_reason ?? "manually_excluded",
  );

  const mutation = useMutation({
    mutationFn: (input: { decision: RowDecision; exclusionReason: ExclusionReason | null }) =>
      setDecision({
        data: {
          batchId,
          rowNumber: row.row_number,
          decision: input.decision,
          exclusionReason: input.exclusionReason,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["crm-import-batch", batchId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-1">
      <select
        aria-label={`Decision for row ${row.row_number}`}
        value={review.decision}
        disabled={mutation.isPending}
        onChange={(event) => {
          const decision = event.target.value as RowDecision;
          mutation.mutate({
            decision,
            exclusionReason: decision === "exclude" ? reason : null,
          });
        }}
        className="rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {ROW_DECISIONS.map((decision) => (
          <option
            key={decision}
            value={decision}
            disabled={decision === "include" && phoneIssue}
          >
            {decision}
          </option>
        ))}
      </select>
      {review.decision === "exclude" ? (
        <select
          aria-label={`Exclusion reason for row ${row.row_number}`}
          value={review.exclusion_reason ?? reason}
          disabled={mutation.isPending}
          onChange={(event) => {
            const next = event.target.value as ExclusionReason;
            setReason(next);
            mutation.mutate({ decision: "exclude", exclusionReason: next });
          }}
          className="block rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {EXCLUSION_REASONS.map((value) => (
            <option key={value} value={value}>
              {EXCLUSION_REASON_LABELS[value]}
            </option>
          ))}
        </select>
      ) : null}
      {phoneIssue ? (
        <p className="text-[10px] text-muted-foreground">Phone issue — cannot include</p>
      ) : null}
    </div>
  );
}
