import { describe, expect, it, vi } from "vitest";
import { buildApprovedFacts, type ApprovedServiceRecord } from "@/lib/approved-facts";

// No AI provider, no database: the admin client and AI SDK are stubbed so
// importing the module never opens a connection or calls a model.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("ai", () => ({
  generateText: () => {
    throw new Error("no live AI calls in tests");
  },
  Output: { object: () => ({}) },
}));

const { guardReply } = await import("@/lib/ai.server");

const TENANT_A = "biz-a";
const TENANT_B = "biz-b";

const rangeService: ApprovedServiceRecord = {
  id: "svc-a1",
  business_id: TENANT_A,
  name: "Full Detail",
  price_guidance: "$250 to $320",
  active: true,
};

const facts = (overrides: Partial<ApprovedServiceRecord> = {}, leadOverrides = {}) =>
  buildApprovedFacts({
    businessId: TENANT_A,
    lead: { business_id: TENANT_A, approved_service_id: "svc-a1", ...leadOverrides },
    services: [{ ...rangeService, ...overrides }],
  });

describe("approved price allow-list", () => {
  it("accepts a sentence quoting the exact approved guidance", () => {
    const r = guardReply(
      "Our approved guidance for Full Detail is $250 to $320.",
      facts(),
    );
    expect(r.flagged).toEqual([]);
    expect(r.reply).toContain("$250 to $320");
  });

  it("accepts formatting-equivalent normalisation of the approved guidance", () => {
    const r = guardReply("Full Detail is generally guided at $ 250 to $320.", facts());
    expect(r.flagged).toEqual([]);
  });

  it("rejects an unsupported price", () => {
    const r = guardReply("We can do it for $199.", facts());
    expect(r.flagged).toHaveLength(1);
    expect(r.reply).not.toMatch(/\$199/);
  });

  it("rejects an outdated price after the guidance changes", () => {
    const current = facts({ price_guidance: "$300 to $360" });
    const r = guardReply("Full Detail is guided at $250 to $320.", current);
    expect(r.flagged).toHaveLength(1);
  });

  it("rejects narrowing or manipulating the approved range", () => {
    expect(guardReply("It will be $285 for a Full Detail.", facts()).flagged).toHaveLength(1);
    expect(guardReply("The price starts at $250.", facts()).flagged).toHaveLength(1);
    expect(
      guardReply("Full Detail is $250 to $320 plus $40 for pet hair.", facts()).flagged,
    ).toHaveLength(1);
  });

  it("rejects invented discounts and unsupported percentages", () => {
    expect(guardReply("We can give you 15% off the $250 to $320 guidance.", facts()).flagged)
      .toHaveLength(1);
    expect(guardReply("There is a discount available on Full Detail.", facts()).flagged)
      .toHaveLength(1);
  });

  it("rejects unsupported fees, deposits and taxes", () => {
    expect(guardReply("There is a $30 service fee.", facts()).flagged).toHaveLength(1);
    expect(guardReply("A $50 deposit is required on the $250 to $320 job.", facts()).flagged)
      .toHaveLength(1);
    expect(guardReply("Full Detail is $250 to $320 plus GST.", facts()).flagged).toHaveLength(1);
  });

  it("rejects final-price and guarantee promises", () => {
    expect(guardReply("Your final price will be $250 to $320.", facts()).flagged).toHaveLength(1);
    expect(guardReply("We guarantee the job will cost $250 to $320.", facts()).flagged)
      .toHaveLength(1);
  });

  it("rejects inspection-conditional price promises", () => {
    const r = guardReply("The price is $250 to $320 after inspection.", facts());
    expect(r.flagged).toHaveLength(1);
  });

  it("rejects a price sourced from another tenant's service", () => {
    const otherTenant = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { business_id: TENANT_A, approved_service_id: "svc-b1" },
      services: [
        { id: "svc-b1", business_id: TENANT_B, name: "Express Wash", price_guidance: "from $90", active: true },
      ],
    });
    expect(guardReply("Express Wash is guided at from $90.", otherTenant).flagged).toHaveLength(1);
  });

  it("rejects a price sourced from an inactive service", () => {
    const inactive = facts({ active: false });
    expect(guardReply("Full Detail is guided at $250 to $320.", inactive).flagged).toHaveLength(1);
  });

  it("rejects any price when the service is ambiguous or under owner review", () => {
    const review = facts({}, { requires_owner_review: true });
    expect(guardReply("Full Detail is guided at $250 to $320.", review).flagged).toHaveLength(1);
  });

  it("rejects any price when approved guidance is missing", () => {
    const noPrice = facts({ price_guidance: null });
    expect(guardReply("Full Detail is guided at $250 to $320.", noPrice).flagged).toHaveLength(1);
  });

  it("keeps Phase 1 behaviour when no approved facts are passed", () => {
    const r = guardReply("Full Detail is guided at $250 to $320.");
    expect(r.flagged).toHaveLength(1);
  });

  it("never allows the reactivation discount as a quote fact", () => {
    const r = guardReply("You can have 15% off as a returning customer.", facts());
    expect(r.flagged).toHaveLength(1);
    expect(r.reply).not.toMatch(/15%/);
  });
});

describe("booking and commitment guardrails stay closed", () => {
  const approved = facts();
  const blocked = [
    "We can come tomorrow.",
    "A detailer is free at 9am.",
    "We have availability this week.",
    "Your appointment slot is held.",
    "You are booked in for a Full Detail.",
    "We have you scheduled for Monday.",
    "Your appointment is confirmed.",
  ];

  it("blocks dates, times, availability, slots, bookings and scheduling", () => {
    for (const sentence of blocked) {
      const r = guardReply(`${sentence} The owner will confirm the right option.`, approved);
      expect(r.flagged, sentence).toHaveLength(1);
      expect(r.reply).toBe("The owner will confirm the right option.");
    }
  });

  it("does not add photo requests to any guarded reply", () => {
    const r = guardReply("Our Full Detail covers a full interior vacuum.", approved);
    expect(r.reply).not.toMatch(/photo|pic|image/i);
  });

  it("keeps approved facts flagged for human review only", () => {
    expect(approved.needsHumanReview).toBe(true);
  });
});
