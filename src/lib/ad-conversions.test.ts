import { describe, expect, it } from "vitest";
import { ADS_CONVERSIONS, adsConversionFor, trackAdsConversion } from "@/lib/ad-conversions";

describe("ad conversions", () => {
  it("is configured for glocast only", () => {
    expect(Object.keys(ADS_CONVERSIONS)).toEqual(["glocast"]);
    expect(adsConversionFor("glocast")?.sendTo).toBe("AW-11365020535/KetSCOT8qaAdEPfmoasq");
  });

  it("returns nothing for other or missing tenants", () => {
    expect(adsConversionFor("other-tenant")).toBeNull();
    expect(adsConversionFor("")).toBeNull();
    expect(adsConversionFor(null)).toBeNull();
    expect(adsConversionFor("__proto__")).toBeNull();
    expect(adsConversionFor("toString")).toBeNull();
  });

  it("never throws without a browser", () => {
    expect(() => trackAdsConversion("glocast", "abc")).not.toThrow();
    expect(() => trackAdsConversion("other-tenant", "abc")).not.toThrow();
  });
});
