/**
 * Promo codes — client-safe types and pure rules.
 *
 * A promo code is a row, not a special case in code: it names the plan it
 * unlocks, the credit pack set it grants, how many businesses may ever redeem
 * it, and optionally the one business it is reserved for. Once redeemed the
 * entitlement is permanent for that business, so cancelling and re-subscribing
 * keeps the pricing.
 */
import type { CreditPackSetId } from "@/lib/sms/credit-packs";

export type PromoEntitlement = {
  /** The redeemed code, or null when the business has none. */
  code: string | null;
  /** A plan only this business may buy, or null for the public plans. */
  planId: string | null;
  creditPackSet: CreditPackSetId;
  /** Advertised price of one credit under this entitlement, in cents. */
  creditPriceCents: number | null;
};

export const NO_PROMO: PromoEntitlement = {
  code: null,
  planId: null,
  creditPackSet: "standard",
  creditPriceCents: null,
};

/** Codes are case- and space-insensitive for the person typing them. */
export function normalisePromoCode(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export type PromoCodeRules = {
  code: string;
  active: boolean;
  maxRedemptions: number | null;
  reservedBusinessId: string | null;
};

export type PromoCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether one business may redeem one code. Deliberately pure so every rule is
 * testable: an inactive code, a code reserved for someone else, a code that has
 * been used up, and a business that already holds a code are all refused with
 * wording an owner can act on.
 */
export function canRedeem(input: {
  rules: PromoCodeRules | null;
  businessId: string;
  redemptionCount: number;
  businessAlreadyHasCode: string | null;
}): PromoCheck {
  const { rules } = input;
  if (!rules || !rules.active) return { ok: false, error: "That code isn't valid." };
  if (input.businessAlreadyHasCode) {
    return input.businessAlreadyHasCode === rules.code
      ? { ok: false, error: "That code is already applied to your account." }
      : { ok: false, error: "Your account already has a code applied." };
  }
  if (rules.reservedBusinessId && rules.reservedBusinessId !== input.businessId) {
    return { ok: false, error: "That code isn't valid." };
  }
  if (rules.maxRedemptions !== null && input.redemptionCount >= rules.maxRedemptions) {
    return { ok: false, error: "That code has already been used." };
  }
  return { ok: true };
}
