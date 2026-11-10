import { describe, expect, it } from "vitest";
import {
  buildOnboardingProposal,
  keepItemsOnPage,
  phoneOnPage,
  isSameService,
  markExistingServices,
  normaliseAuContactNumber,
  normaliseSiteUrl,
  parseOpeningHours,
} from "@/lib/site-onboarding";

describe("normaliseSiteUrl", () => {
  it("accepts a bare domain", () => {
    expect(normaliseSiteUrl("example.com.au")).toBe("https://example.com.au/");
  });
  it("rejects rubbish", () => {
    expect(normaliseSiteUrl("not a url")).toBeNull();
    expect(normaliseSiteUrl("javascript:alert(1)")).toBeNull();
    expect(normaliseSiteUrl("localhost")).toBeNull();
  });
});

describe("normaliseAuContactNumber", () => {
  it("normalises mobiles and landlines", () => {
    expect(normaliseAuContactNumber("0447 852 565")).toBe("+61447852565");
    expect(normaliseAuContactNumber("(02) 9876 5432")).toBe("+61298765432");
    expect(normaliseAuContactNumber("+61 466 907 824")).toBe("+61466907824");
    expect(normaliseAuContactNumber("1300 123 456")).toBe("1300123456");
  });
  it("rejects anything else", () => {
    expect(normaliseAuContactNumber("555-0100")).toBeNull();
    expect(normaliseAuContactNumber(null)).toBeNull();
  });
});

describe("parseOpeningHours", () => {
  it("expands day ranges with am/pm times", () => {
    const windows = parseOpeningHours("Mon-Fri 8am-5pm, Sat 9am-1pm, Sunday closed");
    expect(windows.filter((w) => w.start === "08:00" && w.end === "17:00")).toHaveLength(5);
    expect(windows).toContainEqual({ weekday: 6, start: "09:00", end: "13:00" });
    expect(windows.some((w) => w.weekday === 0)).toBe(false);
  });
  it("infers am/pm for bare ranges and handles 24h text", () => {
    expect(parseOpeningHours("Tuesday 9 - 5")).toEqual([{ weekday: 2, start: "09:00", end: "17:00" }]);
    expect(parseOpeningHours("Wed 07:30 to 16:00")).toEqual([{ weekday: 3, start: "07:30", end: "16:00" }]);
  });
  it("covers everyday and weekend wording", () => {
    expect(parseOpeningHours("Open every day 7am-7pm")).toHaveLength(7);
    expect(parseOpeningHours("Weekends 10am-2pm").map((w) => w.weekday).sort()).toEqual([0, 6]);
  });
  it("drops what it cannot read", () => {
    expect(parseOpeningHours("By appointment only")).toEqual([]);
    expect(parseOpeningHours("Mon 5pm-9am")).toEqual([]);
  });
});

describe("buildOnboardingProposal", () => {
  it("keeps prices verbatim, dedupes services and defaults duration", () => {
    const proposal = buildOnboardingProposal(
      {
        businessName: "  Sparkle Detailing  ",
        suburb: "Auburn",
        phone: "0412 345 678",
        openingHours: "Mon-Fri 8am-4pm",
        logoUrl: "cdn.example.com/logo.png",
        services: [
          { name: "Full Detail", price: "from $250", durationMinutes: 180 },
          { name: "full detail", price: "$300" },
          { name: "Interior", price: null },
        ],
      },
      "https://example.com/",
    );

    expect(proposal.business.name).toBe("Sparkle Detailing");
    expect(proposal.business.service_area).toBe("Auburn");
    expect(proposal.business.phone_number).toBe("+61412345678");
    expect(proposal.services).toHaveLength(2);
    expect(proposal.services[0]).toMatchObject({ price_guidance: "from $250", duration_minutes: 180 });
    expect(proposal.services[1]).toMatchObject({ duration_minutes: 60 });
    expect(proposal.weeklyWindows).toHaveLength(5);
    expect(proposal.logoUrl).toBe("https://cdn.example.com/logo.png");
  });

  it("warns instead of inventing when the site says nothing", () => {
    const proposal = buildOnboardingProposal({}, "https://example.com/");
    expect(proposal.business.name).toBeNull();
    expect(proposal.services).toEqual([]);
    expect(proposal.weeklyWindows).toEqual([]);
    expect(proposal.warnings.length).toBeGreaterThan(2);
  });
});

describe("service duplicate matching", () => {
  it("treats punctuation, word order and filler words as the same service", () => {
    expect(isSameService("Full Detail (Interior & Exterior)", "Full Detail Interior + Exterior")).toBe(true);
    expect(isSameService("Interior Detail", "Full Interior Detail")).toBe(true);
    expect(isSameService("ceramic coating", "Ceramic Coating")).toBe(true);
  });

  it("keeps genuinely different services apart", () => {
    expect(isSameService("Exterior Detail", "Full Interior Detail")).toBe(false);
    expect(isSameService("Ceramic Coating", "Motorcycle Ceramic Coating")).toBe(false);
    expect(isSameService("Paint Correction", "Paint Enhancement Detail")).toBe(false);
  });

  it("flags only the services a tenant already offers", () => {
    const scraped = buildOnboardingProposal(
      {
        services: [
          { name: "Exterior Detail" },
          { name: "Full Detail (Interior & Exterior)" },
          { name: "Headlight Restoration" },
          { name: "Ceramic Coating" },
          { name: "Interior Detail" },
          { name: "Paint Correction" },
          { name: "Motorcycle Ceramic Coating" },
        ],
      },
      "https://example.com/",
    );
    const marked = markExistingServices(scraped, [
      "Pet Hair & Odour Treatment",
      "Paint Enhancement Detail",
      "Full Interior Detail",
      "Full Detail Interior + Exterior",
      "Ceramic Coating",
    ]);

    expect(marked.services.filter((service) => !service.alreadyHave).map((service) => service.name)).toEqual([
      "Exterior Detail",
      "Headlight Restoration",
      "Paint Correction",
      "Motorcycle Ceramic Coating",
    ]);
    expect(marked.services.filter((service) => service.alreadyHave)).toHaveLength(3);
  });
});

describe("software and subscription sites", () => {
  const page = `GuardFlow PRICING Run your security operation, from A$350/mo. Starter Core operations for small security teams. A$ 350 /mo
    Growth Compliance automation + payroll for growing operations. A$ 700 /mo Scale Unlimited AI + enterprise compliance. A$ 1,000 /mo
    AI scheduling, GPS patrol tracking, NSW SLED auto-verification and integrated payroll.`;

  it("drops plans and prices the page never shows", () => {
    const kept = keepItemsOnPage(
      [
        { name: "Starter", price: "A$350/mo" },
        { name: "Scale", price: "A$1,000/mo" },
        { name: "Starter Plan", price: "$99 per month" },
        { name: "Growth Plan", price: "$249 per month" },
      ],
      page,
    );
    expect(kept.map((item) => item.name)).toEqual(["Starter", "Scale"]);
  });

  it("proposes the plans, not the features, the headline price or the business name", () => {
    const proposal = buildOnboardingProposal(
      {
        businessName: "GuardFlow",
        services: [
          { name: "GuardFlow", price: "From A$350/mo", group: "Pricing" },
          { name: "AI Scheduling", kind: "feature", price: "From A$350/mo", group: "Pricing" },
          { name: "GPS Patrol Tracking", price: "From A$350/mo", group: "Pricing" },
          { name: "NSW SLED Auto-verification", price: "From A$350/mo", group: "Pricing" },
          { name: "Integrated Payroll", price: "From A$350/mo", group: "Pricing" },
          { name: "Starter", kind: "plan", price: "A$350/mo", description: "Core operations for small security teams.", group: "Pricing" },
          { name: "Growth", kind: "plan", price: "A$700/mo", group: "Plans and pricing" },
          { name: "Scale", kind: "plan", price: "A$1,000/mo", group: "Product" },
          { name: "Starter Plan", kind: "plan", price: "A$350/mo" },
          { name: "GuardFlow - Pricing Plan", price: "From A$350/mo" },
          { name: "Product - From A$350/mo", price: "From A$350/mo" },
        ],
      },
      "https://guardflow.com.au/",
    );
    const byName = new Map(proposal.services.map((service) => [service.name, service]));
    expect(byName.has("GuardFlow")).toBe(false);
    expect(byName.has("AI Scheduling")).toBe(false);
    expect(byName.has("GuardFlow - Pricing Plan")).toBe(false);
    expect(byName.has("Product - From A$350/mo")).toBe(false);
    expect(byName.has("Starter Plan")).toBe(false);
    expect(byName.get("Starter")).toMatchObject({ price_guidance: "A$350/mo", billing: "recurring", duration_stated: false, category: null });
    expect(byName.get("Scale")?.category).toBeNull();
    // Unlabelled feature rows lose the page-wide headline price instead of showing it as their own.
    expect(byName.get("GPS Patrol Tracking")?.price_guidance).toBeNull();
    expect(proposal.warnings).toContain("The site doesn't list opening hours, so set your availability yourself.");
  });

  it("still reads a detailing price list the same way", () => {
    const proposal = buildOnboardingProposal(
      {
        businessName: "Shine Detailing",
        openingHours: "Mon-Fri 8am-5pm",
        services: [
          { name: "Interior Detail", price: "$180", durationMinutes: 120, group: "Interior" },
          { name: "Full Detail", price: "from $280", group: "Packages" },
        ],
      },
      "https://example.com.au/",
    );
    expect(proposal.services).toEqual([
      expect.objectContaining({ name: "Interior Detail", price_guidance: "$180", duration_minutes: 120, duration_stated: true, billing: "once", category: "Interior" }),
      expect.objectContaining({ name: "Full Detail", price_guidance: "from $280", duration_stated: false, category: "Packages" }),
    ]);
  });

  it("only keeps a phone number that is written on the page", () => {
    expect(phoneOnPage("0412 345 678", "Call us on 0412 345 678")).toBe(true);
    expect(phoneOnPage("0412 345 678", "Email support@example.com")).toBe(false);
  });
});

describe("what the live Guardflow read returned", () => {
  it("treats N/A and Not specified as nothing, merges duplicates and keeps plans out of extras", () => {
    const proposal = buildOnboardingProposal(
      {
        businessName: "Guardflow",
        openingHours: "Not specified",
        services: [
          { name: "Monthly Subscription - Starter Plan", kind: "plan", price: "A$350/mo", description: "Simple per-company pricing." },
          { name: "Starter Plan", kind: "plan", price: "N/A", description: "Access to the Service for companies." },
          { name: "Scale Plan", kind: "plan", price: "N/A" },
          { name: "Scale", kind: "plan", price: "A$1,000/mo" },
        ],
        addons: [
          { name: "14-day free trial", price: "Free" },
          { name: "Growth Plan", price: "N/A" },
          { name: "SLED Verification" },
          { name: "Additional Feature Customization", price: "Not specified" },
        ],
      },
      "https://guardflow.com.au/",
    );
    expect(proposal.services.map((s) => [s.name, s.price_guidance])).toEqual([
      ["Starter", "A$350/mo"],
      ["Scale", "A$1,000/mo"],
    ]);
    expect(proposal.addons).toEqual([]);
    expect(proposal.business.opening_hours).toBeNull();
  });

  it("keeps unpriced extras for a service business", () => {
    const proposal = buildOnboardingProposal(
      { businessName: "Shine", services: [{ name: "Full Detail", price: "$280" }], addons: [{ name: "Pet hair removal" }] },
      "https://example.com.au/",
    );
    expect(proposal.addons.map((a) => a.name)).toEqual(["Pet hair removal"]);
  });
});
