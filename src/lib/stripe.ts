import { loadStripe, type Stripe } from "@stripe/stripe-js";

const clientToken = import.meta.env["VITE_PAYMENTS_CLIENT_TOKEN"] as string | undefined;

let stripePromise: Promise<Stripe | null> | null = null;

/** Publishable Stripe.js client. Throws when the build has no payments token. */
export function getStripe(): Promise<Stripe | null> {
  if (!clientToken?.startsWith("pk_test_") && !clientToken?.startsWith("pk_live_")) {
    throw new Error(
      "Payments are not configured for this build. Complete payment setup to enable checkout.",
    );
  }
  if (!stripePromise) stripePromise = loadStripe(clientToken);
  return stripePromise;
}

export function isTestModePayments(): boolean {
  return Boolean(clientToken?.startsWith("pk_test_"));
}
