import type { CampaignPerformance } from "@/lib/meta-ads";

/** Spend to revenue per campaign, with the all-campaigns row last. Shared by Facebook and Google. */
export function AdsCampaignTable({ campaigns, total, currency, platform, days }: {
  campaigns: CampaignPerformance[]; total: CampaignPerformance; currency: string; platform: string; days: number;
}) {
  const fmt = (n: number | null) => (n === null ? "—" : new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n));
  const num = (n: number) => (n ? n.toLocaleString() : "—");
  if (!campaigns.length) return <p className="mt-3 text-sm text-muted-foreground">No {platform} leads or ad spend in the last {days} days.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="text-left text-xs text-muted-foreground"><tr>
          <th className="py-2 pr-3 font-medium">Campaign</th><th className="px-2 font-medium">Spend</th><th className="px-2 font-medium">Impressions</th><th className="px-2 font-medium">Clicks</th><th className="px-2 font-medium">CTR</th><th className="px-2 font-medium">Cost/click</th>
          <th className="px-2 font-medium">Leads</th><th className="px-2 font-medium">Cost/lead</th><th className="px-2 font-medium">Booked</th><th className="px-2 font-medium">Cost/booking</th><th className="px-2 font-medium">Completed</th><th className="px-2 font-medium">Revenue</th><th className="pl-2 font-medium">Return</th>
        </tr></thead>
        <tbody className="divide-y divide-border tabular">
          {[...campaigns, total].map((c, i) => (
            <tr key={c.campaignId ?? `row-${i}`} className={i === campaigns.length ? "font-semibold" : ""}>
              <td className="max-w-[220px] truncate py-2 pr-3" title={c.campaignName}>{c.campaignName}</td>
              <td className="px-2">{fmt(c.spend)}</td><td className="px-2">{num(c.impressions)}</td><td className="px-2">{num(c.clicks)}</td>
              <td className="px-2">{c.ctr === null ? "—" : `${c.ctr.toFixed(2)}%`}</td><td className="px-2">{fmt(c.costPerClick)}</td>
              <td className="px-2">{c.leads}</td><td className="px-2">{fmt(c.costPerLead)}</td>
              <td className="px-2">{c.booked}</td><td className="px-2">{fmt(c.costPerBooked)}</td>
              <td className="px-2">{c.completed}</td><td className="px-2">{fmt(c.revenue)}</td><td className="pl-2">{c.roas === null ? "—" : `${c.roas.toFixed(1)}×`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted-foreground">Leads, bookings and jobs are BookedSecure’s own records for {platform} leads from the last {days} days. Revenue counts completed jobs only. “Return” is revenue ÷ spend.</p>
    </div>
  );
}
