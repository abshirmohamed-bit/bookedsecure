import { Link, useLocation } from "@tanstack/react-router";
import { useMyBilling } from "@/components/billing/BillingPanel";
import { describeSubscription } from "@/lib/subscription";
import { cn } from "@/lib/utils";

/**
 * One-line notice at the top of the workspace when the business cannot act:
 * preview (never paid), payment failed, or subscription ending. Hidden on the
 * billing page itself and whenever access is full and healthy.
 */
export function SubscriptionBanner() {
  const billing = useMyBilling();
  const { pathname } = useLocation();
  if (!billing.data || pathname.startsWith("/settings/billing")) return null;
  const { subscription, plan, access } = billing.data;
  const status = describeSubscription(subscription, plan.name);
  if (access === "full" && status.tone === "neutral") return null;

  const cta = access === "preview" ? (subscription.status === "preview" ? "Choose a plan" : "Fix billing") : "View billing";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm",
        status.tone === "danger" ? "border-destructive/40 bg-destructive/10" : "border-amber-500/40 bg-amber-500/10",
      )}
    >
      <p className="min-w-0">
        <span className="font-medium">{access === "preview" ? "View-only. " : ""}</span>
        {status.detail}
      </p>
      <Link to="/settings/billing" className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
        {cta}
      </Link>
    </div>
  );
}
