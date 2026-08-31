import { cn } from "@/lib/utils";
import type { MetricTone } from "@/lib/import-presentation";

const TONE_TILE: Record<MetricTone, string> = {
  neutral: "border-border",
  good: "border-success/40 bg-success/5",
  warn: "border-warning/50 bg-warning/5",
  bad: "border-destructive/50 bg-destructive/5",
};

const TONE_VALUE: Record<MetricTone, string> = {
  neutral: "text-foreground",
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
};

/** Read-only metric tile. Presentation only. */
export function MetricTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number | string;
  tone?: MetricTone;
}) {
  return (
    <div className={cn("min-w-0 rounded-md border p-2", TONE_TILE[tone])}>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-base font-semibold tabular", TONE_VALUE[tone])}>{value}</dd>
    </div>
  );
}

export function ToneBadge({ tone, children }: { tone: MetricTone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "good" && "bg-success/15 text-success",
        tone === "warn" && "bg-warning/15 text-warning",
        tone === "bad" && "bg-destructive/15 text-destructive",
        tone === "neutral" && "bg-secondary text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
