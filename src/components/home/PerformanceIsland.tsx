import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CircleDollarSign, MessageCircleReply } from "lucide-react";
import { getAnalytics } from "@/lib/app.functions";
import { getSmsDeliverySummary } from "@/lib/sms-delivery.functions";
import { formatCurrency } from "@/lib/domain";
import { AnalyticsOverview } from "@/components/home/AnalyticsOverview";

export function PerformanceIsland() {
  const fetchAnalytics = useServerFn(getAnalytics);
  const fetchDelivery = useServerFn(getSmsDeliverySummary);
  const analytics = useQuery({ queryKey: ["assistant-performance-island"], queryFn: () => fetchAnalytics({ data: { from: null, to: null, source: null } }) });
  const delivery = useQuery({ queryKey: ["sms-delivery-summary"], queryFn: () => fetchDelivery() });
  return (
    <aside className="relative rounded-2xl border border-border/70 bg-card/90 p-3 shadow-lg backdrop-blur">
      <div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">At a glance</p><span className="h-2 w-2 rounded-full bg-success" aria-label="Live data" /></div>
      <div className="grid grid-cols-3 gap-1 lg:grid-cols-1">
        <Signal icon={MessageCircleReply} label="Replies" value={analytics.data ? `${Math.round(analytics.data.replyRate * 100)}%` : "—"} />
        <Signal icon={CircleDollarSign} label="Completed" value={analytics.data ? formatCurrency(analytics.data.completedRevenue) : "—"} />
        <Signal icon={Activity} label="SMS delivered" value={delivery.data?.deliveryRate == null ? "—" : `${Math.round(delivery.data.deliveryRate * 100)}%`} />
      </div>
      <details className="mt-2 border-t border-border/70 pt-2">
        <summary className="cursor-pointer list-none text-center text-xs font-medium text-primary">Operational details</summary>
        <div className="absolute right-0 top-full z-30 mt-2 max-h-[70vh] w-[min(760px,calc(100vw-2rem))] overflow-auto rounded-2xl border border-border bg-background p-4 shadow-2xl"><AnalyticsOverview /></div>
      </details>
    </aside>
  );
}

function Signal({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <div className="rounded-xl px-2 py-2 hover:bg-secondary/60 lg:flex lg:items-center lg:gap-3"><Icon className="mb-1 h-4 w-4 text-primary lg:mb-0" /><div className="min-w-0"><p className="truncate text-[10px] text-muted-foreground">{label}</p><p className="truncate text-sm font-semibold tabular">{value}</p></div></div>;
}