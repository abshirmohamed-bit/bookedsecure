import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { linkMyProviderNumber } from "@/lib/sms/texto-accounts.functions";
import { Button } from "@/components/ui/button";
import {
  NUMBER_MONTHLY_COST_CENTS,
  PROVIDER_LOGIN_URL,
  PROVIDER_SIGNUP_URL,
} from "@/lib/sms/texto-signup";
import { formatAud } from "@/lib/sms/credit-packs";

/**
 * Owner-facing: get your own Australian texting number from the provider.
 *
 * The tenant signs up through our referral link, buys and pays for their own
 * number there, and BookedSecure connects it automatically. Any number the
 * business already texts from keeps working, so replies to earlier texts still
 * come back here.
 */
export function TextoNumberPanel({ readOnly }: { readOnly?: boolean }) {
  const linkNumber = useServerFn(linkMyProviderNumber);
  const queryClient = useQueryClient();

  const link = useMutation({
    mutationFn: () => linkNumber(),
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(`${result.number} is now your texting number.`);
        void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
        void queryClient.invalidateQueries({ queryKey: ["settings"] });
      } else {
        toast.error(result.detail ? `${result.reason} ${result.detail}` : result.reason);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (readOnly) return null;

  return (
    <section className="panel overflow-hidden">
      <div className="section-heading">Your texting number</div>
      <div className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground">
          Your own Australian mobile number comes from our messaging provider for{" "}
          {formatAud(NUMBER_MONTHLY_COST_CENTS)} a month plus GST, paid directly to them with your
          own card. Sign up with the link below using the same email address as your BookedSecure
          login and we&apos;ll connect the number for you.
        </p>

        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Open the sign-up link and create your provider account.</li>
          <li>Buy one dedicated Australian number and fill in their identity form.</li>
          <li>Come back and press “I&apos;ve got my number”.</li>
        </ol>

        <div className="flex flex-wrap gap-2">
          <a
            href={PROVIDER_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground"
          >
            Get my number
          </a>
          <Button variant="secondary" disabled={link.isPending} onClick={() => link.mutate()}>
            {link.isPending ? "Checking…" : "I've got my number"}
          </Button>
          <a
            href={PROVIDER_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-input px-3 py-2 text-sm font-medium"
          >
            Already have an account
          </a>
        </div>

        <p className="text-xs text-muted-foreground">
          Any number you already text from stays switched on, so replies to earlier texts still
          reach you.
        </p>
      </div>
    </section>
  );
}
