import { Link, createFileRoute } from "@tanstack/react-router";
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
  repairCrmImportPhones,
  setCrmImportRowDecision,
} from "@/lib/csv-import.functions";
import {
  PHONE_CLASSIFICATION_LABELS,
  PHONE_REPAIR_ACTION_LABELS,
  REPAIR_FILTERS,
  REPAIR_FILTER_LABELS,
  buildRepairSummary,
  matchesRepairFilter,
  readPhoneRepair,
  type RepairFilter,
} from "@/lib/phone-repair";

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
import { simulateCrmCommit } from "@/lib/commit-gate.functions";
import {
  BOUNDED_BATCH_MAX_ROWS,
  IMPORT_GATE_LABELS,
  IMPORT_MODE_DESCRIPTIONS,
  IMPORT_MODE_LABELS,
  MODE_TRANSITION_LABELS,
  ROW_OUTCOME_LABELS,
  modeExplanation,
  type ImportGateReason,
  type ImportMode,
  type ImportSummary,
  type RowOutcome,
} from "@/lib/import-automation";
import {
  getImportAutomation,
  runImportBoundedBatch,
  runImportExceptionOnly,
  setImportAutomationMode,
  setImportAutomationPause,
  verifyImportCanary,
} from "@/lib/import-automation.functions";
import {
  batchCountsLine,
  batchIdentityLine,
  canDeleteBatch,
  formatUploadTimestamp,
  resolveSelectedBatchId,
  shortBatchId,
  type ImportBatchSummary,
} from "@/lib/import-history";
import { StagedRowEditor } from "@/components/StagedRowEditor";
import { ImportSectionNav } from "@/components/import/ImportSectionNav";
import { ImportSummarySection } from "@/components/import/ImportSummarySection";
import { ImportActivityPanel } from "@/components/import/ImportActivityPanel";
import { CanaryResultCard } from "@/components/import/CanaryResultCard";
import { LiteImportPanel } from "@/components/LiteImportPanel";
import {
  ADVANCED_VIEW_LABEL,
  DEFAULT_IMPORT_VIEW,
  EXCEPTION_ANCHOR_ID,
  LITE_VIEW_LABEL,
  type ImportView,
} from "@/lib/import-lite";
import {
  STAGED_ROW_STATE_LABELS,
  canEditStagedRow,
  resolveStagedRowState,
} from "@/lib/staged-row-edit";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "CRM lead import preview — BookedSecure" },
      {
        name: "description",
        content:
          "Upload a historical CRM CSV and preview how each row maps to your leads before anything is imported.",
      },
      { property: "og:title", content: "CRM lead import preview — BookedSecure" },
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
  // Unsaved staged-row edits block the commit controls.
  const [unsavedEdits, setUnsavedEdits] = useState(false);
  // Lite mode is the default view for every user. Switching views keeps the
  // same selected batch, the same preview cache and the same row decisions.
  const [view, setView] = useState<ImportView>(DEFAULT_IMPORT_VIEW);
  const [focusExceptions, setFocusExceptions] = useState(false);

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

  if (view === "lite") {
    return (
      <LiteImportPanel
        preview={preview.data && preview.data.batch.id === activeId ? preview.data : null}
        uploading={uploadMutation.isPending || preview.isLoading}
        onUpload={(file) => uploadMutation.mutate(file)}
        onOpenAdvanced={({ focusExceptions: focus }) => {
          setFocusExceptions(focus);
          setView("advanced");
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
        <p className="min-w-0 text-xs text-muted-foreground">
          {ADVANCED_VIEW_LABEL} — detailed validation, duplicates, row decisions and import
          controls.
        </p>
        <button
          type="button"
          onClick={() => {
            setFocusExceptions(false);
            setView("lite");
          }}
          className="shrink-0 rounded-md border border-input px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to {LITE_VIEW_LABEL.toLowerCase()}
        </button>
      </div>

      <ImportSectionNav />

      {/* 1. Rollout mode and safety state — always the first thing on the page. */}
      <RolloutPanel batchId={activeId} />

      {/* 2. Upload and recent uploads. */}
      <section id="import-upload" className="panel space-y-3 p-4">
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
        <section id="import-recent" className="panel p-6 text-center">
          <h2 className="text-sm font-semibold">No preview uploads yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Upload a CRM CSV to inspect historical data safely. Previewing does not create leads or
            send messages.
          </p>
        </section>
      ) : (
        <section id="import-recent" className="panel p-4">
          <h2 className="text-sm font-semibold">Recent uploads</h2>
          <p id="upload-selector-label" className="mt-1 text-xs text-muted-foreground">
            Select an upload to review
          </p>
          <ul aria-labelledby="upload-selector-label" role="radiogroup" className="mt-3 space-y-2">
            {batches.map((batch) => {
              const selected = batch.id === activeId;
              return (
                <li key={batch.id}>
                  <div
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border p-3 sm:flex sm:items-center ${
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

      {/* 3 + 4. Latest import outcome, then the contained activity list. */}
      <LatestOutcome />

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
          <RepairPanel preview={preview.data} />
          <DryRunPanel preview={preview.data} />
          <CommitGatePanel preview={preview.data} unsavedEdits={unsavedEdits} />
          <PreviewTable
            preview={preview.data}
            onDirtyChange={setUnsavedEdits}
            focusExceptions={focusExceptions}
          />
        </>
      ) : null}
    </div>
  );
}

/**
 * Latest import outcome and activity. Reads the same cached rollout query as the
 * rollout panel — no new server call, no state change.
 */
function LatestOutcome() {
  const load = useServerFn(getImportAutomation);
  const { data } = useQuery({
    queryKey: ["crm-import-automation"],
    queryFn: () => load(),
  });
  const state = data?.state;
  const summary = state?.last_summary ?? null;
  return (
    <>
      <ImportSummarySection summary={summary} ranAt={state?.last_run_at ?? null} />
      <ImportActivityPanel rows={summary?.rows ?? []} ranAt={state?.last_run_at ?? null} />
    </>
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

function PreviewTable({
  preview,
  onDirtyChange,
  focusExceptions = false,
}: {
  preview: Preview;
  onDirtyChange: (dirty: boolean) => void;
  focusExceptions?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [filter, setFilter] = useState<RepairFilter>(focusExceptions ? "needs_review" : "all");
  const sectionRef = useRef<HTMLElement>(null);
  const editingRow = preview.rows.find((row) => row.row_number === editing) ?? null;
  const rawRow = Object.fromEntries(preview.headers.map((header) => [header, ""]));
  const visibleRows = preview.rows.filter((row) => matchesRepairFilter(row as never, filter));
  // Arriving from the simple view's review annotation lands on the exceptions.
  useEffect(() => {
    if (focusExceptions) sectionRef.current?.scrollIntoView({ block: "start" });
  }, [focusExceptions]);
  return (
    <section id={EXCEPTION_ANCHOR_ID} ref={sectionRef} className="panel space-y-3 p-4">
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

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="repair-filter" className="text-xs text-muted-foreground">
          Filter rows
        </label>
        <select
          id="repair-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value as RepairFilter)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {REPAIR_FILTERS.map((option) => (
            <option key={option} value={option}>
              {REPAIR_FILTER_LABELS[option]}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Showing {visibleRows.length} of {preview.rows.length} staged rows
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Name</th>
              <th className="py-2 pr-3">Phone</th>
              <th className="py-2 pr-3">Phone repair</th>
              <th className="py-2 pr-3">Email</th>
              <th className="py-2 pr-3">Proposed mapping</th>
              <th className="py-2 pr-3">Issues</th>
              <th className="py-2 pr-3">Duplicate</th>
              <th className="py-2 pr-3">Classification</th>
              <th className="py-2 pr-3">Commit status</th>
              <th className="py-2 pr-3">Decision</th>
              <th className="py-2 pr-3">Edit</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const payload = row.normalized_payload;
              const metadata = payload.source_metadata ?? {};
              const repair = readPhoneRepair(payload);
              return (
                <tr key={row.row_number} className="border-t border-border align-top">
                  <td className="py-2 pr-3">{row.row_number}</td>
                  <td className="py-2 pr-3">{row.name ?? "—"}</td>
                  <td className="py-2 pr-3">{row.mobile_number ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {repair ? (
                      <>
                        <div>original: {repair.original || "—"}</div>
                        <div>normalised: {repair.normalized ?? "—"}</div>
                        <div className="text-muted-foreground">
                          {PHONE_REPAIR_ACTION_LABELS[repair.action] ?? repair.action}
                        </div>
                        <div className="text-muted-foreground">{repair.reason}</div>
                        <div className="text-muted-foreground">
                          confidence: {repair.confidence} ·{" "}
                          {PHONE_CLASSIFICATION_LABELS[repair.classification] ??
                            repair.classification}
                        </div>
                        <div className="text-muted-foreground">
                          eligible for import:{" "}
                          {row.classification?.classification === "auto_include" ? "yes" : "no"}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">not scanned yet</span>
                    )}
                  </td>
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
                      {
                        DUPLICATE_STATUS_LABELS[
                          row.classification?.duplicate_status ?? "not_checked"
                        ]
                      }
                    </div>
                    {row.classification?.classification_reasons?.length ? (
                      <div className="text-muted-foreground">
                        {row.classification.classification_reasons
                          .map((reason) => CLASSIFICATION_REASON_LABELS[reason] ?? reason)
                          .join(", ")}
                      </div>
                    ) : null}
                    <div className="text-muted-foreground">
                      state:{" "}
                      {
                        STAGED_ROW_STATE_LABELS[
                          resolveStagedRowState({
                            commit_status: readCommitState(row.normalized_payload).status,
                            review_decision: row.review?.decision,
                            classification: row.classification?.classification,
                            validation_errors: row.validation_errors,
                            dedupe_match_lead_id: row.dedupe_match_lead_id,
                            duplicate_of_row: row.duplicate_of_row,
                          })
                        ]
                      }
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {rowCommitLabel(
                      { ...row, commit: readCommitState(row.normalized_payload) },
                      preview.batch.id,
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <DecisionControl batchId={preview.batch.id} row={row} />
                  </td>
                  <td className="py-2 pr-3">
                    {canEditStagedRow({
                      commit_status: readCommitState(row.normalized_payload).status,
                    }) ? (
                      <button
                        type="button"
                        onClick={() => setEditing(row.row_number)}
                        aria-label={`Edit staged row ${row.row_number}`}
                        className="rounded-md border border-input px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        Edit
                      </button>
                    ) : (
                      <span className="text-muted-foreground">committed</span>
                    )}
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
      {editingRow ? (
        <StagedRowEditor
          batchId={preview.batch.id}
          row={editingRow as never}
          rawRow={rawRow}
          onDirtyChange={onDirtyChange}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Automatic staged-row phone repair. Preview-only: nothing is imported,
 * messaged, merged or written to live leads.
 */
function RepairPanel({ preview }: { preview: Preview }) {
  const runRepair = useServerFn(repairCrmImportPhones);
  const queryClient = useQueryClient();
  const summary = buildRepairSummary(preview.rows as never);
  const mutation = useMutation({
    mutationFn: () => runRepair({ data: { batchId: preview.batch.id } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", preview.batch.id] });
      toast.success(
        `Repair scan complete — ${result.high_confidence_applied} high-confidence repairs applied. Nothing was imported.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items: [string, string | number][] = [
    ["Rows scanned", summary.rows_scanned],
    ["High-confidence repairs applied", summary.high_confidence_applied],
    ["Medium-confidence suggestions", summary.medium_confidence_suggestions],
    ["Low-confidence or unrepairable", summary.low_confidence_or_unrepairable],
    ["Valid Australian mobiles", summary.valid_au_mobiles],
    ["Repaired Australian mobiles", summary.repaired_au_mobiles],
    ["Valid Australian landlines", summary.valid_au_landlines],
    ["Truly invalid phones", summary.invalid_phones],
    ["Incomplete phones", summary.incomplete_phones],
    ["Ambiguous phones", summary.ambiguous_phones],
    ["No phone supplied", summary.empty_phones],
    ["Potential duplicates", summary.potential_duplicates],
    ["Auto-include candidates", summary.auto_include_candidates],
    ["Extra +610 trunk-zero repairs", summary.extra_trunk_zero_repairs],
    ["Nine-digit mobile repairs", summary.nine_digit_mobile_repairs],
  ];

  return (
    <section id="import-repair" className="panel space-y-3 p-4" aria-label="Phone repair summary">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {DRY_RUN_LABEL}
        </p>
        <h2 className="mt-1 text-sm font-semibold">Automatic phone repair (Australia only)</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Deterministic Australian formatting repairs are applied to staged preview values only. The
          raw uploaded phone is preserved, no subscriber digit is ever invented, and nothing is
          imported, messaged, merged, scheduled, or written to live leads.
        </p>
      </div>
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {mutation.isPending ? "Scanning and repairing…" : "Scan and repair phone formats"}
      </button>
      {mutation.data ? (
        <p className="text-xs text-muted-foreground">
          Last run: {mutation.data.rows_scanned} rows scanned · {mutation.data.rows_updated} staged
          rows updated · eligible rows {mutation.data.before.eligible_rows} →{" "}
          {mutation.data.after.eligible_rows} · duplicates {mutation.data.before.duplicates} →{" "}
          {mutation.data.after.duplicates} · raw values preserved:{" "}
          {mutation.data.raw_values_preserved ? "yes" : "no"}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-md border border-border p-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
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
    <section id="import-dry-run" className="panel space-y-3 p-4" aria-label="Dry run summary">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {DRY_RUN_LABEL}
        </p>
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
          <option key={decision} value={decision} disabled={decision === "include" && phoneIssue}>
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

/**
 * COMMIT SIMULATION + CANARY IMPORT.
 *
 * The simulation is read-only. The canary control commits at most one selected
 * row, only after a successful simulation and an explicit confirmation, and the
 * server re-runs the full pre-commit revalidation before any write.
 */
function CommitGatePanel({
  preview,
  unsavedEdits = false,
}: {
  preview: Preview;
  unsavedEdits?: boolean;
}) {
  const runSimulation = useServerFn(simulateCrmCommit);
  const runCanary = useServerFn(verifyImportCanary);
  const queryClient = useQueryClient();
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const simulation = useMutation({
    mutationFn: () => runSimulation({ data: { batchId: preview.batch.id } }),
    onSuccess: (result) => {
      setSelectedRow(null);
      if (result.status === "ok") {
        toast.success(
          `Simulation complete — ${result.simulation.total_candidates} candidates. No live data changed.`,
        );
      } else {
        toast.error("This upload cannot be simulated for commit.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const canary = useMutation({
    mutationFn: (rowNumber: number) =>
      runCanary({ data: { batchId: preview.batch.id, rowNumber, confirm: true } }),
    onSuccess: async (verification) => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", preview.batch.id] });
      await queryClient.invalidateQueries({ queryKey: ["crm-import-automation"] });
      if (verification.status === "passed") {
        toast.success("Canary verified — one live lead created, zero side effects.");
      } else if (verification.status === "blocked") {
        toast.error("Canary blocked — nothing was created.");
      } else {
        toast.error("Canary verification failed — review the checklist.");
      }
    },
    onError: (error: Error) => {
      setConfirming(false);
      toast.error(error.message);
    },
  });

  const result = simulation.data;
  const sim = result?.status === "ok" ? result.simulation : null;
  const candidates = sim?.candidates ?? [];
  const selected = candidates.find((candidate) => candidate.row_number === selectedRow) ?? null;
  const canaryReady = Boolean(sim && selected) && !canary.isPending && !unsavedEdits;
  const verification = canary.data;

  return (
    <section id="import-simulation" className="panel space-y-4 p-4" aria-label="Commit gate">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
          {COMMIT_SIMULATION_LABEL}
        </p>
        <h2 className="mt-1 text-sm font-semibold">Commit simulation</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{SIMULATION_WARNING}</p>
        {unsavedEdits ? (
          <p className="mt-1 text-xs text-destructive">
            You have unsaved staged-row edits. Save or cancel them before importing — importing
            always uses the latest saved values.
          </p>
        ) : null}
      </div>
      <button
        type="button"
        disabled={simulation.isPending}
        onClick={() => simulation.mutate()}
        className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {simulation.isPending ? "Simulating…" : COMMIT_SIMULATION_LABEL}
      </button>

      {result && result.status !== "ok" ? (
        <p className="text-xs text-destructive">
          {result.status === "batch_already_committed"
            ? "This upload has already been committed, so it cannot be simulated."
            : "This upload is no longer available."}
        </p>
      ) : null}

      {sim ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {(
              [
                ["Total preview rows", sim.total_rows],
                ["Total candidates", sim.total_candidates],
                ["Would be created", sim.would_create],
                ["Blocked by validation", sim.blocked_by_validation],
                ["Blocked by duplicate status", sim.blocked_by_duplicate_status],
                ["Already committed", sim.already_committed],
                ["Skipped — pending", sim.skipped_pending],
                ["Skipped — excluded", sim.skipped_excluded],
                ["Previous failed attempts", sim.previous_failures],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-border p-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          <div>
            <h3 className="text-xs font-semibold">Candidates (simulated only — not imported)</h3>
            {candidates.length ? (
              <ul className="mt-1 space-y-1 text-xs">
                {candidates.map((candidate) => (
                  <li key={candidate.row_number} className="rounded-md border border-border p-2">
                    <p className="font-medium">
                      Row {candidate.row_number} · {candidate.name ?? "—"} ·{" "}
                      {candidate.mobile_number ?? "—"} · {candidate.email ?? "—"}
                    </p>
                    <p className="text-muted-foreground">
                      {candidate.source === "manual" ? "Manually included" : "Auto-included"} · key{" "}
                      {candidate.idempotency_key}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">No eligible candidates.</p>
            )}
          </div>

          {sim.blocked.length ? (
            <div>
              <h3 className="text-xs font-semibold">Blocked rows</h3>
              <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                {sim.blocked.map((entry) => (
                  <li key={entry.row_number}>
                    Row {entry.row_number}:{" "}
                    {entry.reasons
                      .map((reason) => COMMIT_BLOCK_LABELS[reason as CommitBlockReason] ?? reason)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              CANARY IMPORT
            </p>
            <p className="text-xs text-muted-foreground">
              Select exactly one candidate. Only that single row can be committed — there is no
              commit-all action. `include` does not mean imported.
            </p>
            <fieldset className="space-y-1">
              <legend className="sr-only">Choose one canary candidate</legend>
              {candidates.map((candidate) => (
                <label key={candidate.row_number} className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="canary-row"
                    value={candidate.row_number}
                    checked={selectedRow === candidate.row_number}
                    onChange={() => setSelectedRow(candidate.row_number)}
                  />
                  Row {candidate.row_number} — {candidate.name ?? "—"} (
                  {candidate.mobile_number ?? "—"})
                </label>
              ))}
            </fieldset>
            {selected ? (
              <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs">
                Selected for canary: row {selected.row_number} · {selected.name ?? "—"} ·{" "}
                {selected.mobile_number ?? "—"} · key {selected.idempotency_key}
              </p>
            ) : null}
            {confirming ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-foreground">
                  Confirm importing exactly one live lead for row {selected?.row_number}?
                </p>
                <button
                  type="button"
                  onClick={() => selected && canary.mutate(selected.row_number)}
                  disabled={!canaryReady}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {canary.isPending ? "Importing…" : "Yes — import this one lead"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-md border border-input px-3 py-1.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!canaryReady}
                onClick={() => setConfirming(true)}
                className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {CANARY_LABEL}
              </button>
            )}
            {verification ? (
              <CanaryResultCard
                result={verification}
                batchId={preview.batch.id}
                ranAt={verification.state?.last_run_at ?? null}
                gateReasons={verification.gate_reasons}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * ROLLOUT STATUS + CONTROLS.
 *
 * Shows the tenant's current import mode, why it is active, which safety gates
 * have passed, the last import summary and the pause kill switch. Advancing a
 * mode, pausing, resuming, running a bounded batch and running an exception-only
 * import are all explicit owner actions — nothing here advances on its own.
 */
function RolloutPanel({ batchId }: { batchId: string | null }) {
  const load = useServerFn(getImportAutomation);
  const setPause = useServerFn(setImportAutomationPause);
  const setMode = useServerFn(setImportAutomationMode);
  const runBounded = useServerFn(runImportBoundedBatch);
  const runExceptions = useServerFn(runImportExceptionOnly);
  const queryClient = useQueryClient();
  const [rowsInput, setRowsInput] = useState("");

  const { data } = useQuery({
    queryKey: ["crm-import-automation"],
    queryFn: () => load(),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["crm-import-automation"] });
    if (batchId) await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", batchId] });
  };

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => setPause({ data: { paused } }),
    onSuccess: async (state) => {
      await refresh();
      toast.success(
        state.paused
          ? "Automatic imports paused. Previewing and classification still run."
          : "Automatic imports resumed.",
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const modeMutation = useMutation({
    mutationFn: (mode: ImportMode) => setMode({ data: { mode } }),
    onSuccess: async (result) => {
      await refresh();
      if (result.ok) toast.success(`Import mode is now ${IMPORT_MODE_LABELS[result.state.mode]}.`);
      else toast.error(result.reasons.map((reason) => MODE_TRANSITION_LABELS[reason]).join(" "));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const boundedMutation = useMutation({
    mutationFn: (rowNumbers: number[]) =>
      runBounded({ data: { batchId: batchId!, rowNumbers, confirm: true } }),
    onSuccess: async (result) => {
      await refresh();
      if (result.status === "ok") {
        toast.success(
          `Bounded batch finished — ${result.summary.auto_imported + result.summary.manually_imported} live leads created.`,
        );
      } else if (result.status === "blocked") {
        toast.error(result.reasons.map((reason) => IMPORT_GATE_LABELS[reason]).join(" "));
      } else {
        toast.error("This upload is not available for importing.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const exceptionMutation = useMutation({
    mutationFn: () => runExceptions({ data: { batchId: batchId!, confirm: true } }),
    onSuccess: async (result) => {
      await refresh();
      if (result.status === "ok") {
        toast.success(
          `Import finished — ${result.summary.auto_imported} auto-imported, ${result.summary.pending_review} held for review.`,
        );
      } else if (result.status === "blocked") {
        toast.error(result.reasons.map((reason) => IMPORT_GATE_LABELS[reason]).join(" "));
      } else {
        toast.error("This upload is not available for importing.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const state = data?.state;
  if (!state) return null;

  const nextMode: ImportMode | null =
    state.mode === "preview_only"
      ? "canary_ready"
      : state.mode === "canary_ready"
        ? "bounded_batch"
        : state.mode === "bounded_batch"
          ? "exception_only"
          : null;

  const gates: [string, boolean][] = [
    ["Canary passed", Boolean(state.canary_passed_at)],
    ["Idempotency verified", Boolean(state.idempotency_verified_at)],
    ["Bounded batch passed", Boolean(state.bounded_batch_passed_at)],
    ["Exception-only enabled", Boolean(state.exception_only_enabled_at)],
  ];

  const parsedRows = [
    ...new Set(
      rowsInput
        .split(/[^0-9]+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];

  return (
    <section id="import-rollout" className="panel space-y-4 p-4" aria-label="Import rollout status">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">
            Import rollout
          </p>
          <h2 className="mt-1 text-sm font-semibold">
            Current mode: {IMPORT_MODE_LABELS[state.mode]}
            {state.paused ? " (paused)" : ""}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">{modeExplanation(state)}</p>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            {IMPORT_MODE_DESCRIPTIONS[state.mode]}
          </p>
        </div>
        <button
          type="button"
          disabled={pauseMutation.isPending}
          onClick={() => pauseMutation.mutate(!state.paused)}
          className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {state.paused ? "Resume automatic imports" : "Pause automatic imports"}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {gates.map(([label, passed]) => (
          <div key={label} className="rounded-md border border-border p-2">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-sm font-semibold">{passed ? "Yes" : "Not yet"}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        {nextMode ? (
          <button
            type="button"
            disabled={modeMutation.isPending}
            onClick={() => modeMutation.mutate(nextMode)}
            className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Advance to {IMPORT_MODE_LABELS[nextMode]}
          </button>
        ) : null}
        {state.mode !== "preview_only" && state.mode !== "disabled" ? (
          <button
            type="button"
            disabled={modeMutation.isPending}
            onClick={() => modeMutation.mutate("preview_only")}
            className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Step back to preview only
          </button>
        ) : null}
      </div>

      {batchId && (state.mode === "bounded_batch" || state.mode === "exception_only") ? (
        <div className="space-y-2 border-t border-border pt-3">
          <h3 className="text-xs font-semibold">Run an import for the selected upload</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-muted-foreground">
              Bounded batch rows (max {BOUNDED_BATCH_MAX_ROWS})
              <input
                value={rowsInput}
                onChange={(event) => setRowsInput(event.target.value)}
                placeholder="e.g. 2, 3, 4"
                aria-label="Row numbers for the bounded batch"
                className="mt-1 block w-40 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </label>
            <button
              type="button"
              disabled={
                boundedMutation.isPending ||
                parsedRows.length === 0 ||
                parsedRows.length > BOUNDED_BATCH_MAX_ROWS
              }
              onClick={() => boundedMutation.mutate(parsedRows)}
              className="rounded-md border border-input px-3 py-1.5 text-xs disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {boundedMutation.isPending ? "Importing…" : "Run bounded batch"}
            </button>
            {state.mode === "exception_only" ? (
              <button
                type="button"
                disabled={exceptionMutation.isPending}
                onClick={() => exceptionMutation.mutate()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {exceptionMutation.isPending
                  ? "Importing…"
                  : "Import clean rows and hold exceptions"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
