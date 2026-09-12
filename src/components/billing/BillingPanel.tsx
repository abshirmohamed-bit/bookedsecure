import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getMyBilling, openBillingPortal, startSubscriptionCheckout } from "@/lib/subscription.functions";
import { describeSubscription, type BillingInterval } from "@/lib/subscription";
import { formatAud } from "@/lib/sms/credit-packs";
import type { Plan } from "@/lib/plans";
import { getStripe, getStripeEnvironment, isTestModePayments } from "@/lib/stripe";
import { cn } from "@/lib/utils";

export const MY_BILLING_KEY = ["my-billing"] as const;

export function useMyBilling() {
  const fetchBilling = useServerFn(getMyBilling);
  return useQuery({ queryKey: MY_BILLING_KEY, queryFn: () => fetchBilling(), staleTime: 60_000 });
}

function planPoints(plan: Plan): string[] {
  return [
    `${plan.includedSegments.toLocaleString()} text credits included every month`,
    "Dedicated Australian text number",
    "Fully integrated cowork AI assistant",
    "AI-led quote page and instant replies",
    plan.automationCustomEnabled ? "Customisable follow-up sequences" : "Proven default follow-up sequence",
    plan.campaignsEnabled ? "Bulk text campaigns to your leads" : null,
    plan.reactivationEnabled ? "Bring past customers back" : null,
    plan.teamMemberLimit === null ? "Unlimited team members" : `Up to ${plan.teamMemberLimit} team members`,
    `Extra texts ${plan.overageCents}c each, or buy credit packs`,
  ].filter((p): p is string => Boolean(p));
}

export function BillingPanel() {
  const billing = useMyBilling();
  const queryClient = useQueryClient();
  const checkout = useServerFn(startSubscriptionCheckout);
  const portal = useServerFn(openBillingPortal);
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [chosenPlan, setChosenPlan] = useState<string | null>(null);

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const result = await checkout({ data: { planId, interval, environment: getStripeEnvironment(), returnPath: "/settings/billing" } });
      if ("error" in result) throw new Error(result.error);
      return result.clientSecret;
    },
    onSuccess: (secret, planId) => {
      setChosenPlan(planId);
      setClientSecret(secret);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const portalMutation = useMutation({
    mutationFn: async () => {
      const result = await portal({ data: { environment: getStripeEnvironment(), returnPath: "/settings/billing" } });
      if ("error" in result) throw new Error(result.error);
      return result.url;
    },
    onSuccess: (url) => {
      window.open(url, "_blank", "noopener");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (billing.isLoading) return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  if (billing.isError || !billing.data) {
    return <p className="text-sm text-destructive">Could not load billing right now.</p>;
  }

  const data = billing.data;
  const isOwner = data.role === "owner" || data.role === "platform_admin";
  const status = describeSubscription(data.subscription, data.plan.name);
  const hasSubscription = Boolean(data.subscription.stripeSubscriptionId) && data.subscription.status !== "canceled";
  const usedPct = data.usage ? Math.min(100, Math.round((data.usage.segmentsUsed / Math.max(1, data.usage.includedSegments)) * 100)) : 0;

  if (clientSecret) {
    return (
      <section className="space-y-3">
        <button
          type="button"
          onClick={() => {
            setClientSecret(null);
            checkoutMutation.reset();
          }}
          className="text-xs font-medium text-muted-foreground underline"
        >
          Back to plans
        </button>
        {isTestModePayments() ? (
          <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
            Payments are in test mode — no real money moves.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {data.plans.find((p) => p.id === chosenPlan)?.name ?? "Plan"} · billed {interval === "year" ? "yearly" : "monthly"}
        </p>
        <div className="rounded-md bg-background p-1">
          <EmbeddedCheckoutProvider
            stripe={getStripe()}
            options={{
              clientSecret,
              onComplete: () => {
                toast.success("Payment received — your plan is switching on.");
                setClientSecret(null);
                void queryClient.invalidateQueries({ queryKey: MY_BILLING_KEY });
                void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
              },
            }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section
        className={cn(
          "rounded-lg border p-4",
          status.tone === "danger" && "border-destructive/40 bg-destructive/5",
          status.tone === "warning" && "border-amber-500/40 bg-amber-500/5",
          status.tone === "neutral" && "border-border bg-card",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your plan</p>
            <h2 className="text-lg font-semibold">{status.headline}</h2>
            <p className="text-sm text-muted-foreground">{status.detail}</p>
          </div>
          {isOwner && hasSubscription ? (
            <Button variant="outline" size="sm" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
              {portalMutation.isPending ? "Opening…" : "Manage billing"}
            </Button>
          ) : null}
        </div>

        {data.access === "full" ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs text-muted-foreground">Included texts this month</dt>
              <dd className="mt-1 text-sm font-medium">
                {data.usage ? `${data.usage.segmentsUsed.toLocaleString()} of ${data.usage.includedSegments.toLocaleString()} used` : `${data.plan.includedSegments.toLocaleString()} included`}
              </dd>
              {data.usage ? (
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full", usedPct >= 90 ? "bg-destructive" : "bg-primary")} style={{ width: `${usedPct}%` }} />
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs text-muted-foreground">Credit balance</dt>
              <dd className="mt-1 text-sm font-medium">{data.creditBalance.toLocaleString()} credits</dd>
              <p className="mt-1 text-xs text-muted-foreground">Used only after included texts run out.</p>
            </div>
            <div className="rounded-md border border-border bg-background p-3">
              <dt className="text-xs text-muted-foreground">Team</dt>
              <dd className="mt-1 text-sm font-medium">
                {data.activeMembers} {data.plan.teamMemberLimit === null ? "members" : `of ${data.plan.teamMemberLimit} seats`}
              </dd>
            </div>
          </dl>
        ) : null}
      </section>

      {isOwner ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{hasSubscription ? "Plans" : "Choose a plan"}</h3>
            <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-md border border-input p-0.5 text-xs">
              {(["month", "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={interval === option}
                  onClick={() => setInterval(option)}
                  className={cn("rounded px-3 py-1 font-medium", interval === option ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  {option === "month" ? "Monthly" : "Yearly · 2 months free"}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {data.plans.map((plan) => {
              const price = interval === "year" ? plan.annualPriceMinorUnits : plan.monthlyPriceMinorUnits;
              const isCurrent = hasSubscription && data.plan.id === plan.id;
              return (
                <article key={plan.id} className={cn("flex flex-col rounded-lg border p-4", isCurrent ? "border-primary" : "border-border bg-card")}>
                  <header>
                    <h4 className="text-base font-semibold">{plan.name}</h4>
                    <p className="text-sm text-muted-foreground">{plan.tagline}</p>
                    <p className="mt-2 text-2xl font-semibold">
                      {formatAud(price)}
                      <span className="text-sm font-normal text-muted-foreground"> / {interval === "year" ? "year" : "month"}</span>
                    </p>
                  </header>
                  <ul className="mt-3 flex-1 space-y-1.5 text-sm">
                    {planPoints(plan).map((point) => (
                      <li key={point} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        Current plan
                      </Button>
                    ) : hasSubscription ? (
                      <Button variant="outline" className="w-full" onClick={() => portalMutation.mutate()} disabled={portalMutation.isPending}>
                        Switch in billing
                      </Button>
                    ) : (
                      <Button className="w-full" onClick={() => checkoutMutation.mutate(plan.id)} disabled={checkoutMutation.isPending}>
                        {checkoutMutation.isPending ? "Opening secure payment…" : `Start ${plan.name}`}
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {isTestModePayments() ? <p className="text-xs text-muted-foreground">Payments are in test mode — no real money moves.</p> : null}
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">Only the business owner can change the plan.</p>
      )}
    </div>
  );
}
