import { describe, expect, it } from "vitest";
import {
  ACKNOWLEDGEMENT_TEMPLATE,
  requestsPhoto,
  resolveAcknowledgementTemplate,
} from "@/lib/acknowledgement-contract";
import { firstName, renderTemplate } from "@/lib/domain";

const EXPECTED =
  "Hi Usamah, thanks for contacting Glocast. We've received your service enquiry. Reply with the type of item and your main concern so we can help. Reply STOP to opt out.";

describe("acknowledgement contract", () => {
  it("renders the exact live acknowledgement text", () => {
    const body = renderTemplate(ACKNOWLEDGEMENT_TEMPLATE, {
      first_name: firstName("Usamah Ahmed"),
      business_name: "Glocast",
    });
    expect(body).toBe(EXPECTED);
  });

  it("interpolates the first name with the existing helpers", () => {
    const body = renderTemplate(ACKNOWLEDGEMENT_TEMPLATE, {
      first_name: firstName("  Jane  Doe "),
      business_name: "Glocast",
    });
    expect(body.startsWith("Hi Jane,")).toBe(true);
  });

  it("does not request a photo", () => {
    expect(requestsPhoto(ACKNOWLEDGEMENT_TEMPLATE)).toBe(false);
    expect(requestsPhoto(EXPECTED)).toBe(false);
  });

  it("includes the STOP opt-out line", () => {
    expect(ACKNOWLEDGEMENT_TEMPLATE).toContain("Reply STOP to opt out.");
  });

  it("uses the stored template when it matches the frozen contract", () => {
    const result = resolveAcknowledgementTemplate(ACKNOWLEDGEMENT_TEMPLATE);
    expect(result).toEqual({ template: ACKNOWLEDGEMENT_TEMPLATE, enforced: false });
  });

  it("falls back to the frozen contract when no rule is active", () => {
    expect(resolveAcknowledgementTemplate(null)).toEqual({
      template: ACKNOWLEDGEMENT_TEMPLATE,
      enforced: false,
    });
    expect(resolveAcknowledgementTemplate(undefined).template).toBe(ACKNOWLEDGEMENT_TEMPLATE);
  });

  it("does not let an edited stored template silently override the contract", () => {
    const drifted = resolveAcknowledgementTemplate(
      "Hi {{first_name}}, send a photo of your car and we'll book you in tomorrow.",
    );
    expect(drifted.template).toBe(ACKNOWLEDGEMENT_TEMPLATE);
    expect(drifted.enforced).toBe(true);
    expect(requestsPhoto(drifted.template)).toBe(false);
  });

  it("detects photo requests in drifted templates", () => {
    expect(requestsPhoto("Please send photos of the interior")).toBe(true);
  });
});
