import { describe, expect, it } from "vitest";
import { nicheKitFor } from "./niche";
import { applyAnswer, nextStep, promptFor, reviewSummary, type WebChatCollected, type WebChatTenant } from "./web-chat";
import { TRADE_IDS } from "./trades";

const tenant = (niche: ReturnType<typeof nicheKitFor>, label = niche.subjectLabel): WebChatTenant => ({
  name: "Test Co",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: label,
  services: [],
  niche,
});

describe("niche kit", () => {
  it("keeps the detailing flow for detailers", () => {
    const kit = nicheKitFor({ trade: "auto_marine_detailing" });
    expect(kit).toMatchObject({ subjectLabel: "Vehicle", onSite: true, quantityLabel: "Vehicle" });
    expect(kit.serviceExample).toMatch(/ceramic/);
  });

  it("asks about the right thing for each trade", () => {
    expect(nicheKitFor({ trade: "pool_servicing" })).toMatchObject({ subjectLabel: "Pool", quantityLabel: null, onSite: true });
    expect(nicheKitFor({ trade: "mobile_pet_grooming" })).toMatchObject({ subjectLabel: "Pet", quantityLabel: "Pet" });
    expect(nicheKitFor({ trade: "commercial_cleaning" }).lastServicedQuestion).toBeNull();
    for (const trade of TRADE_IDS) expect(nicheKitFor({ trade }).subjectQuestion.length).toBeGreaterThan(5);
  });

  it("never asks a plans business for a street address, whatever its trade", () => {
    const kit = nicheKitFor({ trade: "other", model: "subscription", suggestedSubject: { label: "Company size", options: ["1-10", "11-50"] } });
    expect(kit).toMatchObject({ onSite: false, offeringWord: "plan", subjectLabel: "Company size", subjectOptions: ["1-10", "11-50"], quantityLabel: null, lastServicedQuestion: null });
  });
});

describe("the quote chat speaks each business's language", () => {
  it("uses the kit's questions", () => {
    const pool = tenant(nicheKitFor({ trade: "pool_servicing" }));
    expect(promptFor("service", pool, {}).text).toMatch(/pool clean/);
    expect(promptFor("concerns", pool, {}).text).toMatch(/How is the pool looking/);
    expect(reviewSummary({}, pool).find((f) => f.step === "concerns")?.label).toBe("Pool condition");
  });

  it("for a plans business, asks where they're based and skips the street address", () => {
    const saas = tenant(nicheKitFor({ model: "subscription" }));
    expect(promptFor("service", saas, {}).text).toMatch(/pick a plan/);
    expect(promptFor("suburb", saas, {}).text).toBe("Where is your business based?");
    const base: WebChatCollected = { service_id: "s1", vehicle_type: "11–50 people" };
    const answered = applyAnswer(base, "suburb", "Melbourne", saas);
    expect(answered.ok).toBe(true);
    const collected = answered.ok ? answered.collected : base;
    expect(collected).toMatchObject({ suburb: "Melbourne", service_address: "Melbourne" });
    expect(nextStep(collected)).toBe("concerns");
    expect(reviewSummary(collected, saas).some((f) => f.step === "address")).toBe(false);
  });

  it("still asks a detailer for the street address", () => {
    const det = tenant(nicheKitFor({ trade: "auto_marine_detailing" }));
    const answered = applyAnswer({ service_id: "s1", vehicle_type: "Sedan" }, "suburb", "Auburn", det);
    expect(answered.ok && nextStep(answered.collected)).toBe("address");
  });
});
