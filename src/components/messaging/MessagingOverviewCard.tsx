import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { getMessagingAccount, setMessagingPaused } from "@/lib/sms/messaging-account.functions";
import { formatAud, LOW_CREDIT_THRESHOLD } from "@/lib/sms/credit-packs";
import { CREDITS_ANCHOR } from "@/components/billing/BillingPanel";
import { useBillingRealtime } from "@/hooks/useBillingRealtime";


const NUMBER_STATE_LABELS: Record<string, string> = {
  not_started: "Being set up",
  provisioning: "Being set up",
  queued_no_number: "Waiting for your number",
  active: "Ready",
  suspended: "On hold",
  failed: "Needs attention",
};

/**
 * The single card an owner needs: their number, whether texts are going out,
 * how many of the month's included texts are used, credits left, and the two
 * buttons that matter. Everything technical lives in "Advanced & account".
 */
export function MessagingOverviewCard() {
  const fetchAccount = useServerFn(getMessagingAccount);
  const pauseSending = useServerFn(setMessagingPaused);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["messaging-account"],
    queryFn: () => fetchAccount(),
  });

  // Credits and plan changes land from payments and sends, so keep this live.
  useBillingRealtime(data?.business?.id ?? null);


  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => pauseSending({ data: { paused } }),
    onSuccess: (result) => {
      toast.success(result.paused ? "Sending paused" : "Sending resumed");
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
      void queryClient.invalidateQueries({ queryKey: ["sms-setup"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !data) return null;

  // Older cached responses (before plan details were added) can arrive without
  // `plan`, so never dereference it directly.
  const plan = data.plan ?? {
    id: "pro",
    name: "Pro",
    currency: "aud",
    priceMinorUnits: 0,
    billingInterval: "month",
    includedSegments: 0,
    usedSegments: 0,
    overageCents: 8,
    reactivationEnabled: true,
    teamMemberLimit: null as number | null,
  };

  const isOwner = data.role === "owner";
  const balance = data.account?.creditBalance ?? 0;
  const lowBalance = balance <= LOW_CREDIT_THRESHOLD;
  const activeNumber =
    data.numbers.find((number) => number.status === "assigned") ?? data.numbers[0];
  const state = data.account?.provisioningState ?? "not_started";
  const paused = data.business ? !data.business.automation_enabled : false;
  const usedPct =
    plan.includedSegments > 0
      ? Math.min(100, Math.round((plan.usedSegments / plan.includedSegments) * 100))
      : 0;

  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">Your messaging</div>
      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Your number</p>
            <p className="mt-1 text-lg font-semibold">
              {activeNumber?.number ?? "Not assigned yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {NUMBER_STATE_LABELS[state] ?? state} · from your messaging provider
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Texts going out</p>
            <p className="mt-1 text-lg font-semibold">{paused ? "Paused" : "Active"}</p>
            <p className="text-xs text-muted-foreground">
              {plan.name} plan · {formatAud(plan.priceMinorUnits)} / {plan.billingInterval}
            </p>
          </div>
          <div
            className={`rounded-md border p-3 ${lowBalance ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
          >
            <p className="text-xs text-muted-foreground">Credits left</p>
            <p className="mt-1 text-lg font-semibold">{balance.toLocaleString()}</p>
            <p className={`text-xs ${lowBalance ? "text-destructive" : "text-muted-foreground"}`}>
              Extra texts {plan.overageCents}c each
            </p>
          </div>
        </div>

        <div className="rounded-md border border-border p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs text-muted-foreground">Texts this month</p>
            <p className="text-sm font-semibold">
              {plan.usedSegments.toLocaleString()}
              {plan.includedSegments > 0 ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {" "}
                  / {plan.includedSegments.toLocaleString()} included
                </span>
              ) : null}
            </p>
          </div>
          {plan.includedSegments > 0 ? (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full ${usedPct >= 100 ? "bg-destructive" : "bg-primary"}`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          ) : null}
          <p className="mt-2 text-xs text-muted-foreground">
            Each text uses one credit ({plan.overageCents}c). Buy credits in Plan &amp; billing, or
            top up in your own provider account.
          </p>
        </div>

        {state === "queued_no_number" ? (
          <p className="rounded-md border border-border bg-secondary/40 p-3 text-xs">
            Your texting number isn&apos;t connected yet. Get it from the messaging provider below,
            then press “I&apos;ve got my number”.
          </p>
        ) : null}

        {isOwner ? (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/settings/billing"
              hash={CREDITS_ANCHOR}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
            >
              Top up credits
            </Link>
            <button
              type="button"
              onClick={() => pauseMutation.mutate(!paused)}
              disabled={pauseMutation.isPending}
              className="rounded-md border border-input px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {paused ? "Resume sending" : "Pause sending"}
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Only the business owner can buy credits or pause sending.
          </p>
        )}
        {isOwner ? (
          <p className="text-xs text-muted-foreground">
            Pausing stops all outbound texts straight away and keeps your number, leads and history.
            Replies and opt-outs are still recorded.
          </p>
        ) : null}
      </div>
    </section>
  );
}
