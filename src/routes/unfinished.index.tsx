import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { deleteUnfinishedProspects, getUnfinishedProspects } from "@/lib/quote-funnel.functions";

export const Route = createFileRoute("/unfinished/")({
  head: () => {
    const title = "Unfinished enquiries — BookedSecure";
    const description =
      "People who started a quote and gave their mobile number without finishing. View only — nothing is texted to them.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: UnfinishedPage,
});

function UnfinishedPage() {
  const fetchProspects = useServerFn(getUnfinishedProspects);
  const removeProspects = useServerFn(deleteUnfinishedProspects);
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["unfinished-prospects", 90],
    queryFn: () => fetchProspects({ data: { days: 90 } }),
  });

  const prospects = data?.prospects ?? [];
  const allSelected = prospects.length > 0 && selected.length === prospects.length;

  const deletion = useMutation({
    mutationFn: (conversationIds: string[]) => removeProspects({ data: { conversationIds } }),
    onSuccess: (result) => {
      toast.success(
        result.deleted === 1 ? "Removed 1 unfinished enquiry" : `Removed ${result.deleted} unfinished enquiries`,
      );
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ["unfinished-prospects"] });
      queryClient.invalidateQueries({ queryKey: ["quote-funnel"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function confirmDelete(ids: string[]) {
    if (ids.length === 0 || deletion.isPending) return;
    const ok = window.confirm(
      ids.length === 1
        ? "Remove this unfinished enquiry? This can't be undone."
        : `Remove ${ids.length} unfinished enquiries? This can't be undone.`,
    );
    if (ok) deletion.mutate(ids);
  }

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <AppShell title="Unfinished enquiries">
      <div className="min-w-0 space-y-4">
        <header className="space-y-1">
          <h1 className="font-heading text-xl font-semibold">Unfinished enquiries</h1>
          <p className="text-sm text-muted-foreground">
            They gave a mobile number but didn't finish. Kept separate from your lead inbox, and
            nothing is ever texted to them — calling is your call.
          </p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && prospects.length === 0 && (
          <p className="panel p-8 text-center text-sm text-muted-foreground">
            Nothing unfinished right now.
          </p>
        )}

        {data && prospects.length > 0 && (
          <>
            <div className="panel flex flex-wrap items-center justify-between gap-2 p-3">
              <label className="flex min-h-10 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(allSelected ? [] : prospects.map((prospect) => prospect.conversationId))
                  }
                  aria-label="Select all unfinished enquiries"
                />
                {allSelected ? "Deselect all" : "Select all"}
                <span className="text-xs text-muted-foreground">
                  {selected.length > 0 ? `${selected.length} selected` : `${prospects.length} total`}
                </span>
              </label>
              <button
                type="button"
                disabled={selected.length === 0 || deletion.isPending}
                onClick={() => confirmDelete(selected)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-destructive/40 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete selected
              </button>
            </div>

            <ul className="space-y-3">
              {prospects.map((prospect) => {
                const checked = selected.includes(prospect.conversationId);
                return (
                  <li
                    key={prospect.conversationId}
                    className={`panel min-w-0 space-y-2 p-4 ${checked ? "ring-1 ring-primary/50" : ""}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <label className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={checked}
                          onChange={() => toggle(prospect.conversationId)}
                          aria-label={`Select ${prospect.name ?? prospect.mobile}`}
                        />
                        <span className="font-medium break-words">{prospect.name ?? "No name given"}</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {prospect.abandoned ? "Went quiet" : "In progress"}
                        </span>
                        <button
                          type="button"
                          disabled={deletion.isPending}
                          onClick={() => confirmDelete([prospect.conversationId])}
                          aria-label={`Delete ${prospect.name ?? prospect.mobile}`}
                          className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                      <Datum label="Mobile" value={prospect.mobile} />
                      <Datum label="Suburb" value={prospect.suburb ?? "—"} />
                      <Datum
                        label="Looking at"
                        value={prospect.services.length > 0 ? prospect.services.join(", ") : "—"}
                      />
                      <Datum label="Got as far as" value={prospect.stageLabel} />
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      Last activity {new Date(prospect.lastActivityAt).toLocaleString("en-AU")}
                    </p>
                    <a
                      href={`tel:${prospect.mobile.replace(/\s/g, "")}`}
                      className="inline-flex min-h-10 items-center rounded-md border border-input px-3 text-sm font-medium"
                    >
                      Call {prospect.name?.split(" ")[0] ?? "them"}
                    </a>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Datum({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
    </div>
  );
}
