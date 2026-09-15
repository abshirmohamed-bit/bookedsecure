import { describe, expect, it } from "vitest";
import {
  PROVIDER_CREDIT_COST_CENTS,
  PROVIDER_NUMBER_COST_CENTS,
  monthKey,
  statementsToCsv,
  type TenantMonthStatement,
} from "@/lib/provider-costs.server";

/**
 * The money split is arithmetic on the supplier rates: these lock in the
 * numbers the platform bills on, so a rate change can never silently make a
 * plan unprofitable or a tenant-visible price wrong.
 */
const creditsCost = (credits: number) => credits * PROVIDER_CREDIT_COST_CENTS;
const margin = (revenueCents: number, costCents: number) => revenueCents - costCents;

describe("supplier rates", () => {
  it("bills the provider's published prices", () => {
    expect(PROVIDER_NUMBER_COST_CENTS).toBe(1500);
    expect(PROVIDER_CREDIT_COST_CENTS).toBe(3);
  });
});

describe("plan month split", () => {
  it("leaves margin on Essentials after the tenant's number", () => {
    expect(margin(20000, PROVIDER_NUMBER_COST_CENTS)).toBe(18500);
  });

  it("leaves margin on Pro after the tenant's number", () => {
    expect(margin(30000, PROVIDER_NUMBER_COST_CENTS)).toBe(28500);
  });

  it("charges no rental to a tenant with no dedicated number", () => {
    expect(margin(20000, 0)).toBe(20000);
  });

  it("keeps the founder's number-only plan at cost", () => {
    expect(margin(1500, PROVIDER_NUMBER_COST_CENTS)).toBe(0);
  });
});

describe("credit pack split", () => {
  const packs = [
    { credits: 500, amountCents: 3000 },
    { credits: 1500, amountCents: 9000 },
    { credits: 5000, amountCents: 30000 },
  ];

  it("keeps every retail pack profitable at 3c cost", () => {
    for (const pack of packs) {
      expect(margin(pack.amountCents, creditsCost(pack.credits))).toBeGreaterThan(0);
    }
  });

  it("breaks even on founder packs sold at cost", () => {
    expect(margin(creditsCost(1500), creditsCost(1500))).toBe(0);
  });
});

describe("month key", () => {
  it("normalises any date to the first of its month", () => {
    expect(monthKey(new Date("2026-09-15T22:30:00Z"))).toBe("2026-09-01");
    expect(monthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01");
  });
});

describe("statement export", () => {
  const rows: TenantMonthStatement[] = [
    {
      businessId: "b1",
      businessName: 'Ada "Sparkle" Co',
      month: "2026-09-01",
      revenueCents: 20000,
      providerCostCents: 1800,
      marginCents: 18200,
      segmentsSent: 100,
    },
  ];

  it("writes dollars and quotes names safely", () => {
    const csv = statementsToCsv(rows);
    expect(csv.split("\n")[0]).toContain("profit_aud");
    expect(csv).toContain('"Ada ""Sparkle"" Co"');
    expect(csv).toContain("200.00,18.00,182.00");
  });

  it("handles a month with no tenants", () => {
    expect(statementsToCsv([]).split("\n")).toHaveLength(1);
  });
});
