import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, CircleDollarSign, MessageCircleReply, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  useEffect(() => {
    if (!detailsOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailsOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [detailsOpen]);

  const details = detailsOpen && typeof document !== "undefined" ? createPortal(
    <div className="fixed inset-0 z-[100] grid min-h-0 min-w-0 grid-rows-[1fr] bg-foreground/30 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="operational-details-title" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailsOpen(false); }}>
      <section className="flex h-[100dvh] min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background shadow-2xl sm:m-auto sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:max-w-5xl sm:rounded-lg sm:border sm:border-border">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="operational-details-title" className="truncate text-base font-semibold sm:text-lg">Operational details</h2>
            <p className="truncate text-xs text-muted-foreground">Lead and messaging performance</p>
          </div>
          <Button type="button" size="icon" variant="ghost" className="size-11 shrink-0 sm:size-9" onClick={() => setDetailsOpen(false)} aria-label="Close operational details"><X className="h-5 w-5" /></Button>
        </header>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
          <div className="mx-auto w-full min-w-0 max-w-4xl"><AnalyticsOverview /></div>
        </div>
      </section>
    </div>,
    document.body,
  ) : null;
  return (
    <aside className="relative min-w-0 rounded-2xl border border-border/70 bg-card/90 p-2 shadow-lg backdrop-blur">
      <div className="mb-1 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">At a glance</p><span className="h-2 w-2 rounded-full bg-success" aria-label="Live data" /></div>
      <div className="grid grid-cols-3 gap-1 lg:grid-cols-1">
        <Signal icon={MessageCircleReply} label="Replies" value={analytics.data ? `${Math.round(analytics.data.replyRate * 100)}%` : "—"} />
        <Signal icon={CircleDollarSign} label="Completed" value={analytics.data ? formatCurrency(analytics.data.completedRevenue) : "—"} />
        <Signal icon={Activity} label="SMS delivered" value={delivery.data?.deliveryRate == null ? "—" : `${Math.round(delivery.data.deliveryRate * 100)}%`} />
      </div>
      <Button type="button" variant="ghost" onClick={() => setDetailsOpen(true)} className="mt-1 min-h-10 w-full rounded-none border-t border-border/70 pt-1 text-center text-[10px] font-medium text-primary sm:min-h-8">Operational details</Button>
      {details}
    </aside>
  );
}

function Signal({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return <div className="rounded-xl px-2 py-1 hover:bg-secondary/60 lg:flex lg:items-center lg:gap-2"><Icon className="mb-0.5 h-3.5 w-3.5 text-primary lg:mb-0" /><div className="min-w-0"><p className="truncate text-[10px] text-muted-foreground">{label}</p><p className="truncate text-sm font-semibold tabular leading-tight">{value}</p></div></div>;
}