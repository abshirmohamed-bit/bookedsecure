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
  SYNC_ACTION_LABEL,
  SYNC_BLOCK_COPY,
  advancedHighlight,
  buildLiteSummary,
  liteSummaryLines,
  planLiteSync,
  type LiteHoldReason,
} from "@/lib/import-lite";
import { getImportAutomation, runImportBoundedBatch, runImportExceptionOnly } from "@/lib/import-automation.functions";
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
  onOpenAdvanced: (options: { focusExceptions: boolean }) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reducedMotion = useReducedMotion();
  const queryClient = useQueryClient();
  const loadAutomation = useServerFn(getImportAutomation);
  const runBounded = useServerFn(runImportBoundedBatch);
  const runExceptions = useServerFn(runImportExceptionOnly);

  const automation = useQuery({
    queryKey: ["crm-import-automation"],
    queryFn: () => loadAutomation(),
  });

  const summary = preview ? buildLiteSummary(preview.batch.id, preview.rows as never) : null;
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
        const saved = result.summary.auto_imported + result.summary.manually_imported;
        toast.success(
          `${saved} ${saved === 1 ? "contact" : "contacts"} saved. ${result.summary.pending_review} held for your review.`,
        );
      } else {
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
    <div className="space-y-6">
      <section className="panel space-y-4 p-6" aria-label="Import your contacts">
        <div>
          <h2 className="text-base font-semibold">Import your contacts</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Upload a contact list from your old system. We check every contact first and show you a
            simple summary before anything is saved. {LITE_NO_MESSAGES_COPY}
          </p>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-input bg-secondary/20 px-6 py-10 text-center hover:bg-secondary/40 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">
            {uploading ? "Checking your contacts…" : "Choose a contact file"}
          </span>
          <span className="text-xs text-muted-foreground">CSV file, up to 2 MB</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          aria-label="Choose a contact file to import"
          accept=".csv,text/csv,.tsv,text/tab-separated-values"
          className="sr-only"
          disabled={uploading}
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

        {uploading ? (
          <p role="status" className="text-sm text-muted-foreground">
            Checking your contacts… this only takes a moment.
          </p>
        ) : null}
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
              <button
                type="button"
                aria-label={highlight.ariaLabel}
                onClick={() => onOpenAdvanced({ focusExceptions: highlight.highlight })}
                className={`rounded-md border border-input px-4 py-2 text-sm motion-reduce:animate-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${highlight.className}`}
              >
                {ADVANCED_VIEW_LABEL}
              </button>
              {highlight.annotation ? (
                <button
                  type="button"
                  onClick={() => onOpenAdvanced({ focusExceptions: true })}
                  className="text-left text-xs text-muted-foreground underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {highlight.annotation}
                </button>
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
        </section>
      ) : (
        <section className="panel p-6 text-center">
          <h2 className="text-sm font-semibold">No contacts uploaded yet</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            Upload a contact file to see how many contacts are ready to save.
          </p>
          <button
            type="button"
            aria-label={highlight.ariaLabel}
            onClick={() => onOpenAdvanced({ focusExceptions: false })}
            className="mt-3 rounded-md border border-input px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {ADVANCED_VIEW_LABEL}
          </button>
        </section>
      )}
    </div>
  );
}
