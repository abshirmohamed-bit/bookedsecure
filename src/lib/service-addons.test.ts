import { describe, expect, it } from "vitest";
import { buildOnboardingProposal, markExistingServices } from "@/lib/site-onboarding";

/**
 * Add-on extras read from a tenant's own website. Extras must attach to that
 * tenant's services, never duplicate a service, and never overwrite an extra
 * the tenant already has.
 */
describe("website extras become proposed add-ons", () => {
  const site = {
    businessName: "Any Detailing Co",
    services: [
      { name: "Full Interior Detail", price: "from $220", durationMinutes: 120 },
      { name: "Ceramic Coating", price: "from $900" },
    ],
    addons: [
      {
        name: "Pet Hair Removal",
        price: "+$60",
        description: "Deep vacuum for pet hair",
        durationMinutes: 30,
        appliesTo: ["Full Interior Detail"],
      },
      { name: "Ceramic Coating", price: "from $900" },
      { name: "Odour Treatment", price: "+$40" },
    ],
  };

  const proposal = buildOnboardingProposal(site, "https://example.com");

  it("attaches an extra to the service the site names", () => {
    const petHair = proposal.addons.find((addon) => addon.name === "Pet Hair Removal");
    expect(petHair?.serviceNames).toEqual(["Full Interior Detail"]);
    expect(petHair?.price_guidance).toBe("+$60");
    expect(petHair?.duration_minutes).toBe(30);
  });

  it("never repeats a service as an extra", () => {
    expect(proposal.addons.map((addon) => addon.name)).not.toContain("Ceramic Coating");
  });

  it("offers an unattached extra with every service for the owner to narrow", () => {
    const odour = proposal.addons.find((addon) => addon.name === "Odour Treatment");
    expect(odour?.serviceNames).toEqual(["Full Interior Detail", "Ceramic Coating"]);
  });

  it("flags extras the tenant already has", () => {
    const marked = markExistingServices(proposal, [], ["pet hair removal"]);
    expect(marked.addons.find((addon) => addon.name === "Pet Hair Removal")?.alreadyHave).toBe(true);
    expect(marked.addons.find((addon) => addon.name === "Odour Treatment")?.alreadyHave).toBe(false);
  });
});
