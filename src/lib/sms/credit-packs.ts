/**
 * Self-serve SMS credit packs.
 *
 * Client-safe: this module holds no secrets and is imported by both the
 * settings UI and the server-side checkout builder, so the price shown to an
 * owner and the price validated after payment always come from one place.
 *
 * `priceId` is the Stripe lookup key; the amount here is re-checked against
 * Stripe before any credits are added.
 */
export type CreditPack = {
  id: string;
  priceId: string;
  label: string;
  credits: number;
  amountCents: number;
  currency: "aud";
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  {
    id: "pack_500",
    priceId: "sms_credit_pack_500",
    label: "500 credits",
    credits: 500,
    amountCents: 3000,
    currency: "aud",
  },
  {
    id: "pack_1500",
    priceId: "sms_credit_pack_1500",
    label: "1,500 credits",
    credits: 1500,
    amountCents: 9000,
    currency: "aud",
  },
  {
    id: "pack_5000",
    priceId: "sms_credit_pack_5000",
    label: "5,000 credits",
    credits: 5000,
    amountCents: 30000,
    currency: "aud",
  },
] as const;

export function findCreditPack(packId: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === packId) ?? null;
}

/** Balance at or below this is shown as a warning in the owner UI. */
export const LOW_CREDIT_THRESHOLD = 50;

export function formatAud(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
