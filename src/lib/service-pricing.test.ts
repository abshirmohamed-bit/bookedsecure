import { describe, expect, it } from "vitest";

import { isCampaignEligible, parseOfferPercent, servicePriceLine } from "@/lib/service-pricing";
import { promptFor, serviceAcknowledgement, type WebChatTenant } from "@/lib/web-chat";

const tenant = (offerPercent: number | null = null): WebChatTenant => ({
  name: "Any Detailing Co",
  flexibleRequestsEnabled: true,
  bookingEnabled: true,
  offerPercent,
  services: [
    {
      id: "s1",
      name: "Full Detail",
      description: "Inside and out",
      included_items: null,
      excluded_items: null,
      qualification_note: null,
      price_guidance: "from $250",
      campaign_eligible: true,
    },
    {
      id: "s2",
      name: "Ceramic Coating",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
      price_guidance: "from $900",
      campaign_eligible: false,
    },
    {
      id: "s3",
      name: "Quick Wash",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
      price_guidance: null,
      campaign_eligible: true,
    },
  ],
});

describe("parseOfferPercent", () => {
  it("reads the headline percentage", () => {
    expect(parseOfferPercent("15% off your next enquiry")).toBe(15);
    expect(parseOfferPercent("Save 5 % this month")).toBe(5);
  });

  it("returns null without a usable percentage", () => {
    expect(parseOfferPercent(null)).toBeNull();
    expect(parseOfferPercent("Free upgrade")).toBeNull();
    expect(parseOfferPercent("0% off")).toBeNull();
  });
});

describe("servicePriceLine", () => {
  it("shows the tenant price verbatim with no offer", () => {
    expect(servicePriceLine({ price_guidance: "from $250" })).toBe("from $250");
  });

  it("highlights the percentage without computing a discounted amount", () => {
    const line = servicePriceLine({ price_guidance: "from $250" }, 15);
    expect(line).toBe("from $250 — 15% off with your offer");
    expect(line).not.toContain("212");
  });

  it("skips the offer for services excluded from campaigns", () => {
    expect(servicePriceLine({ price_guidance: "from $900", campaign_eligible: false }, 15)).toBe(
      "from $900",
    );
    expect(isCampaignEligible({ campaign_eligible: false })).toBe(false);
  });

  it("shows no price when the tenant entered none", () => {
    expect(servicePriceLine({ price_guidance: null }, 15)).toBeNull();
    expect(servicePriceLine({ price_guidance: "   " })).toBeNull();
  });
});

describe("service choices", () => {
  it("lists each price in the service options", () => {
    const options = promptFor("service", tenant()).options ?? [];
    expect(options[0]?.detail).toContain("from $250");
    expect(options[2]?.detail ?? "").not.toContain("$");
  });

  it("highlights the campaign discount only on eligible services", () => {
    const options = promptFor("service", tenant(15)).options ?? [];
    expect(options[0]?.detail).toContain("15% off with your offer");
    expect(options[1]?.detail).toContain("from $900");
    expect(options[1]?.detail).not.toContain("15%");
  });
});

describe("serviceAcknowledgement", () => {
  it("repeats the chosen service with its price", () => {
    expect(serviceAcknowledgement(tenant(), { service_id: "s1", service_name: "Full Detail" })).toBe(
      "Full Detail — from $250.",
    );
  });

  it("adds the discount for a recognised campaign visitor", () => {
    expect(
      serviceAcknowledgement(tenant(15), { service_id: "s1", service_name: "Full Detail" }),
    ).toBe("Full Detail — from $250 — 15% off with your offer.");
  });

  it("stays price-free when no price is on file", () => {
    expect(serviceAcknowledgement(tenant(15), { service_id: "s3", service_name: "Quick Wash" })).toBe(
      "Quick Wash, got it.",
    );
  });

  it("returns nothing without a chosen service", () => {
    expect(serviceAcknowledgement(tenant(), {})).toBeNull();
  });
});
