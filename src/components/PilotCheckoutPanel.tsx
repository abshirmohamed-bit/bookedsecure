import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { createPilotCheckoutSession } from "@/lib/pilot-checkout.functions";
import { getStripe, isTestModePayments } from "@/lib/stripe";
const ACCESS_STATE_LABELS: Record<string, string> = {
  pending: "Awaiting payment",
  paid: "Paid",
  past_due: "Payment failed",
  canceled: "Canceled",
  paused: "Paused",
  pilot_expired: "Pilot expired",
};

type Props = {
  applicationId: string;
  status: string;
  accessState: string;
  pilotStartedAt: string | null;
  pilotEndsAt: string | null;
  paymentCompletedAt: string | null;
};

/**
 * Platform-admin panel to invite one approved application to the paid pilot.
 * The checkout form is hosted by Stripe and mounted inline; no card data ever
 * touches BookedSecure.
 */
export function PilotCheckoutPanel(props: Props) {
  const queryClient = useQueryClient();
  const start = useServerFn(createPilotCheckoutSession);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const result = await start({
        data: { applicationId: props.applicationId, returnPath: "/admin/pilot-applications" },
      });
      if ("error" in result && result.error) throw new Error(result.error);
      return result as { clientSecret: string; sessionId: string };
    },
    onSuccess: (result) => {
      setClientSecret(result.clientSecret);
      queryClient.invalidateQueries({ queryKey: ["pilot-applications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const label = ACCESS_STATE_LABELS[props.accessState] ?? props.accessState;
  const approved = props.status === "accepted" || props.status === "active";
  const canInvite = approved && props.accessState === "pending";

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Paid pilot</h3>
          <p className="text-xs text-muted-foreground">
            AUD $99.00 / month · 250 SMS segments · 30-day pilot
          </p>
        </div>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs">{label}</span>
      </div>

      <dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <div>
          <dt className="uppercase tracking-wide">Payment</dt>
          <dd>
            {props.paymentCompletedAt
              ? new Date(props.paymentCompletedAt).toLocaleString()
              : "Not paid"}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide">Pilot start</dt>
          <dd>
            {props.pilotStartedAt ? new Date(props.pilotStartedAt).toLocaleDateString() : "—"}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide">Pilot end</dt>
          <dd>{props.pilotEndsAt ? new Date(props.pilotEndsAt).toLocaleDateString() : "—"}</dd>
        </div>
      </dl>

      {canInvite ? (
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || Boolean(clientSecret)}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-input px-4 text-sm font-medium disabled:opacity-60"
        >
          {mutation.isPending ? "Creating checkout…" : "Create paid pilot checkout"}
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          {approved
            ? "Checkout is unavailable for this access state."
            : "Accept the application before inviting it to the paid pilot."}
        </p>
      )}

      {isTestModePayments() ? (
        <p className="text-xs text-muted-foreground">
          Payments are in test mode — no real money moves.
        </p>
      ) : null}

      {clientSecret ? (
        <div className="rounded-md bg-background p-2">
          <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      ) : null}
    </div>
  );
}
