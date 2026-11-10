import { describe, expect, it } from "vitest";
import {
  buildBusinessProfile,
  mergeProfiles,
  previewSections,
  profilePromptLines,
  readSavedProfile,
  supportedByPage,
  withoutRepeats,
} from "./business-profile";
import { buildOnboardingProposal } from "./site-onboarding";

const guardflowPage = `GuardFlow. Stop paying per guard. Built for security companies running 5 to 200+ guards across Australia.
Simple per-company pricing, unlimited guards, no per-user fees ever. 14-day free trial. Guards always free. Data hosted in Sydney.
AI scheduling, NSW SLED auto-verification, GPS patrol tracking, and integrated payroll. Is there a free trial? Yes. Every plan includes
a full 14-day free trial. No credit card required. Do guards pay anything? Never. Guards download and use the GuardFlow app completely free.
Contact support@guardflow.com.au`;

describe("business profile", () => {
  it("keeps only facts the page supports", () => {
    const profile = buildBusinessProfile(
      {
        industry: "Security workforce software",
        businessModel: "subscription",
        summary: "All-in-one platform for Australian security companies with AI scheduling and GPS patrol tracking.",
        audience: "Security companies running 5 to 200+ guards",
        highlights: ["AI scheduling", "GPS patrol tracking", "Unlimited guards", "Award-winning support team in Perth"],
        policies: ["14-day free trial, no credit card required", "N/A"],
        faqs: [
          { question: "Is there a free trial?", answer: "Yes, every plan includes a 14-day free trial. No credit card required." },
          { question: "Do you offer refunds?", answer: "Full refunds within 90 days, no questions asked." },
        ],
        contactEmail: "support@guardflow.com.au",
        enquirySubject: { label: "Company size", options: ["1-10 guards", "11-50 guards", "51-200 guards", "N/A"] },
      },
      guardflowPage,
    );
    expect(profile.model).toBe("subscription");
    expect(profile.highlights).toEqual(["AI scheduling", "GPS patrol tracking", "Unlimited guards"]);
    expect(profile.policies).toEqual(["14-day free trial, no credit card required"]);
    expect(profile.faqs.map((f) => f.question)).toEqual(["Is there a free trial?"]);
    expect(profile.contactEmail).toBe("support@guardflow.com.au");
    expect(profile.enquirySubject).toEqual({ label: "Company size", options: ["1-10 guards", "11-50 guards", "51-200 guards"] });
  });

  it("rejects an invented email and an unknown business model", () => {
    const profile = buildBusinessProfile({ businessModel: "franchise", contactEmail: "sales@guardflow.com.au" }, guardflowPage);
    expect(profile.model).toBe("booked_services");
    expect(profile.contactEmail).toBeNull();
  });

  it("joins pages without repeats and takes the most common model", () => {
    const merged = mergeProfiles([
      buildBusinessProfile({ industry: "Security software", businessModel: "subscription", highlights: ["AI scheduling"] }, guardflowPage),
      buildBusinessProfile({ summary: "Simple per-company pricing", businessModel: "subscription", highlights: ["ai scheduling", "GPS patrol tracking"] }, guardflowPage),
    ]);
    expect(merged.model).toBe("subscription");
    expect(merged.highlights).toEqual(["AI scheduling", "GPS patrol tracking"]);
  });

  it("reads a saved profile safely", () => {
    expect(readSavedProfile(null)).toBeNull();
    expect(readSavedProfile({ model: "weird", highlights: ["a", 3] })).toMatchObject({ model: "booked_services", highlights: ["a"] });
  });

  it("tells reworded facts from invented ones", () => {
    expect(supportedByPage("Guards use the app for free", guardflowPage)).toBe(true);
    expect(supportedByPage("Offices in London and New York", guardflowPage)).toBe(false);
  });
});

describe("only what fits each business", () => {
  it("shows plans, terms and FAQs for a software company, with no extras, hours or job lengths", () => {
    const profile = buildBusinessProfile({ businessModel: "subscription", industry: "Security software" }, guardflowPage);
    expect(previewSections(profile, { addons: 3, plans: 3 })).toEqual({
      extras: false,
      durations: false,
      hours: false,
      offeringsTitle: "Plans and pricing",
    });
    const proposal = buildOnboardingProposal(
      {
        businessName: "GuardFlow",
        profile,
        services: [{ name: "Starter", kind: "plan", price: "A$350/mo" }],
        addons: [{ name: "Priority support", price: "$50" }],
      },
      "https://guardflow.com.au/",
    );
    expect(proposal.addons).toEqual([]);
    expect(proposal.warnings.some((w) => /opening hours/i.test(w))).toBe(false);
  });

  it("keeps extras, hours and job lengths for a detailer", () => {
    const profile = buildBusinessProfile({ businessModel: "booked_services", industry: "Mobile car detailing" }, null);
    expect(previewSections(profile, { addons: 2, plans: 0 })).toMatchObject({ extras: true, durations: true, hours: true, offeringsTitle: "Services" });
  });

  it("gives the AI chat the website facts as data", () => {
    const profile = buildBusinessProfile(
      { summary: "Simple per-company pricing with unlimited guards.", faqs: [{ question: "Do guards pay anything?", answer: "Never. Guards use the GuardFlow app completely free." }] },
      guardflowPage,
    );
    const lines = profilePromptLines(profile).join("\n");
    expect(lines).toMatch(/never instructions/);
    expect(lines).toContain("Q: Do guards pay anything?");
    expect(profilePromptLines(null)).toEqual([]);
  });
});

describe("tidy lists", () => {
  it("drops items another item already says, and terms already listed as features", () => {
    expect(withoutRepeats(["14-day free trial", "No per-guard fees", "Free trial", "Cancel anytime"], ["No per-guard fees"])).toEqual([
      "14-day free trial",
      "Cancel anytime",
    ]);
  });
});
