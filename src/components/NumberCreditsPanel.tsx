import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import {
  getMessagingAccount,
  requestCancellation,
  setMessagingPaused,
  startCreditTopup,
} from "@/lib/sms/messaging-account.functions";
import { formatAud, LOW_CREDIT_THRESHOLD } from "@/lib/sms/credit-packs";
import { getStripe, isTestModePayments } from "@/lib/stripe";

const NUMBER_STATE_LABELS: Record<string, string> = {
  not_started: "Not set up yet",
  provisioning: "Being set up",
  queued_no_number: "Waiting for a number",
  active: "Active",
  suspended: "Suspended",
  failed: "Needs attention",
};

/**
 * Owner-facing number and credit controls: balance, self-serve top-up, pause
 * sending, and a cancellation request. Buying a number is not a self-serve
 * action — it is included in the plan and assigned by BookedSecure.
 */
export function NumberCreditsPanel() {
  const fetchAccount = useServerFn(getMessagingAccount);
  const buyCredits = useServerFn(startCreditTopup);
  const pauseSending = useServerFn(setMessagingPaused);
  const raiseCancellation = useServerFn(requestCancellation);
  const queryClient = useQueryClient();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["messaging-account"],
    queryFn: () => fetchAccount(),
  });

  const topupMutation = useMutation({
    mutationFn: async (packId: string) => {
      const result = await buyCredits({ data: { packId } });
      if ("error" in result && result.error) throw new Error(result.error);
      return result as { clientSecret: string };
    },
    onSuccess: (result) => setClientSecret(result.clientSecret),
    onError: (error: Error) => toast.error(error.message),
  });

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

  const cancelMutation = useMutation({
    mutationFn: () => raiseCancellation({ data: { note: cancelNote || undefined } }),
    onSuccess: (result) => {
      toast.success(
        result.alreadyOpen
          ? "You already have a cancellation request open."
          : "Cancellation request sent. We'll be in touch.",
      );
      setShowCancel(false);
      setCancelNote("");
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !data) return null;

  // Older cached responses (before plan details were added) can arrive without
  // `plan`, so never dereference it directly.
  const plan = data.plan ?? {
    currency: "aud",
    priceMinorUnits: 0,
    billingInterval: "month",
    includedSegments: 0,
    usedSegments: 0,
  };

  const isOwner = data.role === "owner";
  const balance = data.account?.creditBalance ?? 0;
  const lowBalance = balance <= LOW_CREDIT_THRESHOLD;
  const activeNumber = data.numbers.find((number) => number.status === "assigned") ?? data.numbers[0];
  const state = data.account?.provisioningState ?? "not_started";
  const paused = data.business ? !data.business.automation_enabled : false;
  const openCancellation = data.requests.find(
    (request) => request.kind === "cancellation" && request.status !== "resolved",
  );

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Your number &amp; credits</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Your dedicated Australian number is included in your plan. Your plan includes{" "}
        {data.plan.includedSegments.toLocaleString()} texts a month; extra texts are bought as
        credits below — one credit per message.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Included texts this month</p>
          <p className="mt-1 text-2xl font-semibold">
            {data.plan.usedSegments.toLocaleString()}
            <span className="text-xs text-muted-foreground">
              {" "}
              / {data.plan.includedSegments.toLocaleString()}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">included in your plan</p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Your plan</p>
          <p className="mt-1 text-2xl font-semibold">
            {formatAud(data.plan.priceMinorUnits)}
            <span className="text-xs text-muted-foreground"> / {data.plan.billingInterval}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            number, AI and {data.plan.includedSegments.toLocaleString()} texts included
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div
          className={`rounded-md border p-3 ${lowBalance ? "border-destructive/50 bg-destructive/5" : "border-border"}`}
        >
          <p className="text-xs text-muted-foreground">Credit balance</p>
          <p className="mt-1 text-2xl font-semibold">{balance}</p>
          <p className={`text-xs ${lowBalance ? "text-destructive" : "text-muted-foreground"}`}>
            {lowBalance ? "Running low — top up to keep sending" : "credits available"}
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Your number</p>
          <p className="mt-1 text-lg font-semibold">{activeNumber?.number ?? "Not assigned yet"}</p>
          <p className="text-xs text-muted-foreground">
            {NUMBER_STATE_LABELS[state] ?? state} · included in your plan
          </p>
        </div>
        <div className="rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">Sending</p>
          <p className="mt-1 text-lg font-semibold">{paused ? "Paused" : "Active"}</p>
          <p className="text-xs text-muted-foreground">
            Daily limit {data.account?.dailySendCap ?? "—"} messages
          </p>
        </div>
      </div>

      {state === "queued_no_number" ? (
        <p className="mt-3 rounded-md border border-border bg-secondary/40 p-3 text-xs">
          We&apos;re assigning your dedicated number. Sending stays off until it&apos;s ready — you
          don&apos;t need to do anything.
        </p>
      ) : null}

      {isOwner ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top up credits
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => topupMutation.mutate(pack.id)}
                disabled={topupMutation.isPending || Boolean(clientSecret)}
                className="rounded-md border border-input px-3 py-2 text-sm font-medium disabled:opacity-60"
              >
                {pack.label} — {formatAud(pack.amountCents)}
              </button>
            ))}
          </div>
          {isTestModePayments() ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Payments are in test mode — no real money moves.
            </p>
          ) : null}
          {clientSecret ? (
            <div className="mt-3 rounded-md bg-background p-2">
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          Only the business owner can buy credits or change sending.
        </p>
      )}

      {data.topups.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Recent top-ups
          </h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.topups.map((topup) => (
              <li key={topup.id}>
                {new Date(topup.created_at).toLocaleDateString()} · {topup.credits} credits ·{" "}
                {formatAud(topup.amount_cents)} ·{" "}
                {topup.status === "paid"
                  ? "added"
                  : topup.status === "pending"
                    ? "awaiting payment"
                    : topup.status}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {isOwner ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pause or cancel
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => pauseMutation.mutate(!paused)}
              disabled={pauseMutation.isPending}
              className="rounded-md border border-input px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {paused ? "Resume sending" : "Pause sending"}
            </button>
            {openCancellation ? (
              <span className="text-xs text-muted-foreground">
                Cancellation requested {new Date(openCancellation.created_at).toLocaleDateString()} —
                we&apos;ll be in touch.
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowCancel((open) => !open)}
                className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
              >
                Request cancellation
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Pausing stops all outbound texts straight away and keeps your number, leads and history.
            Replies and opt-outs are still recorded.
          </p>
          {showCancel && !openCancellation ? (
            <div className="mt-3 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Anything you&apos;d like us to know? (optional)
                </span>
                <textarea
                  className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
                  rows={3}
                  value={cancelNote}
                  maxLength={1000}
                  onChange={(event) => setCancelNote(event.target.value)}
                />
              </label>
              <button
                type="button"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="rounded-md border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive disabled:opacity-60"
              >
                {cancelMutation.isPending ? "Sending…" : "Send cancellation request"}
              </button>
              <p className="text-xs text-muted-foreground">
                Nothing is cancelled or deleted automatically. We release your number and close the
                account after confirming with you.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
