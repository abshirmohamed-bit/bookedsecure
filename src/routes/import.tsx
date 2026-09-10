import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { MAX_CSV_BYTES } from "@/lib/csv-import";
import {
  deleteCrmImportBatch,
  getCrmImportBatch,
  listCrmImportBatches,
  previewCrmImport,
} from "@/lib/csv-import.functions";
import {
  batchCountsLine,
  batchIdentityLine,
  canDeleteBatch,
  formatUploadTimestamp,
  resolveSelectedBatchId,
  type ImportBatchSummary,
} from "@/lib/import-history";
import { LiteImportPanel } from "@/components/LiteImportPanel";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Add your old customers — BookedSecure" },
      {
        name: "description",
        content:
          "Upload a contact file and BookedSecure saves your past customers into your leads inbox.",
      },
      { property: "og:title", content: "Add your old customers — BookedSecure" },
      {
        property: "og:description",
        content: "Upload a contact file and save your past customers into your leads inbox.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ImportPage,
});

function ImportPage() {
  return (
    <AppShell title="Add your old customers">
      <ImportView />
    </AppShell>
  );
}

/**
 * The only import experience: upload a contact file, see a plain-language
 * summary, save the contacts into the leads inbox. Every number and every write
 * still goes through the same shared preview rows, eligibility engine and
 * controlled server import paths, which re-run all safety checks.
 */
function ImportView() {
  const fetchBatches = useServerFn(listCrmImportBatches);
  const upload = useServerFn(previewCrmImport);
  const fetchBatch = useServerFn(getCrmImportBatch);
  const removeBatch = useServerFn(deleteCrmImportBatch);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["crm-import-batches"],
    queryFn: () => fetchBatches(),
  });

  const batches = (data?.batches ?? []) as ImportBatchSummary[];
  const activeId = resolveSelectedBatchId(batches, selectedId);
  const activeBatch = batches.find((batch) => batch.id === activeId) ?? null;

  const preview = useQuery({
    queryKey: ["crm-import-batch", activeId],
    queryFn: () => fetchBatch({ data: { batchId: activeId! } }),
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
      toast.success(`${result.batch.total_rows} contacts read. Nothing saved yet.`);
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
      if (selectedId === result.batchId || activeId === result.batchId) setSelectedId(null);
      queryClient.removeQueries({ queryKey: ["crm-import-batch", result.batchId] });
      await refetch();
      toast.success("Upload removed. None of your saved contacts changed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (data && data.role !== "owner") {
    return (
      <p className="text-sm text-muted-foreground">
        Only the business owner can add old customers.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <LiteImportPanel
        preview={preview.data && preview.data.batch.id === activeId ? preview.data : null}
        uploading={uploadMutation.isPending || preview.isLoading}
        onUpload={(file) => uploadMutation.mutate(file)}
      />

      {batches.length > 0 ? (
        <section className="panel space-y-2 p-4">
          <h2 className="text-sm font-semibold">Your uploads</h2>
          <ul className="space-y-2">
            {batches.map((batch) => (
              <li
                key={batch.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 ${
                  batch.id === activeId ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(batch.id)}
                  className="min-w-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <p className="truncate text-xs font-medium">{batchIdentityLine(batch)}</p>
                  <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                    {formatUploadTimestamp(batch.created_at)} · {batchCountsLine(batch)}
                  </p>
                </button>
                {canDeleteBatch(batch) ? (
                  <button
                    type="button"
                    aria-label="Remove this upload"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(batch.id)}
                    className="shrink-0 rounded-md border border-input p-1.5 text-muted-foreground hover:text-foreground disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
