import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABELS, READINESS_LABELS, type LeadStatus } from "@/lib/domain";

const STATUS_STYLES: Record<string, string> = {
  new: "bg-info/15 text-info border-info/30",
  contacted: "bg-secondary text-secondary-foreground border-border",
  waiting_for_customer: "bg-secondary text-muted-foreground border-border",
  customer_replied: "bg-primary/15 text-primary border-primary/40",
  ready_for_quote: "bg-warning/15 text-warning border-warning/40",
  quote_sent: "bg-warning/10 text-warning border-warning/30",
  scheduled: "bg-info/15 text-info border-info/40",
  completed: "bg-success/20 text-success border-success/45",
  lost: "bg-destructive/10 text-destructive border-destructive/30",
  opted_out: "bg-destructive/15 text-destructive border-destructive/40",
  invalid: "bg-muted text-muted-foreground border-border",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status] ?? "bg-secondary text-secondary-foreground border-border",
        className,
      )}
    >
      {LEAD_STATUS_LABELS[status as LeadStatus] ?? status}
    </span>
  );
}

export function ReadinessBadge({ readiness }: { readiness: string | null }) {
  if (!readiness) return null;
  const tone =
    readiness === "quote_ready" || readiness === "high_intent"
      ? "bg-primary/15 text-primary border-primary/40"
      : readiness === "not_suitable"
        ? "bg-destructive/10 text-destructive border-destructive/30"
        : "bg-secondary text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-xs font-medium", tone)}>
      {READINESS_LABELS[readiness] ?? readiness}
    </span>
  );
}

export function DeliveryBadge({ status }: { status: string }) {
  const tone =
    status === "delivered"
      ? "text-success"
      : status === "failed" || status === "undelivered"
        ? "text-destructive"
        : "text-muted-foreground";
  return <span className={cn("text-xs", tone)}>{status}</span>;
}
