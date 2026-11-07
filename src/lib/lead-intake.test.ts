import { describe, expect, it } from "vitest";
import { flattenIntakePayload, mapSourceChannel, normaliseIntakePayload } from "./lead-intake";

function ok(body: unknown) {
  const result = normaliseIntakePayload(body);
  if (!result.ok) throw new Error(result.error);
  return result.lead;
}

describe("lead intake normaliser", () => {
  it("keeps the existing BookedSecure payload shape working", () => {
    const lead = ok({
      name: "Jo Smith",
      mobile_number: "0412 345 678",
      email: "jo@example.com",
      suburb: "Parramatta",
      source_channel: "meta",
      consent: true,
      external_id: "lead-1",
    });
    expect(lead).toMatchObject({
      name: "Jo Smith",
      mobile_number: "0412 345 678",
      email: "jo@example.com",
      suburb: "Parramatta",
      source_channel: "meta",
      consent: true,
      external_id: "lead-1",
    });
  });

  it("accepts Meta field names forwarded straight from Make", () => {
    const lead = ok({
      full_name: "Ghina H",
      phone_number: "+61403000000",
      email: "g@x.com",
      source: "Facebook Lead Ads",
    });
    expect(lead.name).toBe("Ghina H");
    expect(lead.mobile_number).toBe("+61403000000");
    expect(lead.source_channel).toBe("meta");
  });

  it("reads a raw Meta field_data lead including its id and custom questions", () => {
    const lead = ok({
      id: "1234567890",
      form_id: "form-9",
      field_data: [
        { name: "full_name", values: ["Sam D"] },
        { name: "phone_number", values: ["+61414000000"] },
        { name: "What type of vehicle do you have?", values: ["SUV"] },
        { name: "suburb", values: ["Blacktown"] },
      ],
    });
    expect(lead.external_id).toBe("1234567890");
    expect(lead.source_channel).toBe("meta");
    expect(lead.suburb).toBe("Blacktown");
    expect(lead.main_concerns).toContain("what type of vehicle do you have: SUV");
  });

  it("joins first and last names", () => {
    expect(ok({ first_name: "Vicki", last_name: "Phillips", phone: "0413000000" }).name).toBe(
      "Vicki Phillips",
    );
  });

  it("trims over-long answers instead of rejecting the lead", () => {
    const lead = ok({
      name: "A".repeat(200),
      mobile_number: "0412345678",
      main_concerns: "x".repeat(900),
      vehicle_type: "v".repeat(100),
    });
    expect(lead.name).toHaveLength(80);
    expect(lead.main_concerns).toHaveLength(500);
    expect(lead.vehicle_type).toHaveLength(60);
  });

  it("drops an invalid email instead of rejecting the lead", () => {
    expect(ok({ name: "Jo", mobile_number: "0412345678", email: "not-an-email" }).email).toBeNull();
  });

  it("falls back to a placeholder name when none is supplied", () => {
    expect(ok({ phone_number: "0412345678" }).name).toBe("New enquiry");
  });

  it("rejects only when there is no usable phone number", () => {
    expect(normaliseIntakePayload({ name: "Jo" }).ok).toBe(false);
    expect(
      normaliseIntakePayload({
        name: "Jo",
        phone_number: "<test lead: dummy data for phone_number>",
      }).ok,
    ).toBe(false);
    expect(normaliseIntakePayload(null).ok).toBe(false);
    expect(normaliseIntakePayload([1, 2]).ok).toBe(false);
  });

  it("parses consent strings", () => {
    expect(ok({ phone: "0412345678", consent: "Yes" }).consent).toBe(true);
    expect(ok({ phone: "0412345678", consent: "no" }).consent).toBe(false);
  });

  it("reads a business slug from the body", () => {
    expect(ok({ phone: "0412345678", business: "glocast" }).business_slug).toBe("glocast");
  });

  it("does not treat a generic id as a Meta lead id without field_data", () => {
    expect(flattenIntakePayload({ id: "7", phone: "0412345678" }).has("leadgen_id")).toBe(false);
    expect(ok({ id: "7", phone: "0412345678" }).external_id).toBeNull();
  });
});

describe("source channel mapping", () => {
  it("keeps website as the default unless the payload looks like Meta", () => {
    expect(mapSourceChannel(null)).toBe("website");
    expect(mapSourceChannel(null, true)).toBe("meta");
  });
  it("maps common Meta spellings", () => {
    for (const value of ["facebook", "Instagram", "fb", "ig", "Facebook Lead Ads", "paid_social"]) {
      expect(mapSourceChannel(value)).toBe("meta");
    }
  });
  it("keeps known channels and marks others unknown", () => {
    expect(mapSourceChannel("hosted_page")).toBe("hosted_page");
    expect(mapSourceChannel("google")).toBe("unknown");
  });
});
