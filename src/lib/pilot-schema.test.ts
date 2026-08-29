import { describe, expect, it } from "vitest";
import { PILOT_STATUSES, PilotApplicationSchema, readAttribution } from "./pilot-schema";

const valid = {
  business_name: "Shine Detailing",
  contact_name: "Alex Smith",
  email: "alex@shine.com.au",
  phone: "0412 345 678",
};

describe("pilot application validation", () => {
  it("accepts a valid application", () => {
    const parsed = PilotApplicationSchema.parse(valid);
    expect(parsed.business_name).toBe("Shine Detailing");
    expect(parsed.utm_source).toBeNull();
  });

  it("requires business name, contact name, email and phone", () => {
    expect(() => PilotApplicationSchema.parse({ ...valid, business_name: "" })).toThrow();
    expect(() => PilotApplicationSchema.parse({ ...valid, contact_name: "" })).toThrow();
    expect(() => PilotApplicationSchema.parse({ ...valid, email: undefined })).toThrow();
    expect(() => PilotApplicationSchema.parse({ ...valid, phone: "" })).toThrow();
  });

  it("rejects invalid emails", () => {
    expect(() => PilotApplicationSchema.parse({ ...valid, email: "not-an-email" })).toThrow();
  });

  it("rejects oversized inputs", () => {
    expect(() => PilotApplicationSchema.parse({ ...valid, business_name: "x".repeat(200) })).toThrow();
    expect(() => PilotApplicationSchema.parse({ ...valid, services: "x".repeat(1000) })).toThrow();
  });

  it("strips arbitrary fields", () => {
    const parsed = PilotApplicationSchema.parse({ ...valid, status: "active", id: "abc" }) as Record<
      string,
      unknown
    >;
    expect(parsed['status']).toBeUndefined();
    expect(parsed['id']).toBeUndefined();
  });

  it("normalises empty optional values to null", () => {
    const parsed = PilotApplicationSchema.parse({ ...valid, location: "", utm_source: "  " });
    expect(parsed.location).toBeNull();
    expect(parsed.utm_source).toBeNull();
  });

  it("keeps pending as an allowed status and offers the four review states", () => {
    expect(PILOT_STATUSES).toEqual(["pending", "accepted", "rejected", "active"]);
  });
});

describe("attribution capture", () => {
  it("captures UTM values, referrer and landing page", () => {
    const attribution = readAttribution(
      "?utm_source=meta&utm_medium=cpc&utm_campaign=pilot&utm_term=detailing&utm_content=hero",
      "https://www.google.com/",
      "/landing",
    );
    expect(attribution).toEqual({
      utm_source: "meta",
      utm_medium: "cpc",
      utm_campaign: "pilot",
      utm_term: "detailing",
      utm_content: "hero",
      referrer: "https://www.google.com/",
      landing_page: "/landing",
    });
  });

  it("stores null rather than inventing missing values", () => {
    const attribution = readAttribution("", "", "/landing");
    expect(attribution.utm_source).toBeNull();
    expect(attribution.utm_medium).toBeNull();
    expect(attribution.referrer).toBeNull();
    expect(attribution.landing_page).toBe("/landing");
  });
});
