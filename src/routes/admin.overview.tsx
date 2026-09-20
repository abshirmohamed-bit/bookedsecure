import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { getOwnerConsole } from "@/lib/owner-console.functions";
import type { TenantRow } from "@/lib/owner-console.server";

export const Route = createFileRoute("/admin/overview")({
  head: () => ({
    meta: [
      { title: "Control room | BookedSecure" },
      {
        name: "description",
        content:
          "Platform owner view: revenue, provider cost, profit, subscriptions and the jobs waiting on you.",
      },
      { property: "og:title", content: "Control room | BookedSecure" },
      {
        property: "og:description",
        content: "Revenue, provider cost, profit and the work queue for the platform owner.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerConsolePage,
});

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function OwnerConsolePage() {
  return (
    <AppShell title="Control room">
      <ConsoleView />
    </AppShell>
  );
}

function ConsoleView() {
  const fetchConsole = useServerFn(getOwnerConsole);
  const { data, isLoading, error } = useQuery({
    queryKey: ["owner-console"],
    queryFn: () => fetchConsole({ data: {} }),
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data)
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "This page is for the platform owner only."}
      </p>
    );

  const { money: summary, tenants, queue, pipeline } = data;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Money in this month" value={money(summary.revenueCents)} />
        <Tile label="Provider cost" value={money(summary.providerCostCents)} />
        <Tile label="Your profit" value={money(summary.marginCents)} />
        <Tile label="Texts sent" value={summary.segmentsSent.toLocaleString("en-AU")} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Paying businesses" value={String(summary.subscriptions.active)} />
        <Tile label="Payment problems" value={String(summary.subscriptions.pastDue)} />
        <Tile label="Cancelled" value={String(summary.subscriptions.canceled)} />
        <Tile label="Credit packs sold" value={money(summary.creditPackRevenueCents)} />
      </section>

      <section className="panel space-y-1 p-4">
        <h2 className="text-sm font-semibold">Money with the provider</h2>
        <p className="text-sm">
          {summary.providerBalance.known && summary.providerBalance.balanceCents !== null
            ? money(summary.providerBalance.balanceCents)
            : "Not available"}
        </p>
        <p className="text-xs text-muted-foreground">{summary.providerBalance.detail}</p>
      </section>

      <section className="panel space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Waiting on you</h2>
          <p className="text-xs text-muted-foreground">
            Buying numbers and topping up credits is still done by hand, so these are your jobs.
          </p>
        </div>
        <QueueList title="Needs a phone number" rows={queue.waitingOnNumber} />
        <QueueList title="Needs a credit top-up" rows={queue.waitingOnCredits} />
        <QueueList title="Business details not finished" rows={queue.incompleteCompliance} />
        <QueueList title="Payment failed" rows={queue.paymentProblem} />
      </section>

      <section className="panel space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold">Tenants arriving</h2>
          <p className="text-xs text-muted-foreground">
            Send new businesses to your start page. Add <code>?ref=</code> to any ad or partner link
            and it shows up here.
          </p>
        </div>
        <InviteLink />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Signed up this week" value={String(pipeline.signupsThisWeek)} />
          <Tile label="Signed up this month" value={String(pipeline.signupsThisMonth)} />
          <Tile label="Started paying this month" value={String(pipeline.subscribedThisMonth)} />
          <Tile label="Sign-ups that pay" value={`${pipeline.conversionPercent}%`} />
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium">Where they came from</p>
          {pipeline.bySource.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">No sign-ups yet.</p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {pipeline.bySource.map((row) => (
                <li key={row.source}>
                  {row.source}: {row.signups} signed up, {row.subscribed} paying
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium">
            Not paying yet{" "}
            <span className="text-muted-foreground">({pipeline.notYetPaying.length})</span>
          </p>
          {pipeline.notYetPaying.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">Everyone who signed up is paying.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-xs">
              {pipeline.notYetPaying.map((row) => (
                <li key={row.businessId} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <span>{row.stuckStep ?? "Setup finished, waiting on a plan"}</span>
                  <span>· from {row.signupSource ?? "direct"}</span>
                  {row.signupAt ? (
                    <span>· {new Date(row.signupAt).toLocaleDateString("en-AU")}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="panel space-y-2 p-4">
        <h2 className="text-sm font-semibold">Businesses</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Business</th>
                <th className="py-1.5 pr-3 font-medium">Trade</th>
                <th className="py-1.5 pr-3 font-medium">Plan</th>
                <th className="py-1.5 pr-3 font-medium">Subscription</th>
                <th className="py-1.5 pr-3 font-medium">Number</th>
                <th className="py-1.5 pr-3 font-medium">Credits</th>
                <th className="py-1.5 pr-3 font-medium">Customers</th>
                <th className="py-1.5 pr-3 font-medium">Texts</th>
                <th className="py-1.5 font-medium">Profit</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.businessId} className="border-t border-border">
                  <td className="py-1.5 pr-3">{tenant.name}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{tenant.trade ?? "Not available"}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{tenant.planId}</td>
                  <td className="py-1.5 pr-3">{tenant.subscriptionStatus}</td>
                  <td className="py-1.5 pr-3">{tenant.numbers > 0 ? "Yes" : "No"}</td>
                  <td className="py-1.5 pr-3">{tenant.creditBalance}</td>
                  <td className="py-1.5 pr-3">{tenant.leads}</td>
                  <td className="py-1.5 pr-3">{tenant.segmentsSent}</td>
                  <td className="py-1.5">{money(tenant.marginCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function InviteLink() {
  const url =
    typeof window === "undefined" ? "/start" : `${window.location.origin}/start?ref=your-campaign`;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
      <code className="min-w-0 flex-1 truncate text-xs">{url}</code>
      <button
        type="button"
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        onClick={() => {
          void navigator.clipboard?.writeText(url);
          toast.success("Invite link copied.");
        }}
      >
        Copy
      </button>
      <a
        href="/start"
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
      >
        Open
      </a>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function QueueList({ title, rows }: { title: string; rows: TenantRow[] }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium">
        {title} <span className="text-muted-foreground">({rows.length})</span>
      </p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Nothing waiting.</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {rows.map((row) => (
            <li key={row.businessId} className="truncate text-xs text-muted-foreground">
              {row.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
