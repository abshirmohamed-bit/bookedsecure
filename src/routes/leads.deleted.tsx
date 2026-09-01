import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import {
  getDeletedLeads,
  permanentlyDeleteLeadsRequest,
  restoreLeadsRequest,
} from "@/lib/lead-deletion.functions";
import { importMethodLabel, leadSourceLabel } from "@/lib/lead-source";
import { maskPhone, toggleSelection } from "@/lib/lead-deletion";
import {
  buildPurgeConfirmation,
  isPurgeConfirmed,
  purgeButtonLabel,
  summarisePurgeResult,
  type PurgeResult,
} from "@/lib/lead-purge";
import { InboxPagination } from "@/components/InboxPagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/lead-pagination";

export const Route = createFileRoute("/leads/deleted")({
  head: () => ({
    meta: [
      { title: "Deleted leads — Glocast SMS Lead Response" },
      {
        name: "description",
        content:
          "Owner-only recovery view: review leads removed from the Glocast inbox and restore them in place with their original history intact.",
      },
      { property: "og:title", content: "Deleted leads — Glocast SMS Lead Response" },
      {
        property: "og:description",
        content: "Review and restore removed detailing leads without losing any history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DeletedLeadsPage,
});

function DeletedLeadsPage() {
  const fetchDeleted = useServerFn(getDeletedLeads);
  const restore = useServerFn(restoreLeadsRequest);
  const queryClient = useQueryClient();
  const [selection, setSelection] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  // Tenant-scoped and paginated on the server, exactly like the active inbox.
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["deleted-leads", { page, pageSize: DEFAULT_PAGE_SIZE }],
    queryFn: () => fetchDeleted({ data: { page, pageSize: DEFAULT_PAGE_SIZE } }),
  });

  const leads = useMemo(() => data?.leads ?? [], [data]);

  const restoreMutation = useMutation({
    mutationFn: () => restore({ data: { leadIds: selection, confirm: true as const } }),
    onSuccess: (result) => {
      toast.success(`${result.restored} of ${result.requested} leads restored`);
      setSelection([]);
      queryClient.invalidateQueries({ queryKey: ["deleted-leads"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  return (
    <AppShell title="Deleted leads">
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Deleted leads (recovery)</h1>
            <p className="text-xs text-muted-foreground">
              Owner-only. These leads are hidden from the active inbox and analytics. Their source,
              import history, conversations and audit trail are preserved, and restoring keeps the
              original record — nothing is re-imported or duplicated.
            </p>
          </div>
          <Link
            to="/leads"
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Back to leads
          </Link>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground">Loading deleted leads…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && (
          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">{data.page.totalCount} deleted</h2>
              <div className="flex items-center gap-2">
                {selection.length > 0 && (
                  <span className="text-xs text-muted-foreground">{selection.length} selected</span>
                )}
                <button
                  disabled={selection.length === 0 || restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate()}
                  className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {restoreMutation.isPending
                    ? "Restoring…"
                    : `Restore ${selection.length} ${selection.length === 1 ? "lead" : "leads"}`}
                </button>
                <button
                  onClick={() => setSelection([])}
                  className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground"
                >
                  Clear selection
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="w-10 px-4 py-2 font-medium">
                      <input
                        type="checkbox"
                        aria-label="Select all deleted leads"
                        checked={selection.length === leads.length && leads.length > 0}
                        onChange={(event) =>
                          setSelection(event.target.checked ? leads.map((lead) => lead.id) : [])
                        }
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                    </th>
                    <th className="px-4 py-2 font-medium">Customer</th>
                    <th className="px-4 py-2 font-medium">Mobile</th>
                    <th className="px-4 py-2 font-medium">Source</th>
                    <th className="px-4 py-2 font-medium">Deleted</th>
                    <th className="px-4 py-2 font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr key={lead.id} className="border-b border-border/60">
                      <td className="px-4 py-2.5">
                        <input
                          type="checkbox"
                          aria-label={`Select ${lead.name}`}
                          checked={selection.includes(lead.id)}
                          onChange={() => setSelection((current) => toggleSelection(current, lead.id))}
                          className="h-4 w-4 accent-[var(--color-primary)]"
                        />
                      </td>
                      <td className="px-4 py-2.5 font-medium">{lead.name}</td>
                      <td className="px-4 py-2.5 tabular text-xs text-muted-foreground">
                        {maskPhone(lead.mobile_number) ?? "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {leadSourceLabel(lead)}
                        {importMethodLabel(lead) && <> · via {importMethodLabel(lead)}</>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {lead.deleted_at
                          ? new Date(lead.deleted_at).toLocaleString("en-AU", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {lead.deletion_reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                  {leads.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        Nothing has been deleted from the inbox.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <InboxPagination
              page={data.page}
              isLoading={isFetching}
              label="deleted leads"
              onPageChange={(next) => {
                setPage(next);
                setSelection([]);
              }}
            />
          </section>
        )}
      </div>
    </AppShell>
  );
}
