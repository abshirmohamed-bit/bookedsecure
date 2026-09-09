import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BarChart3, Clock3, MessageCircleReply, WalletCards } from "lucide-react";
import { getAnalytics } from "@/lib/app.functions";
import { SmsDeliveryPanel } from "@/components/SmsDeliveryPanel";
import { SOURCE_LABELS, formatCurrency, formatMinutes } from "@/lib/domain";

export function AnalyticsOverview() {
  const fetchAnalytics = useServerFn(getAnalytics);
  const [range, setRange] = useState({ from: "", to: "" });

  const { data, isLoading, error } = useQuery({
    queryKey: ["analytics", range],
    queryFn: () =>
      fetchAnalytics({ data: { from: range.from || null, to: range.to || null, source: null } }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading analytics…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  const funnel = [
    ["Total enquiries", data.funnel.enquiries],
    ["Contacted", data.funnel.contacted],
    ["Replied", data.funnel.replied],
    ["Quote ready", data.funnel.quoteReady],
    ["Quote sent", data.funnel.quoteSent],
    ["Scheduled", data.funnel.scheduled],
    ["Completed", data.funnel.completed],
    ["Lost", data.funnel.lost],
  ] as const;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        See which channels turn enquiries into completed work.
      </p>
      <div className="panel grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:justify-between">
        <p className="truncate text-sm font-semibold">Reporting period</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
            className="rounded-md border border-input bg-background px-2 py-1.5"
          />
          {(range.from || range.to) && (
            <button
              onClick={() => setRange({ from: "", to: "" })}
              className="text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <section className="panel overflow-hidden">
        <h2 className="section-heading">Funnel</h2>
        <div className="space-y-2 p-4">
          {funnel.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
              <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${data.funnel.enquiries ? (value / data.funnel.enquiries) * 100 : 0}%`,
                  }}
                />
              </div>
              <span className="w-8 shrink-0 tabular text-right text-xs">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2 className="section-heading">By source channel (never combined)</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Leads</th>
                <th className="px-4 py-2 font-medium">Median response</th>
                <th className="px-4 py-2 font-medium">Reply rate</th>
                <th className="px-4 py-2 font-medium">Completed jobs</th>
                <th className="px-4 py-2 font-medium">Completed rate</th>
                <th className="px-4 py-2 text-right font-medium">Completed revenue</th>
                <th className="px-4 py-2 text-right font-medium">Avg job</th>
              </tr>
            </thead>
            <tbody>
              {data.bySource.map((row) => (
                <tr key={row.source} className="border-b border-border/60">
                  <td className="px-4 py-2.5">{SOURCE_LABELS[row.source] ?? row.source}</td>
                  <td className="px-4 py-2.5 tabular">{row.leads}</td>
                  <td className="px-4 py-2.5 tabular">
                    {formatMinutes(row.medianResponseMinutes)}
                  </td>
                  <td className="px-4 py-2.5 tabular">{Math.round(row.replyRate * 100)}%</td>
                  <td className="px-4 py-2.5 tabular">{row.completedJobs}</td>
                  <td className="px-4 py-2.5 tabular">{Math.round(row.completedRate * 100)}%</td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {formatCurrency(row.completedRevenue)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular">
                    {row.averageJobValue ? formatCurrency(row.averageJobValue) : "—"}
                  </td>
                </tr>
              ))}
              {data.bySource.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No leads in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={Clock3}
          tone="success"
          label="Within 5 minutes"
          value={`${Math.round(data.withinFiveMinutes * 100)}%`}
        />
        <Stat
          icon={BarChart3}
          tone="info"
          label="Form completion"
          value={`${Math.round(data.formCompletionRate * 100)}%`}
        />
        <Stat
          icon={MessageCircleReply}
          tone="primary"
          label="Opt-outs"
          value={String(data.optOuts)}
        />
        <Stat
          icon={WalletCards}
          tone="destructive"
          label="Delivery failures"
          value={String(data.deliveryFailures)}
        />
      </section>

      <SmsDeliveryPanel />

      <p className="text-xs text-muted-foreground">
        Completed-job revenue is the sum of completed_value for jobs explicitly marked completed.
        Scheduled and quoted work is never counted. Differences against baseline may also reflect
        seasonality, lead quality, advertising changes, capacity or pricing — not necessarily this
        system.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Clock3;
  tone: "primary" | "success" | "info" | "destructive";
}) {
  const toneClass = {
    primary: "bg-primary/12 text-primary",
    success: "bg-success/15 text-success-foreground",
    info: "bg-info/15 text-info-foreground",
    destructive: "bg-destructive/12 text-destructive",
  }[tone];
  return (
    <div className="panel border-t-2 border-t-current px-4 py-3">
      <div className="flex items-center gap-2">
        <span className={`grid h-7 w-7 place-items-center rounded-md ${toneClass}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 tabular font-heading text-xl font-semibold">{value}</p>
    </div>
  );
}
