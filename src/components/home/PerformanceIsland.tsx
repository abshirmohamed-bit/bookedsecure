import { BarChart3, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnalyticsOverview } from "@/components/home/AnalyticsOverview";
import { Button } from "@/components/ui/button";

export function PerformanceIsland() {
  const [detailsOpen, setDetailsOpen] = useState(false);
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
            <p className="truncate text-xs text-muted-foreground">Your key business numbers</p>
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
    <aside className="min-w-0">
      <Button
        type="button"
        variant="outline"
        onClick={() => setDetailsOpen(true)}
        className="h-10 w-full justify-between gap-2 bg-card px-3 shadow-sm"
      >
        <span className="flex min-w-0 items-center gap-2">
          <BarChart3 className="text-primary" />
          <span className="truncate">Operational details</span>
        </span>
        <ChevronRight className="text-muted-foreground" />
      </Button>
      {details}
    </aside>
  );
}