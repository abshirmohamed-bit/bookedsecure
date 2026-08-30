import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { ERROR_LABELS, MAX_CSV_BYTES } from "@/lib/csv-import";
import {
  getCrmImportBatch,
  listCrmImportBatches,
  previewCrmImport,
} from "@/lib/csv-import.functions";

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

type Preview = Awaited<ReturnType<typeof getCrmImportBatch>>;

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
  const [preview, setPreview] = useState<Preview | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["crm-import-batches"],
    queryFn: () => fetchBatches(),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_CSV_BYTES) throw new Error("The file is larger than 2 MB.");
      const content = await file.text();
      return upload({ data: { filename: file.name, content } });
    },
    onSuccess: (result) => {
      setPreview(result);
      toast.success(`Preview ready — ${result.batch.total_rows} rows staged, nothing imported.`);
      void refetch();
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void refetch();
    },
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
          accept=".csv,text/csv"
          disabled={uploadMutation.isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadMutation.mutate(file);
          }}
          className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {uploadMutation.isPending ? (
          <p className="text-xs text-muted-foreground">Parsing and validating…</p>
        ) : null}
      </section>

      {data?.batches?.length ? (
        <section className="panel p-4">
          <h2 className="text-sm font-semibold">Recent uploads</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {data.batches.map((batch) => (
              <li key={batch.id} className="flex flex-wrap items-center justify-between gap-2">
                <button
                  className="text-left underline-offset-2 hover:underline"
                  onClick={async () => {
                    try {
                      setPreview(await fetchBatch({ data: { batchId: batch.id } }));
                    } catch (error) {
                      toast.error((error as Error).message);
                    }
                  }}
                >
                  {batch.filename ?? "CSV upload"}
                </button>
                <span className="text-xs text-muted-foreground">
                  {batch.status} · {batch.total_rows} rows · {batch.invalid_rows} with issues ·{" "}
                  {batch.duplicate_rows} duplicates
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {preview ? <PreviewTable preview={preview} /> : null}
    </div>
  );
}

function PreviewTable({ preview }: { preview: Preview }) {
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Preview — {preview.batch.filename}</h2>
        <span className="text-xs text-muted-foreground">
          batch {preview.batch.status} · {preview.batch.total_rows} rows ·{" "}
          {preview.batch.valid_rows} clean · {preview.batch.invalid_rows} with issues ·{" "}
          {preview.batch.duplicate_rows} duplicates
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
                    <div>source: {payload.source_channel ?? "—"}</div>
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
                  <td className="py-2 pr-3">{row.decision}</td>
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
