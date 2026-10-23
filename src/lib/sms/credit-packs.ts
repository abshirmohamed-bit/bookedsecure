/**
 * Self-serve SMS credit packs.
 *
 * Client-safe: this module holds no secrets and is imported by both the
 * settings UI and the server-side checkout builder, so the price shown to an
 * owner and the price validated after payment always come from one place.
 *
 * There are two pack *sets*: the standard set every business gets, and
 * discounted sets unlocked by a promo code. A business is only ever shown, and
 * only ever charged, the set it is entitled to. the entitlement is resolved on
 * the server (see `promo.server.ts`), never sent up from the browser.
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

/** Pack sets. Pack ids are stable across sets so a saved auto top-up choice keeps working. */
export const CREDIT_PACK_SETS = {
  standard: [
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
  ],
  founder_3c: [
    {
      id: "pack_500",
      priceId: "sms_credit_pack_500_founder",
      label: "500 credits",
      credits: 500,
      amountCents: 1500,
      currency: "aud",
    },
    {
      id: "pack_1500",
      priceId: "sms_credit_pack_1500_founder",
      label: "1,500 credits",
      credits: 1500,
      amountCents: 4500,
      currency: "aud",
    },
    {
      id: "pack_5000",
      priceId: "sms_credit_pack_5000_founder",
      label: "5,000 credits",
      credits: 5000,
      amountCents: 15000,
      currency: "aud",
    },
  ],
} as const satisfies Record<string, readonly CreditPack[]>;

export type CreditPackSetId = keyof typeof CREDIT_PACK_SETS;

export const DEFAULT_CREDIT_PACK_SET: CreditPackSetId = "standard";

export function isCreditPackSetId(value: string | null | undefined): value is CreditPackSetId {
  return Boolean(value && value in CREDIT_PACK_SETS);
}

/** The packs for one set; unknown sets fall back to the standard prices. */
export function packsFor(setId: string | null | undefined): readonly CreditPack[] {
  return isCreditPackSetId(setId) ? CREDIT_PACK_SETS[setId] : CREDIT_PACK_SETS[DEFAULT_CREDIT_PACK_SET];
}

/** The standard packs. what every business without a promo code pays. */
export const CREDIT_PACKS: readonly CreditPack[] = CREDIT_PACK_SETS.standard;

export function findCreditPack(
  packId: string,
  setId: string | null | undefined = DEFAULT_CREDIT_PACK_SET,
): CreditPack | null {
  return packsFor(setId).find((pack) => pack.id === packId) ?? null;
}

/** Balance at or below this is shown as a warning in the owner UI. */
export const LOW_CREDIT_THRESHOLD = 50;

export function formatAud(amountCents: number): string {
  return `$${(amountCents / 100).toFixed(2)}`;
}
