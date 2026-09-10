// The only contact-import experience.
//
// Upload any contact list, the app quietly gets it ready (column matching,
// Australian mobile repair, name recovery, duplicate matching), then shows a
// plain-language summary and one button. No tables, no column mapping, no
// review queue, no repair tools. Every write goes through the owner-gated,
// tenant-scoped, import-only server path, which re-derives the same plan from
// freshly read rows before touching anything.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { MAX_CSV_BYTES } from "@/lib/csv-import";
import { readCommitState } from "@/lib/commit-gate";
import {
  NO_MESSAGES_COPY,
  PREPARE_COPY,
  PREPARE_STEPS,
  SAVE_ACTION_LABEL,
  SAVE_OUTCOME_LABELS,
  SKIP_REASON_LABELS,
  planImport,
  planSummaryLines,
  saveHeadline,
  type PlannableRow,
  type SaveReport,
  type SkipReason,
} from "@/lib/import-plan";
import { repairCrmImportPhones, saveCrmImportBatch } from "@/lib/csv-import.functions";
import type { getCrmImportBatch } from "@/lib/csv-import.functions";

type Preview = NonNullable<Awaited<ReturnType<typeof getCrmImportBatch>>>;

export function LiteImportPanel({
  preview,
  uploading,
  onUpload,
}: {
  preview: Preview | null;
  uploading: boolean;
  onUpload: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const prepareContacts = useServerFn(repairCrmImportPhones);
  const saveContacts = useServerFn(saveCrmImportBatch);
  const [report, setReport] = useState<SaveReport | null>(null);
  // Batches this session already prepared. Preparation is idempotent, so a
  // repeat run would be harmless — this only avoids pointless work.
  const preparedRef = useRef<Set<string>>(new Set());

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

  const plan =
    preview && !preparing
      ? planImport(
          preview.batch.id,
          preview.rows.map((row): PlannableRow => {
            const commit = readCommitState(row.normalized_payload);
            return {
              row_number: row.row_number,
              name: row.name,
              mobile_number: row.mobile_number,
              email: row.email,
              validation_errors: row.validation_errors as { code: string }[],
              dedupe_match_lead_id: row.dedupe_match_lead_id,
              duplicate_of_row: row.duplicate_of_row,
              commit_lead_id: commit.lead_id,
            };
          }),
        )
      : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!preview) throw new Error("There are no contacts ready to save.");
      return saveContacts({ data: { batchId: preview.batch.id } });
    },
    onSuccess: async (result) => {
      if (preview) {
        await queryClient.invalidateQueries({ queryKey: ["crm-import-batch", preview.batch.id] });
      }
      await queryClient.invalidateQueries({ queryKey: ["crm-import-batches"] });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      if (result.status !== "ok") {
        setReport(null);
        toast.error("That upload could not be found any more. Nothing was saved.");
        return;
      }
      setReport(result.report);
      if (result.report.failed > 0) toast.warning(saveHeadline(result.report));
      else toast.success(saveHeadline(result.report));
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const skipRows = plan
    ? (Object.entries(plan.skip_reason_counts) as [SkipReason, number][]).filter(
        ([, count]) => count > 0,
      )
    : [];
  const nothingToSave = plan ? plan.save === 0 && plan.update === 0 : true;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Import contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bring your old customers into your leads inbox — no clean-up needed.
        </p>
      </div>

      <section className="panel overflow-hidden" aria-label="Import your contacts">
        <div className="section-heading">Choose a contact file</div>
        <div className="space-y-4 p-4 sm:p-5">
          <p className="max-w-xl text-sm text-muted-foreground">
            Upload a contact list from your old system, however it is laid out. We match your
            columns, tidy up Australian mobile numbers and check what you already have before
            anything is saved. {NO_MESSAGES_COPY}
          </p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-primary/40 bg-secondary/35 px-6 py-10 text-center transition-colors hover:border-primary hover:bg-secondary/60 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">
              {busy ? "Getting your contacts ready…" : "Choose a contact file"}
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
              <p>{preparing ? PREPARE_COPY : "Reading your file… this only takes a moment."}</p>
              <ul className="space-y-0.5 text-xs">
                {PREPARE_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              <p className="text-xs">Nothing is saved until you choose to save.</p>
            </div>
          ) : null}
        </div>
      </section>

      {plan ? (
        <section className="panel space-y-4 p-6" aria-label="What is in your file">
          <ul className="space-y-1 text-sm">
            {planSummaryLines(plan).map((line) => (
              <li key={line} className="font-medium">
                {line}
              </li>
            ))}
          </ul>

          {skipRows.length ? (
            <div className="rounded-md border border-border bg-secondary/40 p-3">
              <p className="text-sm font-medium">Left out of this import</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {skipRows.map(([reason, count]) => (
                  <li key={reason}>
                    {count} · {SKIP_REASON_LABELS[reason]}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                A contact needs a working Australian mobile number so you can text them. Nothing
                you already have is changed or removed.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={save.isPending || nothingToSave}
              onClick={() => save.mutate()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {save.isPending ? "Saving contacts…" : SAVE_ACTION_LABEL}
            </button>
            <p className="text-xs text-muted-foreground">{NO_MESSAGES_COPY}</p>
          </div>

          {report ? (
            <div
              className="rounded-md border border-border bg-secondary/30 p-3"
              aria-label="What happened to each contact"
            >
              <p className="text-sm font-medium">{saveHeadline(report)}</p>
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {report.rows.slice(0, 200).map((row) => (
                  <li key={row.row_number}>
                    {row.name ?? `Contact ${row.row_number}`} · {SAVE_OUTCOME_LABELS[row.outcome]}
                  </li>
                ))}
              </ul>
              {report.rows.length > 200 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Showing the first 200 of {report.rows.length} contacts.
                </p>
              ) : null}
              {report.failed > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  You can press {SAVE_ACTION_LABEL} again to retry the contacts that could not be
                  saved. Contacts already saved will not be added twice.
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
        </section>
      )}
    </div>
  );
}
