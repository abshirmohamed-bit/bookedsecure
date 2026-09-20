import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarCheck2, CircleDollarSign, MessageCircleReply, Send } from "lucide-react";
import { getAnalytics } from "@/lib/app.functions";
import { getSmsDeliverySummary } from "@/lib/sms-delivery.functions";
import { formatCurrency } from "@/lib/domain";

export function AnalyticsOverview() {
  const fetchAnalytics = useServerFn(getAnalytics);
  const fetchDelivery = useServerFn(getSmsDeliverySummary);

  const analytics = useQuery({
    queryKey: ["analytics", "all-time"],
    queryFn: () => fetchAnalytics({ data: { from: null, to: null, source: null } }),
  });
  const delivery = useQuery({ queryKey: ["sms-delivery-summary"], queryFn: () => fetchDelivery() });

  if (analytics.isLoading || delivery.isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading your numbers…</p>;
  if (analytics.error || delivery.error) return <p className="py-8 text-center text-sm text-destructive">Your numbers could not be loaded.</p>;
  if (!analytics.data || !delivery.data) return null;

  const data = analytics.data;
  const essentials = [
    { label: "Enquiries", value: String(data.funnel.enquiries), icon: MessageCircleReply },
    { label: "Reply rate", value: `${Math.round(data.replyRate * 100)}%`, icon: Send },
    { label: "Bookings", value: String(data.funnel.scheduled), icon: CalendarCheck2 },
    { label: "Completed revenue", value: formatCurrency(data.completedRevenue), icon: CircleDollarSign },
  ] as const;
  const progress = [
    ["Enquiries", data.funnel.enquiries],
    ["Contacted", data.funnel.contacted],
    ["Replied", data.funnel.replied],
    ["Booked", data.funnel.scheduled],
    ["Completed", data.funnel.completed],
  ] as const;

  return (
    <div className="min-w-0 space-y-6">
      <section>
        <h3 className="mb-3 text-sm font-semibold">Overview</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {essentials.map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-lg border border-border bg-card p-3">
              <Icon className="mb-3 h-4 w-4 text-primary" />
              <dd className="tabular text-xl font-semibold">{value}</dd>
              <dt className="mt-0.5 text-xs text-muted-foreground">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Lead progress</h3>
        <div className="mt-4 space-y-3">
          {progress.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className="tabular font-semibold">{value}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">Text messages</h3>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
          <SimpleDatum label="Outbound" value={String(delivery.data.total)} />
          <SimpleDatum label="Delivered" value={String(delivery.data.delivered)} />
          <SimpleDatum label="Delivery rate" value={delivery.data.deliveryRate == null ? "Not available" : `${Math.round(delivery.data.deliveryRate * 100)}%`} />
          <SimpleDatum label="Needs attention" value={String(delivery.data.failed + delivery.data.undelivered)} />
        </dl>
      </section>
    </div>
  );
}

function SimpleDatum({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 tabular text-lg font-semibold">{value}</dd></div>;
}
