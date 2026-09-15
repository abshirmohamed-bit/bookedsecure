import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  claimNumberForBusiness,
  listNumbersForPurchase,
} from "@/lib/sms/texto-accounts.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAud } from "@/lib/sms/credit-packs";

/**
 * Owner-facing: pick a dedicated Australian number from the ones the provider
 * has for sale and claim it. Any number the business already texts from keeps
 * working, so replies to earlier texts still come back here.
 */
export function DedicatedNumberPanel({ readOnly }: { readOnly?: boolean }) {
  const fetchNumbers = useServerFn(listNumbersForPurchase);
  const claimNumber = useServerFn(claimNumberForBusiness);
  const queryClient = useQueryClient();
  const [browsing, setBrowsing] = useState(false);
  const [manualNumber, setManualNumber] = useState("");
  const [needsCard, setNeedsCard] = useState(false);

  const available = useQuery({
    queryKey: ["purchasable-numbers"],
    queryFn: () => fetchNumbers({ data: undefined }),
    enabled: browsing && !readOnly,
  });

  const claim = useMutation({
    mutationFn: (input: {
      number: string;
      monthlyCostCents?: number;
      alreadyPurchased?: boolean;
      providerRef?: string;
    }) => claimNumber({ data: input }),

    onSuccess: (result) => {
      if (result.ok) {
        setNeedsCard(false);
        toast.success(`${result.number} is now your number for new conversations.`);
        setManualNumber("");
        void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
        void queryClient.invalidateQueries({ queryKey: ["purchasable-numbers"] });
        void queryClient.invalidateQueries({ queryKey: ["settings"] });
      } else if ("code" in result && result.code === "no_payment_method") {
        setNeedsCard(true);
        toast.error(result.reason);
      } else {
        toast.error(result.detail ? `${result.reason} (${result.detail})` : result.reason);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (readOnly) return null;

  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">Your own number</div>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Claim a dedicated Australian mobile number. New conversations go out from it straight
          away, and any number you already text from stays switched on so replies to earlier texts
          still reach you.
        </p>

        {needsCard && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium">One-off step: add your card with the number provider</p>
            <p className="text-muted-foreground">
              The provider only allows numbers to be bought from here once a card has been used once
              in their own app. Buy a single number there, then come back:
            </p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Buy one dedicated Australian number in the provider's app with your card.</li>
              <li>Paste that number into “Already bought a number yourself?” below to connect it.</li>
              <li>
                Every number after that can be claimed straight from this page — the saved card is
                used automatically.
              </li>
            </ol>
            <Button size="sm" variant="secondary" onClick={() => setNeedsCard(false)}>
              I've added my card — try again
            </Button>
          </div>
        )}

        {!browsing ? (
          <Button onClick={() => setBrowsing(true)}>Show me available numbers</Button>
        ) : available.isLoading ? (
          <p className="text-sm text-muted-foreground">Checking what is available…</p>
        ) : !available.data?.live ? (
          <p className="text-sm text-muted-foreground">
            {available.data?.reason ?? "Number buying is not switched on yet."}
          </p>
        ) : available.data.numbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {available.data.reason ?? "No numbers are on offer right now. Try again shortly."}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {available.data.numbers.slice(0, 12).map((number) => (
              <li key={number.number} className="flex items-center justify-between gap-3 p-3">
                <div>
                  <p className="font-medium">{number.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatAud(number.monthlyCostCents)} per month
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={claim.isPending}
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Claim ${number.number} for ${formatAud(number.monthlyCostCents)} per month?`,
                      )
                    )
                      return;
                    claim.mutate({
                      number: number.number,
                      monthlyCostCents: number.monthlyCostCents,
                      ...(number.providerRef ? { providerRef: number.providerRef } : {}),
                    });

                  }}
                >
                  {claim.isPending ? "Claiming…" : "Claim this number"}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 rounded-md border border-dashed border-border p-3">
          <p className="text-sm font-medium">Already bought a number yourself?</p>
          <p className="text-xs text-muted-foreground">
            Enter it here and it will be connected to your account without being bought again.
          </p>
          <div className="flex gap-2">
            <Input
              value={manualNumber}
              onChange={(event) => setManualNumber(event.target.value)}
              placeholder="+61 4xx xxx xxx"
              inputMode="tel"
            />
            <Button
              variant="secondary"
              disabled={claim.isPending || manualNumber.replace(/\D/g, "").length < 8}
              onClick={() => claim.mutate({ number: manualNumber, alreadyPurchased: true })}
            >
              Connect it
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
