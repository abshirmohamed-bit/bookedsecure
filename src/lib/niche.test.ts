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

import { readEnquiryFlow } from "./business-profile";

describe("the website reader decides how enquiries run", () => {
  it("asks only the suburb when customers come to the business, with its own questions", () => {
    const flow = readEnquiryFlow({ location: "customer_visits", detailsQuestion: "What's the car doing, or what does it need?", detailsLabel: "What it needs", lastVisitQuestion: "When was it last serviced?", rebookDays: 180 });
    const kit = nicheKitFor({ trade: null, flow, suggestedSubject: { label: "Vehicle", options: ["Sedan", "SUV"] } });
    expect(kit).toMatchObject({ onSite: false, locationLabel: "Suburb", concernsLabel: "What it needs", lastServicedQuestion: "When was it last serviced?", subjectLabel: "Vehicle" });
  });

  it("asks for the address when the business goes to the customer", () => {
    const kit = nicheKitFor({ flow: readEnquiryFlow({ location: "we_visit", detailsQuestion: "Where are you moving to, and when?" }) });
    expect(kit).toMatchObject({ onSite: true, lastServicedQuestion: null, concernsQuestion: "Where are you moving to, and when?" });
  });

  it("keeps plans businesses remote and drops unusable suggestions", () => {
    expect(nicheKitFor({ model: "subscription", flow: readEnquiryFlow({ location: "we_visit" }) })).toMatchObject({ onSite: false, locationLabel: "Based in" });
    expect(readEnquiryFlow({ location: "somewhere" })).toBeNull();
    expect(readEnquiryFlow({ location: "remote", rebookDays: 3, detailsQuestion: "<b>hi</b>" })).toMatchObject({ rebookDays: null, detailsQuestion: null });
  });
});
