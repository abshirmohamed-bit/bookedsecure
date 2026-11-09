import { cn } from "@/lib/utils";
import { FEED_FILTERS, type FeedFilter } from "@/lib/notification-feed";

/** One scrollable row of filter chips for the notification feed. */
export function FeedFilterChips({
  value,
  onChange,
  className,
}: {
  value: FeedFilter;
  onChange: (value: FeedFilter) => void;
  className?: string;
}) {
  return (
    <div className={cn("no-scrollbar flex gap-1 overflow-x-auto", className)} role="tablist" aria-label="Filter notifications">
      {FEED_FILTERS.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={value === f.id}
          onClick={() => onChange(f.id)}
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
            value === f.id
              ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3)]"
              : "bg-white/55 text-muted-foreground hover:bg-white/90 hover:text-foreground",
          )}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}
