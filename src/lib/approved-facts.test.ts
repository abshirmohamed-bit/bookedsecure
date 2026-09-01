import { describe, expect, it } from "vitest";
import {
  buildApprovedFacts,
  buildApprovedFactsContext,
  hasApprovedPrice,
  type ApprovedServiceRecord,
} from "@/lib/approved-facts";

const TENANT_A = "biz-a";
const TENANT_B = "biz-b";

const serviceA: ApprovedServiceRecord = {
  id: "svc-a1",
  business_id: TENANT_A,
  name: "Full Detail",
  description: "Interior and exterior",
  included_items: "Vacuum, hand wash",
  excluded_items: "Paint correction",
  qualification_note: "Confirm vehicle size",
  price_guidance: "from $250",
  active: true,
};

const inactiveA: ApprovedServiceRecord = {
  id: "svc-a2",
  business_id: TENANT_A,
  name: "Retired Package",
  price_guidance: "from $99",
  active: false,
};

const serviceB: ApprovedServiceRecord = {
  id: "svc-b1",
  business_id: TENANT_B,
  name: "Express Wash",
  price_guidance: "from $90",
  active: true,
};

describe("approvedFacts construction", () => {
  it("builds facts from the tenant's active service the lead selected", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { business_id: TENANT_A, approved_service_id: "svc-a1", service_name_snapshot: "Full Detail" },
      services: [serviceA, inactiveA],
    });
    expect(facts).toMatchObject({
      businessId: TENANT_A,
      serviceId: "svc-a1",
      serviceName: "Full Detail",
      includedItems: "Vacuum, hand wash",
      excludedItems: "Paint correction",
      qualificationNote: "Confirm vehicle size",
      priceGuidance: "from $250",
      ambiguous: false,
      reason: "approved",
      needsHumanReview: true,
    });
    expect(hasApprovedPrice(facts)).toBe(true);
  });

  it("keeps tenant isolation: another tenant's service is never approved", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { business_id: TENANT_A, approved_service_id: "svc-b1" },
      services: [serviceB],
    });
    expect(facts.serviceId).toBeNull();
    expect(facts.priceGuidance).toBeNull();
    expect(facts.reason).toBe("service_unavailable");
  });

  it("rejects a lead belonging to a different tenant", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { business_id: TENANT_B, approved_service_id: "svc-a1" },
      services: [serviceA],
    });
    expect(hasApprovedPrice(facts)).toBe(false);
  });

  it("excludes inactive services", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a2", service_name_snapshot: "Retired Package" },
      services: [serviceA, inactiveA],
    });
    expect(facts.reason).toBe("service_unavailable");
    expect(facts.priceGuidance).toBeNull();
  });

  it("reflects the current price guidance, not a stale value", () => {
    const before = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1" },
      services: [serviceA],
    });
    const after = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1" },
      services: [{ ...serviceA, price_guidance: "from $310" }],
    });
    expect(before.priceGuidance).toBe("from $250");
    expect(after.priceGuidance).toBe("from $310");
  });

  it("never fabricates a price when guidance is missing", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1" },
      services: [{ ...serviceA, price_guidance: "  " }],
    });
    expect(facts.priceGuidance).toBeNull();
    expect(facts.reason).toBe("no_price_guidance");
    expect(hasApprovedPrice(facts)).toBe(false);
  });

  it("returns no facts when the lead chose no service", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { request_type: "recommendation" },
      services: [serviceA],
    });
    expect(facts.reason).toBe("no_service_selected");
    expect(facts.serviceName).toBeNull();
  });

  it("resolves the snapshot name when no service id is stored", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { service_name_snapshot: " full detail " },
      services: [serviceA],
    });
    expect(facts.serviceId).toBe("svc-a1");
  });

  it("treats an ambiguous snapshot as human review, not an arbitrary pick", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { service_name_snapshot: "Full Detail" },
      services: [serviceA, { ...serviceA, id: "svc-a3", price_guidance: "from $400" }],
    });
    expect(facts.ambiguous).toBe(true);
    expect(facts.reason).toBe("ambiguous_service");
    expect(hasApprovedPrice(facts)).toBe(false);
  });

  it("treats owner-review (flexible) requests as ambiguous", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1", requires_owner_review: true },
      services: [serviceA],
    });
    expect(facts.reason).toBe("owner_review_required");
    expect(hasApprovedPrice(facts)).toBe(false);
  });

  it("always requires human review and adds no photo, booking or discount fields", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1" },
      services: [serviceA],
    });
    expect(facts.needsHumanReview).toBe(true);
    expect(Object.keys(facts).join(" ")).not.toMatch(/photo|discount|book|slot|availab/i);
  });

  it("contains no hard-coded tenant values", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_B,
      lead: { approved_service_id: "svc-b1" },
      services: [serviceB],
    });
    expect(JSON.stringify(facts)).not.toMatch(/glocast/i);
    expect(facts.serviceName).toBe("Express Wash");
  });
});

describe("approvedFacts context block", () => {
  it("is a separate block that labels itself as the only pricing source", () => {
    const facts = buildApprovedFacts({
      businessId: TENANT_A,
      lead: { approved_service_id: "svc-a1" },
      services: [serviceA],
    });
    const block = buildApprovedFactsContext(facts);
    expect(block).toContain("Approved facts (allow-list)");
    expect(block).toContain("from $250");
    expect(block).toContain("Business Settings");
    expect(block).not.toMatch(/15%|reactivation|campaign/i);
  });

  it("instructs no pricing when nothing is approved", () => {
    const block = buildApprovedFactsContext(
      buildApprovedFacts({ businessId: TENANT_A, lead: {}, services: [] }),
    );
    expect(block).toContain("NONE");
    expect(block).not.toMatch(/\$/);
  });
});
