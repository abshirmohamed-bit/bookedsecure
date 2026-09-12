import { describe, expect, it } from "vitest";
import { CREDIT_PACKS, findCreditPack, formatAud } from "@/lib/sms/credit-packs";

/**
 * The packs are the tenant's only way to buy texts beyond the plan allowance,
 * so their price must stay above provider cost (3c per text) and every pack
 * must be resolvable by the id the UI sends back to the server.
 */
describe("SMS credit packs", () => {
  it("sells every pack at 6c per credit, matching the plan overage rate", () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.amountCents / pack.credits).toBe(6);
    }
  });

  it("keeps a 50% margin over the 3c provider cost per credit", () => {
    for (const pack of CREDIT_PACKS) {
      const cost = pack.credits * 3;
      expect((pack.amountCents - cost) / pack.amountCents).toBeCloseTo(0.5, 5);
    }
  });

  it("resolves each pack by id and rejects unknown ids", () => {
    for (const pack of CREDIT_PACKS) {
      expect(findCreditPack(pack.id)?.priceId).toBe(pack.priceId);
    }
    expect(findCreditPack("pack_does_not_exist")).toBeNull();
  });

  it("uses unique ids and Stripe price keys", () => {
    expect(new Set(CREDIT_PACKS.map((pack) => pack.id)).size).toBe(CREDIT_PACKS.length);
    expect(new Set(CREDIT_PACKS.map((pack) => pack.priceId)).size).toBe(CREDIT_PACKS.length);
  });

  it("formats AUD amounts for display", () => {
    expect(formatAud(12000)).toBe("$120.00");
    expect(formatAud(40000)).toBe("$400.00");
  });
});
