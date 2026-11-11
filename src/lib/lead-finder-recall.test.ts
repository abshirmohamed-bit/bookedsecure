import { describe, expect, it } from "vitest";
import { candidateFromOsm, contactLinks, emailsOnPage, mergeCandidates, osmCategoryTags, osmKeywords, overpassQuery, siteMatchesName, webFallbackQueries, widerBox } from "./lead-finder";

describe("getting the most results", () => {
  it("knows how the map files common kinds of business", () => {
    const tagsFor = (what: string) => osmCategoryTags(osmKeywords(what));
    expect(tagsFor("plumbers")).toContain("craft=plumber");
    expect(tagsFor("electricians")).toContain("craft=electrician");
    expect(tagsFor("real estate agents")).toContain("office=estate_agent");
    expect(tagsFor("childcare centres")).toContain("amenity=kindergarten");
    expect(tagsFor("hairdressers")).toContain("shop=hairdresser");
    expect(tagsFor("cafes")).toContain("amenity=cafe");
    expect(tagsFor("vets")).toContain("amenity=veterinary");
  });

  it("searches by name in its own step, for words the map has no category for", () => {
    const q = overpassQuery(["vending", "supplier"], [-34, 151, -33.9, 151.1], 40, null, "names");
    expect(q).toContain('nwr["name"~"vending|supplier",i]');
    const tags = overpassQuery(["plumber"], [-34, 151, -33.9, 151.1], 40, null, "tags");
    expect(tags).toContain('nwr["craft"="plumber"]["name"]');
    expect(tags).not.toContain('"name"~');
  });

  it("keeps name-only matches but ranks them after real ones", () => {
    const chemist = candidateFromOsm({ type: "node", id: 1, tags: { name: "Chemist Warehouse", shop: "chemist" } }, ["warehou"])!;
    const real = candidateFromOsm({ type: "node", id: 2, tags: { name: "Go Logistics", building: "warehouse" } }, ["warehou"])!;
    expect(chemist.weak).toBe(true);
    expect(real.weak).toBe(false);
    expect(mergeCandidates([[chemist, real]], 10).map((c) => c.name)).toEqual(["Go Logistics", "Chemist Warehouse"]);
  });

  it("uses the email a map listing publishes, and accepts contact-only places", () => {
    expect(candidateFromOsm({ type: "node", id: 3, tags: { name: "Acme Vending", "contact:email": "Hello@Acme.com.au", phone: "02 9000 0000" } }, ["vending"]))
      .toMatchObject({ email: "hello@acme.com.au", category: null });
    expect(candidateFromOsm({ type: "node", id: 4, tags: { name: "Some Park Sign" } }, ["park"])).toBeNull();
  });

  it("finds emails written to dodge scrapers", () => {
    expect(emailsOnPage("Email info [at] sparkle.com.au today", "https://sparkle.com.au")).toEqual(["info@sparkle.com.au"]);
    expect(emailsOnPage("mailto:hello@sparkle.com.au", "https://sparkle.com.au")).toEqual(["hello@sparkle.com.au"]);
  });

  it("looks on the contact page, on the business's own site only", () => {
    expect(contactLinks(["https://sparkle.com.au/contact-us", "https://other.com/contact", "https://sparkle.com.au/about"], "https://sparkle.com.au"))
      .toEqual(["https://sparkle.com.au/contact-us", "https://sparkle.com.au/about"]);
    expect(contactLinks(undefined, "https://sparkle.com.au")).toEqual(["https://sparkle.com.au/contact", "https://sparkle.com.au/contact-us"]);
  });

  it("only accepts a website that clearly belongs to the business", () => {
    expect(siteMatchesName("Chew Dental Care", "https://chewdental.com.au", "Chew Dental Care Parramatta", "Parramatta")).toBe(true);
    expect(siteMatchesName("World Gym Auburn", "https://auburnlogistics.com.au", "Auburn Logistics", "Auburn")).toBe(false);
    expect(siteMatchesName("Auburn", "https://auburn.com.au", null, "Auburn")).toBe(false);
  });

  it("has plain phrases and a wider area to fall back on", () => {
    expect(webFallbackQueries("florists", "Auburn NSW")).toEqual(["florists Auburn NSW", "florists near Auburn NSW contact us", "best florists in Auburn NSW Australia"]);
    const [s, w, n, e] = widerBox([-33.9, 151, -33.8, 151.1]);
    expect(n - s).toBeGreaterThan(0.25);
    expect(e - w).toBeGreaterThan(0.25);
  });
});
