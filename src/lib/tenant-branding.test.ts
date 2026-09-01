import { describe, expect, it } from "vitest";
import { brandInitial, sanitiseLogoUrl } from "@/lib/tenant-branding";

describe("sanitiseLogoUrl", () => {
  it("accepts https URLs", () => {
    expect(sanitiseLogoUrl("https://cdn.example.com/logo.png")).toBe(
      "https://cdn.example.com/logo.png",
    );
  });

  it("accepts same-origin absolute paths", () => {
    expect(sanitiseLogoUrl("/__l5e/assets-v1/abc/logo.png")).toBe("/__l5e/assets-v1/abc/logo.png");
  });

  it("rejects unsafe or unusable values", () => {
    for (const value of [
      null,
      undefined,
      "",
      "   ",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "http://cdn.example.com/logo.png",
      "//cdn.example.com/logo.png",
      "logo.png",
      `https://cdn.example.com/${"a".repeat(600)}.png`,
    ]) {
      expect(sanitiseLogoUrl(value as string | null | undefined)).toBeNull();
    }
  });
});

describe("brandInitial", () => {
  it("uses the first letter of the tenant name", () => {
    expect(brandInitial("Glocast")).toBe("G");
    expect(brandInitial("  detail co")).toBe("D");
  });

  it("falls back when no name is available", () => {
    expect(brandInitial("")).toBe("?");
    expect(brandInitial(null)).toBe("?");
  });
});
