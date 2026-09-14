/**
 * Promo code rules: who may redeem what, and which prices that unlocks.
 *
 * The point of these tests is tenant isolation — a reserved code must be
 * useless to any other business, and the discounted pack set must never be
 * reachable by a business without the entitlement.
 */
import { describe, expect, it } from "vitest";
import { canRedeem, normalisePromoCode, NO_PROMO, type PromoCodeRules } from "@/lib/promo";
import { CREDIT_PACKS, findCreditPack, packsFor } from "@/lib/sms/credit-packs";

const GLOCAST = "11111111-1111-1111-1111-111111111111";
const OTHER = "67fd45ba-6656-4dc1-91d1-60bc02881085";

const usamah: PromoCodeRules = {
  code: "USAMAH",
  active: true,
  maxRedemptions: 1,
  reservedBusinessId: GLOCAST,
};

describe("promo code entry", () => {
  it("accepts the code however it is typed", () => {
    expect(normalisePromoCode(" usamah ")).toBe("USAMAH");
    expect(normalisePromoCode("Us amah")).toBe("USAMAH");
  });
});

describe("who may redeem", () => {
  const base = { redemptionCount: 0, businessAlreadyHasCode: null };

  it("lets the reserved business redeem it once", () => {
    expect(canRedeem({ rules: usamah, businessId: GLOCAST, ...base }).ok).toBe(true);
  });

  it("refuses every other business", () => {
    const result = canRedeem({ rules: usamah, businessId: OTHER, ...base });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That code isn't valid.");
  });

  it("refuses an unknown or switched-off code", () => {
    expect(canRedeem({ rules: null, businessId: GLOCAST, ...base }).ok).toBe(false);
    expect(canRedeem({ rules: { ...usamah, active: false }, businessId: GLOCAST, ...base }).ok).toBe(false);
  });

  it("refuses a code that has been used up", () => {
    const result = canRedeem({ rules: usamah, businessId: GLOCAST, ...base, redemptionCount: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("That code has already been used.");
  });

  it("refuses a second code on the same business, and re-applying the same one", () => {
    expect(
      canRedeem({ rules: usamah, businessId: GLOCAST, redemptionCount: 1, businessAlreadyHasCode: "USAMAH" }).ok,
    ).toBe(false);
    expect(
      canRedeem({ rules: usamah, businessId: GLOCAST, redemptionCount: 0, businessAlreadyHasCode: "OTHER" }).ok,
    ).toBe(false);
  });

  it("allows an open code with no reservation and no limit", () => {
    const open: PromoCodeRules = { code: "LAUNCH", active: true, maxRedemptions: null, reservedBusinessId: null };
    expect(canRedeem({ rules: open, businessId: OTHER, redemptionCount: 999, businessAlreadyHasCode: null }).ok).toBe(
      true,
    );
  });
});

describe("what a code unlocks", () => {
  it("founder credits are 3c each, standard credits 6c", () => {
    for (const pack of packsFor("founder_3c")) {
      expect(pack.amountCents / pack.credits).toBeCloseTo(3, 5);
    }
    for (const pack of CREDIT_PACKS) {
      expect(pack.amountCents / pack.credits).toBeCloseTo(6, 5);
    }
  });

  it("a business with no promo gets the standard prices", () => {
    expect(NO_PROMO.creditPackSet).toBe("standard");
    expect(packsFor(NO_PROMO.creditPackSet)).toEqual(CREDIT_PACKS);
    expect(packsFor(undefined)).toEqual(CREDIT_PACKS);
    expect(packsFor("nonsense")).toEqual(CREDIT_PACKS);
    expect(findCreditPack("pack_500")?.amountCents).toBe(3000);
  });

  it("pack ids are stable across sets so a saved auto top-up choice keeps working", () => {
    expect(packsFor("founder_3c").map((p) => p.id)).toEqual(CREDIT_PACKS.map((p) => p.id));
    expect(findCreditPack("pack_500", "founder_3c")?.amountCents).toBe(1500);
    expect(findCreditPack("pack_500", "founder_3c")?.priceId).toBe("sms_credit_pack_500_founder");
  });

  it("every pack across every set has its own Stripe price", () => {
    const priceIds = [...CREDIT_PACKS, ...packsFor("founder_3c")].map((p) => p.priceId);
    expect(new Set(priceIds).size).toBe(priceIds.length);
  });
});
