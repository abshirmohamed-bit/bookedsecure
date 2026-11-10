import { describe, expect, it } from "vitest";
import { emailStatusFromZeroBounce, emailsOnPage, hostOf, placesQuery, readFit, searchProblem, suburbFromAddress } from "./lead-finder";

describe("lead finder rules", () => {
  it("checks the search", () => {
    expect(searchProblem({ what: "cl", where: "Auburn" })).toMatch(/kind of business/);
    expect(searchProblem({ what: "cleaners", where: "" })).toMatch(/where/);
    expect(searchProblem({ what: "cleaners", where: "Auburn", criteria: "<script>" })).toMatch(/</);
    expect(searchProblem({ what: "cleaners", where: "Auburn NSW" })).toBeNull();
    expect(placesQuery(" cleaners ", " Auburn NSW ")).toBe("cleaners in Auburn NSW");
  });

  it("keeps only real published contact emails, own-domain first", () => {
    const page = "Contact us: info@sparkle.com.au or sam.smith@gmail.com. logo@2x.png noreply@sparkle.com.au user@example.com";
    expect(emailsOnPage(page, "https://www.sparkle.com.au")).toEqual(["info@sparkle.com.au", "sam.smith@gmail.com"]);
    expect(emailsOnPage("nothing here", null)).toEqual([]);
  });

  it("reads hosts, suburbs, fit and email checks", () => {
    expect(hostOf("www.sparkle.com.au/contact")).toBe("sparkle.com.au");
    expect(suburbFromAddress("12 Rawson St, Auburn NSW 2144, Australia")).toBe("Auburn");
    expect(suburbFromAddress(null)).toBeNull();
    expect(readFit("good")).toBe("good");
    expect(readFit("yes")).toBe("unknown");
    expect(emailStatusFromZeroBounce("valid")).toBe("valid");
    expect(emailStatusFromZeroBounce("catch-all")).toBe("risky");
    expect(emailStatusFromZeroBounce("spamtrap")).toBe("invalid");
  });
});

import { candidateFromOsm, candidatesFromWebSearch, isBusinessSite, mergeCandidates, osmKeywords, overpassQuery, readSuggestions } from "./lead-finder";

describe("free discovery", () => {
  it("turns a request into OpenStreetMap keywords", () => {
    expect(osmKeywords("warehouses, factories and gyms")).toEqual(["warehou", "factor", "gym"]);
    expect(osmKeywords("cleaning companies")).toEqual(["cleaning"]);
    expect(overpassQuery(["gym"], [-33.9, 151, -33.8, 151.1])).toContain('nwr["leisure"="fitness_centre"]["name"](-33.9000,151.0000,-33.8000,151.1000)');
  });

  it("keeps business websites and drops directories and social sites", () => {
    expect(isBusinessSite("https://www.sparkle.com.au")).toBe(true);
    expect(isBusinessSite("https://www.yellowpages.com.au/find/cleaners")).toBe(false);
    expect(isBusinessSite("https://www.facebook.com/sparkle")).toBe(false);
    expect(isBusinessSite("https://www.nsw.gov.au")).toBe(false);
    const found = candidatesFromWebSearch([
      { url: "https://www.sparkle.com.au/office-cleaning", title: "Sparkle Cleaning | Office Cleaners Parramatta" },
      { url: "https://sparkle.com.au/contact", title: "Contact" },
      { url: "https://www.yelp.com.au/search?cleaners", title: "Best cleaners" },
    ]);
    expect(found).toEqual([expect.objectContaining({ id: "web:sparkle.com.au", name: "Sparkle Cleaning", website: "https://sparkle.com.au", source: "web" })]);
  });

  it("reads OpenStreetMap businesses and skips roads and outdoor gyms", () => {
    expect(candidateFromOsm({ type: "node", id: 1, tags: { name: "Plus Fitness", leisure: "fitness_centre", "addr:suburb": "Auburn", phone: "02 9000 0000", website: "https://plusfitness.com.au" } }))
      .toMatchObject({ id: "osm:node/1", category: "fitness centre", suburb: "Auburn", website: "https://plusfitness.com.au" });
    expect(candidateFromOsm({ type: "way", id: 2, tags: { name: "Metropolitan Freight Line", railway: "rail" } })).toBeNull();
    expect(candidateFromOsm({ type: "node", id: 3, tags: { name: "Outdoor Gym", leisure: "fitness_station" } })).toBeNull();
    expect(candidateFromOsm({ type: "node", id: 4, tags: { name: "Go Logistics", building: "warehouse" } })).toMatchObject({ category: "warehouse" });
  });

  it("merges sources without repeats, businesses with websites first", () => {
    const web = candidatesFromWebSearch([{ url: "https://plusfitness.com.au", title: "Plus Fitness" }]);
    const osm = [
      candidateFromOsm({ type: "node", id: 1, tags: { name: "Plus Fitness", leisure: "fitness_centre" } })!,
      candidateFromOsm({ type: "node", id: 2, tags: { name: "Go Logistics", building: "warehouse" } })!,
    ];
    expect(mergeCandidates([web, osm], 10).map((c) => c.id)).toEqual(["web:plusfitness.com.au", "osm:node/2"]);
  });

  it("reads Co-work's suggested searches", () => {
    const s = readSuggestions('Here: [{"what":"warehouses","where":"Auburn NSW","criteria":"20+ staff","why":"Staff need snacks"},{"what":"x","where":"y"}]');
    expect(s).toEqual([{ what: "warehouses", where: "Auburn NSW", criteria: "20+ staff", why: "Staff need snacks" }]);
    expect(readSuggestions("no json")).toEqual([]);
  });
});

import { readSearchPlan } from "./lead-finder";

describe("AI search plan", () => {
  it("keeps only safe, well-formed parts", () => {
    const plan = readSearchPlan('Sure: {"webQueries":["dental clinic Parramatta NSW","dentist Parramatta"],"osmTags":["amenity=dentist","healthcare=dentist","bad tag","shop=<x>","railway=station"],"nameWords":["dental","Smile!"]}');
    expect(plan).toEqual({ webQueries: ["dental clinic Parramatta NSW", "dentist Parramatta"], osmTags: ["amenity=dentist", "healthcare=dentist"], nameWords: ["dental", "smile"] });
    expect(readSearchPlan("no plan")).toBeNull();
    expect(readSearchPlan('{"osmTags":["railway=station"]}')).toBeNull();
  });
  it("uses the plan's categories in the map query", () => {
    const q = overpassQuery(["dentist"], [-33.9, 151, -33.8, 151.1], 40, { webQueries: [], osmTags: ["amenity=dentist"], nameWords: ["dental"] });
    expect(q).toContain('nwr["amenity"="dentist"]["name"]');
    expect(q).toContain('nwr["name"~"dental",i]');
  });
});
