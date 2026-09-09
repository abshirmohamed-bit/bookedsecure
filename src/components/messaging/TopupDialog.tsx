import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { toast } from "sonner";
import { startCreditTopup } from "@/lib/sms/messaging-account.functions";
import { formatAud } from "@/lib/sms/credit-packs";
import { getStripe, isTestModePayments } from "@/lib/stripe";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type TopupPack = {
  id: string;
  label: string;
  credits: number;
  amountCents: number;
};

/**
 * Buying credits happens in a floating pop-up over the Messaging page so the
 * page behind it never moves. It can be dismissed at any point (X, Esc, or a
 * click outside) and the payment form scrolls inside the pop-up on small
 * screens, so it never blocks the rest of the site.
 */
export function TopupDialog({
  open,
  onOpenChange,
  packs,
  overageCents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packs: readonly TopupPack[];
  overageCents: number;
}) {
  const buyCredits = useServerFn(startCreditTopup);
  const queryClient = useQueryClient();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const topupMutation = useMutation({
    mutationFn: async (packId: string) => {
      const result = await buyCredits({ data: { packId } });
      if ("error" in result && result.error) throw new Error(result.error);
      return result as { clientSecret: string };
    },
    onSuccess: (result) => setClientSecret(result.clientSecret),
    onError: (error: Error) => toast.error(error.message),
  });

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Reset so the next visit starts at the pack list, and pick up any
      // credits that were just paid for.
      setClientSecret(null);
      topupMutation.reset();
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Top up credits</DialogTitle>
          <DialogDescription>
            One credit sends one text once your included texts are used up — {overageCents}c each.
            Credits never expire.
          </DialogDescription>
        </DialogHeader>

        {clientSecret ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setClientSecret(null);
                topupMutation.reset();
              }}
              className="text-xs font-medium text-muted-foreground underline"
            >
              Choose a different amount
            </button>
            {isTestModePayments() ? (
              <p className="rounded-md border border-border bg-secondary/40 p-2 text-xs text-muted-foreground">
                Payments are in test mode — no real money moves.
              </p>
            ) : null}
            <div className="rounded-md bg-background p-1">
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                onClick={() => topupMutation.mutate(pack.id)}
                disabled={topupMutation.isPending}
                className="flex w-full items-center justify-between rounded-md border border-input px-3 py-3 text-left text-sm font-medium hover:bg-secondary/50 disabled:opacity-60"
              >
                <span>{pack.label}</span>
                <span>{formatAud(pack.amountCents)}</span>
              </button>
            ))}
            {topupMutation.isPending ? (
              <p className="text-xs text-muted-foreground">Opening secure payment…</p>
            ) : null}
            {isTestModePayments() ? (
              <p className="text-xs text-muted-foreground">
                Payments are in test mode — no real money moves.
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
