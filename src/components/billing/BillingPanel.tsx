import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyPromoCode, getMyBilling, openBillingPortal, startSubscriptionCheckout } from "@/lib/subscription.functions";
import { getMessagingAccount, setAutoTopup, startCreditTopup } from "@/lib/sms/messaging-account.functions";
import { describeSubscription, type BillingInterval } from "@/lib/subscription";
import { CREDIT_PACKS, formatAud, type CreditPack } from "@/lib/sms/credit-packs";
import type { Plan } from "@/lib/plans";
import { getStripe, getStripeEnvironment, isTestModePayments } from "@/lib/stripe";
import { cn } from "@/lib/utils";

export const MY_BILLING_KEY = ["my-billing"] as const;
/** Anchor used by other pages (Messaging) to land on the credit packs. */
export const CREDITS_ANCHOR = "credits";

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

/** One embedded Stripe form for both plan checkout and credit packs. */
type ActiveCheckout = { clientSecret: string; label: string; kind: "plan" | "credits" };

export function BillingPanel() {
  const billing = useMyBilling();
  const queryClient = useQueryClient();
  // Payments, credit packs and text charges all land from outside this screen.
  useBillingRealtime(billing.data?.businessId ?? null);

  const checkout = useServerFn(startSubscriptionCheckout);
  const buyCredits = useServerFn(startCreditTopup);
  const portal = useServerFn(openBillingPortal);
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [active, setActive] = useState<ActiveCheckout | null>(null);

  // Arriving from Messaging (“Top up credits”) scrolls straight to the packs.
  useEffect(() => {
    if (!billing.data || active) return;
    if (window.location.hash !== `#${CREDITS_ANCHOR}`) return;
    document.getElementById(CREDITS_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [billing.data, active]);

  const checkoutMutation = useMutation({
    mutationFn: async (planId: string) => {
      const result = await checkout({ data: { planId, interval, environment: getStripeEnvironment(), returnPath: "/settings/billing" } });
      if ("error" in result) throw new Error(result.error);
      const planName = billing.data?.plans.find((p) => p.id === planId)?.name ?? "Plan";
      return { clientSecret: result.clientSecret, label: `${planName} · billed ${interval === "year" ? "yearly" : "monthly"}` };
    },
    onSuccess: ({ clientSecret, label }) => setActive({ clientSecret, label, kind: "plan" }),
    onError: (error: Error) => toast.error(error.message),
  });

  const topupMutation = useMutation({
    mutationFn: async (packId: string) => {
      const result = await buyCredits({ data: { packId, environment: getStripeEnvironment(), returnPath: "/settings/billing" } });
      if ("error" in result && result.error) throw new Error(result.error);
      const pack = (billing.data?.packs ?? CREDIT_PACKS).find((p) => p.id === packId);
      return {
        clientSecret: (result as { clientSecret: string }).clientSecret,
        label: pack ? `${pack.label} · ${formatAud(pack.amountCents)}` : "Text credits",
      };
    },
    onSuccess: ({ clientSecret, label }) => setActive({ clientSecret, label, kind: "credits" }),
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

  function closeCheckout() {
    setActive(null);
    checkoutMutation.reset();
    topupMutation.reset();
  }

  function refreshAfterPayment() {
    void queryClient.invalidateQueries({ queryKey: MY_BILLING_KEY });
    void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
  }

  if (billing.isLoading) return <p className="text-sm text-muted-foreground">Loading your plan…</p>;
  if (billing.isError || !billing.data) {
    return <p className="text-sm text-destructive">Could not load billing right now.</p>;
  }

  const data = billing.data;
  const isOwner = data.role === "owner" || data.role === "platform_admin";
  const status = describeSubscription(data.subscription, data.plan.name);
  const hasSubscription = Boolean(data.subscription.stripeSubscriptionId) && data.subscription.status !== "canceled";
  const usedPct = data.usage ? Math.min(100, Math.round((data.usage.segmentsUsed / Math.max(1, data.usage.includedSegments)) * 100)) : 0;

  if (active) {
    return (
      <section className="space-y-3">
        <button type="button" onClick={closeCheckout} className="text-xs font-medium text-muted-foreground underline">
          {active.kind === "plan" ? "Back to plans" : "Choose a different amount"}
        </button>
        {isTestModePayments() ? (
          <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
            Payments are in test mode — no real money moves.
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">{active.label}</p>
        <div className="rounded-md bg-background p-1">
          <EmbeddedCheckoutProvider
            key={active.clientSecret}
            stripe={getStripe()}
            options={{
              clientSecret: active.clientSecret,
              onComplete: () => {
                toast.success(
                  active.kind === "plan"
                    ? "Payment received — your plan is switching on."
                    : "Payment received — your credits will appear in a moment.",
                );
                setActive(null);
                refreshAfterPayment();
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

      {isOwner ? <PromoCard appliedCode={data.promo.code} /> : null}

      {isOwner ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-base font-semibold">{data.subscription.status === "active" ? "Plans" : "Choose a plan"}</h3>
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
              const isCurrent = data.subscription.status === "active" && data.plan.id === plan.id;
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

      <section id={CREDITS_ANCHOR} className="scroll-mt-4 space-y-3">
        <div>
          <h3 className="text-base font-semibold">Text credits</h3>
          <p className="text-sm text-muted-foreground">
            One credit sends one text once your included texts are used up —{" "}
            {data.promo.creditPriceCents ?? data.plan.overageCents}c each. Credits never expire.
          </p>
        </div>
        {data.access !== "full" ? (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
            Choose a plan first — every plan includes texts each month, and credit packs top that up.
          </p>
        ) : !isOwner ? (
          <p className="text-sm text-muted-foreground">Only the business owner can buy credits.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {data.packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => topupMutation.mutate(pack.id)}
                disabled={topupMutation.isPending}
                className="flex flex-col rounded-lg border border-border bg-card p-4 text-left hover:border-primary disabled:opacity-60"
              >
                <span className="text-base font-semibold">{pack.label}</span>
                <span className="mt-1 text-2xl font-semibold">{formatAud(pack.amountCents)}</span>
                <span className="mt-1 text-xs text-muted-foreground">{(pack.amountCents / pack.credits).toFixed(0)}c per text</span>
                <span className="mt-3 rounded-md bg-primary px-3 py-2 text-center text-sm font-medium text-primary-foreground">
                  {topupMutation.isPending && topupMutation.variables === pack.id ? "Opening secure payment…" : "Buy credits"}
                </span>
              </button>
            ))}
          </div>
        )}
        {data.access === "full" && isOwner ? <AutoTopupCard packs={data.packs} /> : null}
      </section>
    </div>
  );
}

/** Promo code entry. Once applied, the code stays on the account for good. */
function PromoCard({ appliedCode }: { appliedCode: string | null }) {
  const queryClient = useQueryClient();
  const apply = useServerFn(applyPromoCode);
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: async (value: string) => {
      const result = await apply({ data: { code: value } });
      if ("error" in result) throw new Error(result.error);
      return result.code;
    },
    onSuccess: (applied) => {
      toast.success(`Code ${applied} applied — your pricing is updated.`);
      setCode("");
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: MY_BILLING_KEY });
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (appliedCode) {
    return (
      <p className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
        Code <span className="font-semibold">{appliedCode}</span> is applied to your account — your pricing below
        reflects it and it stays with your account.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-primary underline">
        Have a promo code?
      </button>
    );
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) mutation.mutate(code);
      }}
    >
      <label className="sr-only" htmlFor="promo-code">
        Promo code
      </label>
      <input
        id="promo-code"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Enter your code"
        autoComplete="off"
        className="h-9 min-w-40 rounded-md border border-input bg-background px-3 text-sm"
      />
      <Button type="submit" size="sm" disabled={mutation.isPending || !code.trim()}>
        {mutation.isPending ? "Checking…" : "Apply"}
      </Button>
      <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}

/** Hands-off credits: buys the chosen pack on the saved card when low. */
function AutoTopupCard({ packs }: { packs: CreditPack[] }) {
  const queryClient = useQueryClient();
  const fetchAccount = useServerFn(getMessagingAccount);
  const saveAutoTopup = useServerFn(setAutoTopup);
  const account = useQuery({
    queryKey: ["messaging-account"],
    queryFn: () => fetchAccount(),
    staleTime: 30_000,
  });
  const auto = account.data?.account?.autoTopup;

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await saveAutoTopup({ data: { enabled } });
      return enabled;
    },
    onSuccess: (enabled) => {
      toast.success(enabled ? "Automatic top-ups on — we'll buy credits when you run low." : "Automatic top-ups off.");
      queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not save that setting."),
  });

  if (!auto) return null;
  const pack = packs.find((candidate) => candidate.id === auto.packId) ?? packs[1] ?? CREDIT_PACKS[1]!;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold">Automatic top-ups</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            {auto.enabled
              ? `On — when you drop below ${auto.thresholdCredits.toLocaleString()} credits, we'll buy ${pack.label} (${formatAud(pack.amountCents)}) on your saved card.`
              : "Off — when you run out, texts pause until you buy credits above."}
          </p>
          {auto.failures > 0 ? (
            <p className="mt-1 text-xs text-destructive">
              Last automatic charge failed{auto.failures >= 2 ? " twice, so we've switched this off — update your card in Manage billing and turn it back on" : ""}.
            </p>
          ) : null}
        </div>
        <Button
          variant={auto.enabled ? "outline" : "default"}
          size="sm"
          onClick={() => mutation.mutate(!auto.enabled)}
          disabled={mutation.isPending}
        >
          {auto.enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
    </div>
  );
}
