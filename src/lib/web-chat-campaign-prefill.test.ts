// Returning-contact prefill: a contact arriving via their campaign link must
// never be re-asked for the name, mobile or email we already hold — the
// campaign could not have been sent without them. Pure: no I/O.

import { describe, expect, it } from "vitest";
import { campaignPrefill, nextStep } from "@/lib/web-chat";

describe("campaignPrefill", () => {
  it("prefills name, mobile and email from the contact's own record", () => {
    const prefill = campaignPrefill({
      name: "Diana",
      mobile_number: "+61403620659",
      email: "diana@example.com",
    });
    expect(prefill).toEqual({
      name: "Diana",
      mobile_number: "+61403620659",
      email: "diana@example.com",
    });
  });

  it("treats a missing email as answered (not provided) so the step is skipped", () => {
    const prefill = campaignPrefill({ name: "Diana", mobile_number: "+61403620659", email: null });
    expect(prefill?.email).toBeNull();
  });

  it("never prefills a placeholder name, so the name step still runs", () => {
    const prefill = campaignPrefill({ name: "Web Visitor", mobile_number: "+61403620659", email: null });
    expect(prefill?.name).toBeNull();
  });

  it("refuses to prefill anything without a mobile number", () => {
    expect(campaignPrefill({ name: "Diana", mobile_number: null, email: "d@x.com" })).toBeNull();
    expect(campaignPrefill({ name: "Diana", mobile_number: "  ", email: "d@x.com" })).toBeNull();
  });
});

describe("nextStep with a prefilled returning contact", () => {
  const base = {
    service_id: "svc-1",
    vehicle_type: "Mazda 3",
    suburb: "Auburn",
    service_address: "12 Smith St",
    concerns: "pet hair",
  };

  it("skips name, mobile and email and goes straight to the review", () => {
    const collected = {
      ...base,
      name: "Diana",
      mobile_number: "+61403620659",
      email: "diana@example.com",
    };
    expect(nextStep(collected)).toBe("review");
  });

  it("still asks for a real name when only a placeholder was on file", () => {
    const collected = {
      ...base,
      name: null,
      mobile_number: "+61403620659",
      email: null,
    };
    expect(nextStep(collected)).toBe("name");
  });

  it("asks for mobile when nothing usable is on file", () => {
    const collected = { ...base, name: "Diana", email: null };
    expect(nextStep(collected)).toBe("mobile");
  });
});
