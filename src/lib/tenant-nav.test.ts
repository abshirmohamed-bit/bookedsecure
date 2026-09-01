import { describe, expect, it } from "vitest";
import { tenantHeaderTitle, tenantQuotePath, tenantQuoteUrl } from "@/lib/tenant-nav";

describe("tenantQuotePath", () => {
  it("builds the tenant path for glocast", () => {
    expect(tenantQuotePath("glocast")).toBe("/quote/glocast");
  });

  it("builds the path for any other tenant slug", () => {
    expect(tenantQuotePath("shine-co")).toBe("/quote/shine-co");
    expect(tenantQuotePath("Detail Kings")).toBe("/quote/detail-kings");
  });

  it("never falls back to bare /quote", () => {
    for (const bad of [null, undefined, "", "  ", "/", "-", "a"]) {
      expect(tenantQuotePath(bad)).toBeNull();
    }
  });
});

describe("tenantQuoteUrl", () => {
  it("returns the absolute tenant URL", () => {
    expect(tenantQuoteUrl("https://bookedsecure.lovable.app", "glocast")).toBe(
      "https://bookedsecure.lovable.app/quote/glocast",
    );
  });

  it("ignores trailing slashes on the origin", () => {
    expect(tenantQuoteUrl("https://app.example.com/", "shine-co")).toBe(
      "https://app.example.com/quote/shine-co",
    );
  });

  it("never leaks another tenant's slug", () => {
    const url = tenantQuoteUrl("https://app.example.com", "shine-co");
    expect(url).not.toContain("glocast");
  });

  it("returns null without a usable origin or slug", () => {
    expect(tenantQuoteUrl("", "glocast")).toBeNull();
    expect(tenantQuoteUrl("https://app.example.com", null)).toBeNull();
  });
});

describe("tenantHeaderTitle", () => {
  it("uses the authenticated tenant name", () => {
    expect(tenantHeaderTitle("Glocast")).toBe("Glocast Lead Response");
    expect(tenantHeaderTitle("Shine Co")).toBe("Shine Co Lead Response");
  });

  it("falls back to a neutral label without hardcoding a tenant", () => {
    expect(tenantHeaderTitle(null)).toBe("Lead Response");
    expect(tenantHeaderTitle("   ")).toBe("Lead Response");
  });
});
