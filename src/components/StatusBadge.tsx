import {
  REACHABILITY_DESCRIPTIONS,
  REACHABILITY_LABELS,
  REACHABILITY_STATES,
  type ReachabilityState,
} from "@/lib/sms/reachability";
import { cn } from "@/lib/utils";
import { LEAD_STATUS_LABELS, READINESS_LABELS, type LeadStatus } from "@/lib/domain";
import { deliveryLabel, FAILURE_CLASS_LABELS, type FailureClass } from "@/lib/sms/delivery";


const STATUS_STYLES: Record<string, string> = {
  new: "bg-info/15 text-info border-info/30",
  previous_lead: "bg-secondary text-muted-foreground border-border",
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

const DELIVERY_TONES: Record<string, string> = {
  delivered: "bg-success/15 text-success border-success/40",
  failed: "bg-destructive/15 text-destructive border-destructive/40",
  undelivered: "bg-destructive/15 text-destructive border-destructive/40",
  sent: "bg-info/10 text-info border-info/30",
  provider_accepted: "bg-secondary text-muted-foreground border-border",
  queued: "bg-secondary text-muted-foreground border-border",
  unknown: "bg-warning/10 text-warning border-warning/30",
};

/**
 * Delivery state of one outbound SMS. Deliberately never says "Delivered"
 * unless a provider receipt confirmed it. "Accepted by provider" and
 * "Awaiting confirmation" are distinct, visible states.
 */
export function DeliveryBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        DELIVERY_TONES[status ?? ""] ?? "bg-secondary text-muted-foreground border-border",
        className,
      )}
    >
      {deliveryLabel(status)}
    </span>
  );
}

/** Failure classification (permanent / temporary / configuration). */
export function FailureClassBadge({ failureClass }: { failureClass: string | null | undefined }) {
  if (!failureClass) return null;
  const tone =
    failureClass === "permanent"
      ? "bg-destructive/15 text-destructive border-destructive/40"
      : failureClass === "temporary"
        ? "bg-warning/10 text-warning border-warning/30"
        : "bg-secondary text-muted-foreground border-border";
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[11px]", tone)}>
      {FAILURE_CLASS_LABELS[failureClass as FailureClass] ?? failureClass}
    </span>
  );
}

/** Lead-level messaging state for the inbox and lead header. */
export function SmsSuppressedBadge({ reason }: { reason?: string | null }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-md border border-destructive/40 bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive"
      title={reason ?? "Automated SMS is suppressed for this lead."}
    >
      SMS suppressed
    </span>
  );
}


/**
 * Reachability is evidence about the number, and is shown separately from the
 * latest outbound message status. It never asserts a number is permanently
 * inactive: a permanent failure reads "Suppressed - needs review".
 */
export function ReachabilityBadge({
  state,
  evidenceAt,
  evidence,
  className,
}: {
  state: string | null | undefined;
  evidenceAt?: string | null;
  evidence?: string | null;
  className?: string;
}) {
  const key = (REACHABILITY_STATES as readonly string[]).includes(state ?? "")
    ? (state as ReachabilityState)
    : "unknown";
  const tone =
    key === "reachable_recently"
      ? "bg-success/10 text-success border-success/30"
      : key === "suppressed_pending_review"
        ? "bg-warning/10 text-warning border-warning/30"
        : key === "unreachable_recently"
          ? "bg-destructive/10 text-destructive border-destructive/40"
          : "bg-secondary text-muted-foreground border-border";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        tone,
        className,
      )}
      title={evidence ?? REACHABILITY_DESCRIPTIONS[key]}
    >
      {REACHABILITY_LABELS[key]}
      {evidenceAt ? (
        <span className="font-normal opacity-80">
          {new Date(evidenceAt).toLocaleString("en-AU", {
            day: "2-digit",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : null}
    </span>
  );
}
