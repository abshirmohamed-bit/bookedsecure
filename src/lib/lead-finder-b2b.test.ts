import { describe, expect, it } from "vitest";
import { candidatesFromWebSearch, isBusinessSite, looksLikeArticle, osmCategoryTags, osmKeywords, wideAreaCentres } from "@/lib/lead-finder";
import { csvForResults, filterResults, type ViewResult } from "@/lib/lead-finder-view";

describe("B2B targets", () => {
  it("keeps property managers, councils and hospitals when the search asks for them", () => {
    expect(isBusinessSite("https://www.cbre.com.au")).toBe(false);
    expect(isBusinessSite("https://www.cbre.com.au", "commercial property managers in Sydney")).toBe(true);
    expect(isBusinessSite("https://www.cityofparramatta.nsw.gov.au", "councils in Western Sydney")).toBe(true);
    expect(isBusinessSite("https://www.westmead.health.nsw.gov.au", "hospitals in Western Sydney")).toBe(true);
    expect(isBusinessSite("https://www.westernsydney.edu.au", "universities in NSW")).toBe(true);
  });

  it("never keeps directories or social sites, whatever the search", () => {
    expect(isBusinessSite("https://www.yellowpages.com.au/x", "commercial property managers")).toBe(false);
    expect(isBusinessSite("https://www.linkedin.com/company/x", "councils")).toBe(false);
    expect(isBusinessSite("https://www.zoominfo.com/c/x", "security companies")).toBe(false);
  });

  it("a council's own map listing keeps its website", () => {
    expect(isBusinessSite("https://www.blacktown.nsw.gov.au", true)).toBe(true);
  });

  it("knows the buyers of security and vending businesses on the map", () => {
    expect(osmCategoryTags(osmKeywords("security guard companies"))).toContain("office=security");
    expect(osmCategoryTags(osmKeywords("property managers"))).toContain("office=property_management");
    expect(osmCategoryTags(osmKeywords("shopping centres"))).toContain("shop=mall");
  });
});

describe("articles and rankings are not businesses", () => {
  it("drops lists, rankings and guides", () => {
    expect(looksLikeArticle("Car Detailers in Sydney, NSW: ranks 201 to 250")).toBe(true);
    expect(looksLikeArticle("Top 10 Security Companies in Sydney (2026)")).toBe(true);
    expect(looksLikeArticle("Car Care Resource Library")).toBe(true);
    expect(looksLikeArticle("12 best vending machine suppliers")).toBe(true);
    expect(looksLikeArticle("Guardian Security", "https://guardian.com.au/blog/why-guards/")).toBe(true);
  });

  it("keeps a business that calls itself the best", () => {
    expect(looksLikeArticle("Best Mobile Detailing Sydney | Glow Detailing")).toBe(false);
    expect(looksLikeArticle("Sentinel Security Services – Sydney", "https://sentinel.com.au/")).toBe(false);
  });

  it("filters them out of web results", () => {
    const found = candidatesFromWebSearch([
      { url: "https://rankings.example-site.com.au/car-detailers-sydney", title: "Car Detailers in Sydney, NSW: ranks 201 to 250" },
      { url: "https://sentinelsecurity.com.au", title: "Sentinel Security Services" },
    ]);
    expect(found.map((c) => c.name)).toEqual(["Sentinel Security Services"]);
  });
});

describe("state and national searches", () => {
  it("fans a state out over its cities", () => {
    expect(wideAreaCentres("NSW")?.[0]).toBe("Sydney NSW");
    expect(wideAreaCentres("all of Victoria")?.[0]).toBe("Melbourne VIC");
    expect(wideAreaCentres("Australia")).toHaveLength(10);
    expect(wideAreaCentres("Australia-wide")?.length).toBeGreaterThan(5);
  });

  it("leaves a normal place alone", () => {
    expect(wideAreaCentres("Parramatta NSW")).toBeNull();
    expect(wideAreaCentres("Western Sydney")).toBeNull();
  });
});

const r = (over: Partial<ViewResult>): ViewResult => ({
  name: "X", category: null, suburb: null, address: null, phone: null, website: null, summary: null, email: null,
  emailStatus: "none", fit: "unknown", fitReason: null, status: "new", ...over,
});

describe("results on screen", () => {
  const list = [
    r({ name: "Phone only", fit: "good", phone: "02 9000 0000" }),
    r({ name: "Unread" }),
    r({ name: "Email and person", fit: "good", email: "info@a.com.au", emailStatus: "valid", contactName: "Jo Lee" }),
    r({ name: "Maybe", fit: "maybe", email: "hi@b.com.au" }),
  ];

  it("puts the best reachable good fits first", () => {
    expect(filterResults(list, "all", "best").map((x) => x.name)).toEqual(["Email and person", "Phone only", "Maybe", "Unread"]);
  });

  it("filters", () => {
    expect(filterResults(list, "email", "best").map((x) => x.name)).toEqual(["Email and person", "Maybe"]);
    expect(filterResults(list, "phone", "best").map((x) => x.name)).toEqual(["Phone only"]);
    expect(filterResults(list, "unknown", "best").map((x) => x.name)).toEqual(["Unread"]);
  });

  it("exports a CSV a spreadsheet can't run formulas from", () => {
    const csv = csvForResults([r({ name: "=HYPERLINK(\"http://x\")", summary: "Line one\nline \"two\"" })]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).startsWith("\"Business\"")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csv).toContain("\"Line one line \"\"two\"\"\"");
  });
});
