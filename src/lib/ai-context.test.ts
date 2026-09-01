import { describe, expect, it } from "vitest";
import {
  buildBusinessFacts,
  buildBusinessSettingsContext,
  buildServiceFacts,
} from "@/lib/ai-context";

const tenantA = {
  name: "Tenant A Detailing",
  service_area: "Inner West Sydney",
  timezone: "Australia/Sydney",
  opening_hours: "Mon-Sat 7am-5pm",
  quiet_hours_start: 20,
  quiet_hours_end: 8,
  sms_signature: "- Tenant A team",
  privacy_policy_url: "https://tenant-a.example/privacy",
};

const tenantB = {
  name: "Tenant B Mobile Wash",
  service_area: "Geelong",
  timezone: "Australia/Melbourne",
  opening_hours: null,
  quiet_hours_start: 21,
  quiet_hours_end: 7,
  sms_signature: null,
  privacy_policy_url: null,
};

describe("business settings AI context", () => {
  it("assembles the current tenant's persisted settings", () => {
    const context = buildBusinessSettingsContext(tenantA, [
      { name: "Full Detail", description: "Interior and exterior", price_guidance: "from $250" },
    ]);
    expect(context).toContain("Tenant A Detailing");
    expect(context).toContain("Inner West Sydney");
    expect(context).toContain("Australia/Sydney");
    expect(context).toContain("Mon-Sat 7am-5pm");
    expect(context).toContain("20:00 to 8:00");
    expect(context).toContain("- Tenant A team");
  });

  it("reads approved services and price guidance from the correct tenant", () => {
    const a = buildBusinessSettingsContext(tenantA, [
      { name: "Full Detail", price_guidance: "from $250" },
    ]);
    const b = buildBusinessSettingsContext(tenantB, [
      { name: "Express Wash", price_guidance: "from $90" },
    ]);
    expect(a).toContain("Full Detail");
    expect(a).toContain("from $250");
    expect(a).not.toContain("Express Wash");
    expect(a).not.toContain("from $90");
    expect(b).toContain("Express Wash");
    expect(b).not.toContain("Full Detail");
    expect(b).not.toContain("Tenant A Detailing");
  });

  it("reflects a changed business setting in newly assembled context", () => {
    const before = buildBusinessSettingsContext(tenantA, []);
    const after = buildBusinessSettingsContext(
      { ...tenantA, service_area: "Northern Beaches" },
      [],
    );
    expect(before).toContain("Inner West Sydney");
    expect(after).toContain("Northern Beaches");
    expect(after).not.toContain("Inner West Sydney");
  });

  it("omits missing optional settings instead of fabricating values", () => {
    const facts = buildBusinessFacts({
      name: "Bare Tenant",
      service_area: null,
      timezone: "",
      opening_hours: "   ",
      quiet_hours_start: null,
      quiet_hours_end: null,
    });
    expect(facts).toEqual(["Business name: Bare Tenant"]);
    const context = buildBusinessSettingsContext({ name: "Bare Tenant" }, []);
    expect(context).toContain("No services configured yet.");
    expect(context).not.toMatch(/Opening hours|Service area|Quiet hours|Privacy policy/);
  });

  it("omits missing service fields and marks price guidance as internal context", () => {
    const [line] = buildServiceFacts([
      { name: "Interior Detail", description: null, price_guidance: "quote on inspection" },
    ]);
    expect(line).toBe(
      "- Interior Detail | Price guidance (internal context only, never quote it): quote on inspection",
    );
    expect(buildServiceFacts([{ name: "Wash" }])[0]).toBe("- Wash");
  });

  it("contains no hard-coded tenant name or stale defaults", () => {
    const context = buildBusinessSettingsContext({ name: "Anon Detailing" }, []);
    expect(context).not.toMatch(/Glocast/i);
  });
});
