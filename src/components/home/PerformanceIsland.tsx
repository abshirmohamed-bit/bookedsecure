import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CircleDollarSign, MessageCircleReply, X } from "lucide-react";
import { useState } from "react";
import { getAnalytics } from "@/lib/app.functions";
import { getSmsDeliverySummary } from "@/lib/sms-delivery.functions";
import { formatCurrency } from "@/lib/domain";
import { AnalyticsOverview } from "@/components/home/AnalyticsOverview";
import { Button } from "@/components/ui/button";

export function PerformanceIsland() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const fetchAnalytics = useServerFn(getAnalytics);
  const fetchDelivery = useServerFn(getSmsDeliverySummary);
  const analytics = useQuery({ queryKey: ["assistant-performance-island"], queryFn: () => fetchAnalytics({ data: { from: null, to: null, source: null } }) });
  const delivery = useQuery({ queryKey: ["sms-delivery-summary"], queryFn: () => fetchDelivery() });
  return (
    <aside className="relative rounded-2xl border border-border/70 bg-card/90 p-2 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">At a glance</p><span className="h-2 w-2 rounded-full bg-success" aria-label="Live data" /></div>
      <div className="grid grid-cols-3 gap-1 lg:grid-cols-1">
        <Signal icon={MessageCircleReply} label="Replies" value={analytics.data ? `${Math.round(analytics.data.replyRate * 100)}%` : "—"} />
        <Signal icon={CircleDollarSign} label="Completed" value={analytics.data ? formatCurrency(analytics.data.completedRevenue) : "—"} />
        <Signal icon={Activity} label="SMS delivered" value={delivery.data?.deliveryRate == null ? "—" : `${Math.round(delivery.data.deliveryRate * 100)}%`} />
      </div>
      <Button type="button" variant="ghost" onClick={() => setDetailsOpen(true)} className="mt-1 min-h-8 w-full rounded-none border-t border-border/70 pt-1 text-center text-[10px] font-medium text-primary">Operational details</Button>
      {detailsOpen ? <div className="fixed inset-0 z-[70] flex items-end bg-foreground/25 p-0 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label="Operational details">
        <section className="flex max-h-[calc(100dvh-1rem)] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-h-[85dvh] sm:max-w-4xl sm:rounded-2xl">
          <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center border-b border-border px-4 py-3">
            <h2 className="truncate text-base font-semibold">Operational details</h2>
            <Button type="button" size="icon" variant="ghost" onClick={() => setDetailsOpen(false)} aria-label="Close operational details"><X className="h-4 w-4" /></Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><AnalyticsOverview /></div>
        </section>
      </div> : null}
    </aside>
  );
}

function Signal({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <div className="rounded-xl px-2 py-1 hover:bg-secondary/60 lg:flex lg:items-center lg:gap-2"><Icon className="mb-0.5 h-3.5 w-3.5 text-primary lg:mb-0" /><div className="min-w-0"><p className="truncate text-[10px] text-muted-foreground">{label}</p><p className="truncate text-sm font-semibold tabular leading-tight">{value}</p></div></div>;
}