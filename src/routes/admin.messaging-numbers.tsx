import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  addTextoNumberToPool,
  getTextoNumberPoolOverview,
  retryTextoProvisioning,
  syncTextoNumberPool,
} from "@/lib/sms/texto-accounts.functions";
import { listBusinessIdentityRecords } from "@/lib/tenant-identity.functions";

const TITLE = "Dedicated numbers — BookedSecure admin";

export const Route = createFileRoute("/admin/messaging-numbers")({
  head: () => ({
    meta: [
      { title: TITLE },
      {
        name: "description",
        content:
          "Platform view of the dedicated Australian number pool: sync numbers bought at Texto, see which tenant holds each one, and retry tenants waiting on a number.",
      },
      { property: "og:title", content: TITLE },
      {
        property: "og:description",
        content: "Sync, assign and retry dedicated SMS numbers for BookedSecure tenants.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AppShell title="Dedicated numbers">
      <NumberPool />
    </AppShell>
  ),
  errorComponent: ({ error }) => (
    <AppShell title="Dedicated numbers">
      <div className="panel p-4">
        <h1 className="page-heading">Dedicated numbers</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </AppShell>
  ),
});

const STATE_LABELS: Record<string, string> = {
  queued_no_number: "Waiting for a number",
  failed: "Failed",
  provisioning: "In progress",
  not_started: "Not started",
};

function NumberPool() {
  const fetchOverview = useServerFn(getTextoNumberPoolOverview);
  const sync = useServerFn(syncTextoNumberPool);
  const retry = useServerFn(retryTextoProvisioning);
  const addNumber = useServerFn(addTextoNumberToPool);
  const queryClient = useQueryClient();
  const [manualNumber, setManualNumber] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-number-pool"],
    queryFn: () => fetchOverview({}),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin-number-pool"] });
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong.");

  const syncMutation = useMutation({
    mutationFn: () => sync({}),
    onSuccess: async (result) => {
      toast.success(
        result.live
          ? `Synced ${result.seen} numbers from Texto (${result.added} new, ${result.updated} updated).`
          : "Live Texto provisioning is off — showing the local pool only.",
      );
      await refresh();
    },
    onError: fail,
  });

  const retryMutation = useMutation({
    mutationFn: (businessId: string) => retry({ data: { businessId } }),
    onSuccess: async (result) => {
      if (result.ok) toast.success(`Assigned ${result.number}.`);
      else toast.warning(result.reason);
      await refresh();
    },
    onError: fail,
  });

  const addMutation = useMutation({
    mutationFn: (number: string) => addNumber({ data: { number } }),
    onSuccess: async () => {
      toast.success("Number added to the pool.");
      setManualNumber("");
      await refresh();
    },
    onError: fail,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading number pool…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const available = data.numbers.filter((n) => n.status === "available").length;

  return (
    <section className="grid gap-4">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <div className="mr-auto">
          <h1 className="page-heading">Dedicated numbers</h1>
          <p className="text-xs text-muted-foreground">
            {available} available · {data.numbers.length - available} assigned ·{" "}
            {data.liveProvisioning ? "Live Texto sync on" : "Simulated (live sync off)"}
            {data.liveSubaccounts ? " · sub-accounts on" : ""}
          </p>
        </div>
        <Button type="button" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? "Syncing…" : "Sync numbers from Texto"}
        </Button>
      </div>

      <div className="panel grid gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">Tenants waiting on a number</h2>
        {data.awaiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is waiting.</p>
        ) : (
          <ul className="grid gap-2">
            {data.awaiting.map((row) => (
              <li key={row.businessId} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="mr-auto">
                  <span className="font-medium text-foreground">{row.businessName ?? "Unknown business"}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {STATE_LABELS[row.state] ?? row.state} · since {new Date(row.since).toLocaleString("en-AU")}
                  </span>
                  {row.failedReason ? (
                    <span className="block text-xs text-destructive">{row.failedReason}</span>
                  ) : null}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate(row.businessId)}
                >
                  Retry
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <IdentityRecords />

      <div className="panel grid gap-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">Number pool</h2>
        {data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No numbers yet. Buy dedicated numbers in the Texto dashboard, then sync — or add one manually below.
          </p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {data.numbers.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 border-b border-border py-1.5 last:border-0">
                <span className="font-mono text-foreground">{n.number}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
                  {n.status}
                </span>
                <span className="text-xs text-muted-foreground">${(n.monthlyCostCents / 100).toFixed(2)}/mo</span>
                {n.assignedBusinessName ? (
                  <span className="ml-auto text-xs text-muted-foreground">{n.assignedBusinessName}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (manualNumber.trim()) addMutation.mutate(manualNumber.trim());
          }}
        >
          <input
            aria-label="Number in E.164 format"
            value={manualNumber}
            onChange={(event) => setManualNumber(event.target.value)}
            placeholder="+614…"
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <Button type="submit" size="sm" variant="outline" disabled={addMutation.isPending}>
            Add manually
          </Button>
        </form>
      </div>
    </section>
  );
}

/**
 * Who each number belongs to. BookedSecure buys every number itself, so this is
 * the single place to answer an ownership request from an authority.
 */
function IdentityRecords() {
  const fetchRecords = useServerFn(listBusinessIdentityRecords);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-business-identities"],
    queryFn: () => fetchRecords({}),
    retry: false,
  });

  return (
    <div className="panel grid gap-3 p-4">
      <h2 className="text-sm font-semibold text-foreground">Business identity records</h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading records…</p>
      ) : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : !data || data.records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No business has completed its identity details yet.
        </p>
      ) : (
        <ul className="grid gap-2 text-sm">
          {data.records.map((row) => (
            <li key={row.businessId} className="border-b border-border pb-2 last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{row.legalName || row.businessName}</span>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-foreground">
                  {row.complete ? "complete" : "incomplete"}
                </span>
                {row.numbers.length > 0 ? (
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {row.numbers.join(", ")}
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-muted-foreground">no number</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                ABN {row.abn || "—"} · {row.suburb} {row.state} · {row.contactName} ·{" "}
                {row.contactEmail} · {row.contactPhone}
                {row.submittedAt
                  ? ` · declared ${new Date(row.submittedAt).toLocaleString("en-AU")}`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
