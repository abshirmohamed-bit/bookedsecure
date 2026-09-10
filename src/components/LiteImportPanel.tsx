// Simple ("Lite") CRM import experience — the default view for every user.
//
// It renders an upload zone, a processing state, a plain-language summary and a
// single primary action. It exposes no raw tables, column mappings, row
// selectors, simulation controls, audit logs or repair fields. Every number it
// shows comes from the SAME shared preview rows and the SAME shared eligibility
// engine as the advanced view, and the sync action calls the existing controlled
// server import paths, which re-run every safety check before any write.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { MAX_CSV_BYTES } from "@/lib/csv-import";
import {
  ADVANCED_VIEW_LABEL,
  HELD_HEADLINE,
  HELD_NEXT_STEP_COPY,
  HELD_SAFETY_COPY,
  LITE_HOLD_REASON_LABELS,
  LITE_NO_MESSAGES_COPY,
  LITE_PREPARE_COPY,
  LITE_PREPARE_SAFETY_COPY,
  LITE_PREPARE_STEPS,
  LITE_SYNC_OUTCOME_LABELS,
  SYNC_ACTION_LABEL,
  SYNC_BLOCK_COPY,
  advancedHighlight,
  buildLiteSummary,
  buildLiteSyncReport,
  liteSummaryLines,
  liteSyncHeadline,
  planLiteSync,
  type LiteHoldReason,
  type LiteSyncReport,
} from "@/lib/import-lite";
import {
  getImportAutomation,
  runImportBoundedBatch,
  runImportExceptionOnly,
} from "@/lib/import-automation.functions";
import { repairCrmImportPhones } from "@/lib/csv-import.functions";
import type { getCrmImportBatch } from "@/lib/csv-import.functions";

type Preview = NonNullable<Awaited<ReturnType<typeof getCrmImportBatch>>>;

/** Respect the operating-system reduced-motion preference. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function LiteImportPanel({
  preview,
  uploading,
  onUpload,
  onOpenAdvanced,
}: {
  preview: Preview | null;
  uploading: boolean;
  onUpload: (file: File) => void;
  /** Optional. Omitted when there is no technical view to open. */
  onOpenAdvanced?: (options: { focusExceptions: boolean }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const loadAutomation = useServerFn(getImportAutomation);
  const runBounded = useServerFn(runImportBoundedBatch);
  const runExceptions = useServerFn(runImportExceptionOnly);
  const prepareContacts = useServerFn(repairCrmImportPhones);
  const [report, setReport] = useState<LiteSyncReport | null>(null);
  // Batches this session has already prepared. Preparation is idempotent, so a
  // repeat run would be harmless — this only avoids pointless work.
  const preparedRef = useRef<Set<string>>(new Set());

  const automation = useQuery({
    queryKey: ["crm-import-automation"],
    queryFn: () => loadAutomation(),
  });

  // AUTOMATED PREPARATION: the simple view runs the existing owner-gated
  // deterministic preparation pass for the owner instead of asking them to.
  // The server pass corrects Australian phone formats with the single shared
  // repair engine, keeps every original value and repair reason, revalidates
  // each row, re-runs the tenant-scoped duplicate preflight and re-classifies.
  // It writes to staged preview rows only — never to leads.
  const prepare = useMutation({
    mutationFn: (batchId: string) => prepareContacts({ data: { batchId } }),
    onSuccess: async (_result, batchId) => {
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", batchId] });
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batches"] });
    },
    onError: () =>
      toast.error("We could not finish getting your contacts ready. Nothing was saved."),
  });

  const batchId = preview?.batch.id ?? null;
  useEffect(() => {
    if (!batchId || preparedRef.current.has(batchId) || prepare.isPending) return;
    preparedRef.current.add(batchId);
    setReport(null);
    prepare.mutate(batchId);
    // `prepare` is a stable mutation handle; the batch id is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  const preparing = prepare.isPending;
  const busy = uploading || preparing;

  const summary =
    preview && !preparing ? buildLiteSummary(preview.batch.id, preview.rows as never) : null;
  const plan = summary ? planLiteSync(summary, automation.data?.state) : null;
  const highlight = advancedHighlight({ held: summary?.reviewable ?? 0, reducedMotion });

  const sync = useMutation({
    mutationFn: async () => {
      if (!preview || !plan?.ok) throw new Error("There are no contacts ready to save.");
      // Existing controlled execution paths only. The server revalidates each
      // row, its duplicates, its idempotency key, the tenant, the rollout state
      // and the pause switch immediately before any write.
      return plan.path === "bounded"
        ? runBounded({
            data: { batchId: preview.batch.id, rowNumbers: plan.rowNumbers, confirm: true },
          })
        : runExceptions({ data: { batchId: preview.batch.id, confirm: true } });
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["crm-import-automation"] });
      if (preview) {
        await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", preview.batch.id] });
      }
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batches"] });
      if (result.status === "ok") {
        // Per-row outcomes come straight from the server run summary, so a
        // partial failure is reported honestly rather than as a success.
        const next = buildLiteSyncReport(result.summary);
        setReport(next);
        if (next.failed > 0) toast.warning(liteSyncHeadline(next));
        else toast.success(liteSyncHeadline(next));
      } else {
        setReport(null);
        toast.error("Saving contacts is not available for your business right now.");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const holdRows = summary
    ? (Object.entries(summary.hold_reason_counts) as [LiteHoldReason, number][]).filter(
        ([reason, count]) => count > 0 && reason !== "already_saved",
      )
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Import contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring old leads into one organised, reviewable workspace.
        </p>
      </div>
      <section className="panel overflow-hidden" aria-label="Import your contacts">
        <div className="section-heading">Choose a contact file</div>
        <div className="space-y-4 p-4 sm:p-5">
          <div>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Upload a contact list from your old system. We check every contact first and show you
              a simple summary before anything is saved. {LITE_NO_MESSAGES_COPY}
            </p>
          </div>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-primary/40 bg-secondary/35 px-6 py-10 text-center transition-colors hover:border-primary hover:bg-secondary/60 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">
              {busy ? "Checking your contacts…" : "Choose a contact file"}
            </span>
            <span className="text-xs text-muted-foreground">CSV file, up to 2 MB</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            aria-label="Choose a contact file to import"
            accept=".csv,text/csv,.tsv,text/tab-separated-values"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              if (file.size > MAX_CSV_BYTES) {
                toast.error("That file is larger than 2 MB.");
                return;
              }
              onUpload(file);
            }}
          />

          {busy ? (
            <div role="status" className="space-y-1 text-sm text-muted-foreground">
              <p>
                {preparing
                  ? LITE_PREPARE_COPY
                  : "Checking your contacts… this only takes a moment."}
              </p>
              <ul className="space-y-0.5 text-xs">
                {LITE_PREPARE_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              <p className="text-xs">{LITE_PREPARE_SAFETY_COPY}</p>
            </div>
          ) : null}
        </div>
      </section>

      {summary ? (
        <section className="panel space-y-4 p-6" aria-label="Contact check results">
          <ul className="space-y-1 text-sm">
            {liteSummaryLines(summary).map((line) => (
              <li key={line} className="font-medium">
                {line}
              </li>
            ))}
          </ul>

          {summary.held > 0 ? (
            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <p className="text-sm font-medium">{HELD_HEADLINE}</p>
              <p className="mt-1 text-xs text-muted-foreground">{HELD_SAFETY_COPY}</p>
              <p className="mt-1 text-xs text-muted-foreground">{HELD_NEXT_STEP_COPY}</p>
              {holdRows.length ? (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {holdRows.map(([reason, count]) => (
                    <li key={reason}>
                      {count} · {LITE_HOLD_REASON_LABELS[reason]}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={sync.isPending || !plan?.ok}
              onClick={() => sync.mutate()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {sync.isPending ? "Saving contacts…" : SYNC_ACTION_LABEL}
            </button>

            <div className="flex flex-col gap-1">
              {onOpenAdvanced ? (
                <button
                  type="button"
                  aria-label={highlight.ariaLabel}
                  onClick={() => onOpenAdvanced({ focusExceptions: highlight.highlight })}
                  className={`rounded-md border border-input px-4 py-2 text-sm motion-reduce:animate-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${highlight.className}`}
                >
                  {ADVANCED_VIEW_LABEL}
                </button>
              ) : null}
              {highlight.annotation ? (
                <p className="text-left text-xs text-muted-foreground">{highlight.annotation}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Everything is reviewed — nothing needs your attention.
                </p>
              )}
            </div>
          </div>

          {plan && !plan.ok ? (
            <p className="text-xs text-muted-foreground">{SYNC_BLOCK_COPY[plan.reason]}</p>
          ) : null}

          {report ? (
            <div
              className="rounded-md border border-border bg-secondary/30 p-3"
              aria-label="What happened to each contact"
            >
              <p className="text-sm font-medium">{liteSyncHeadline(report)}</p>
              {report.partial_failure ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Only part of this upload was saved. The contacts already saved stay saved — trying
                  again will not add them twice.
                </p>
              ) : null}
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {report.rows.map((row) => (
                  <li key={row.row_number}>
                    Contact {row.row_number} · {LITE_SYNC_OUTCOME_LABELS[row.outcome]}
                  </li>
                ))}
              </ul>
              {report.failed > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  You can press {SYNC_ACTION_LABEL} again to retry the contacts that could not be
                  saved.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <section className="panel p-6 text-center">
          <h2 className="text-sm font-semibold">No contacts uploaded yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Upload a contact file to see how many contacts are ready to save.
          </p>
          {onOpenAdvanced ? (
            <button
              type="button"
              aria-label={highlight.ariaLabel}
              onClick={() => onOpenAdvanced?.({ focusExceptions: false })}
              className="mt-3 rounded-md border border-input px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {ADVANCED_VIEW_LABEL}
            </button>
          ) : null}
        </section>
      )}
    </div>
  );
}
