import { describe, expect, it } from "vitest";
import {
  describeMissingIdentityFields,
  emptyIdentity,
  formatAbn,
  isIdentityComplete,
  missingIdentityFields,
  normaliseAbn,
} from "@/lib/tenant-identity";

function completeIdentity() {
  return {
    ...emptyIdentity(),
    legalName: "Example Pty Ltd",
    abn: "20 284 379 143",
    addressLine1: "1 Example Street",
    suburb: "Sydney",
    state: "NSW",
    postcode: "2000",
    contactName: "Owner Name",
    contactEmail: "owner@example.com.au",
    contactPhone: "+61 400 000 000",
    messageTypes: ["Booking confirmations and reminders"],
    declarationAcceptedAt: new Date().toISOString(),
  };
}

describe("business identity completeness", () => {
  it("treats a missing record as entirely outstanding", () => {
    expect(missingIdentityFields(null).length).toBeGreaterThan(5);
    expect(isIdentityComplete(null)).toBe(false);
  });

  it("accepts a fully filled record with a spaced ABN", () => {
    expect(missingIdentityFields(completeIdentity())).toEqual([]);
  });

  it("rejects an ABN that is not eleven digits", () => {
    expect(missingIdentityFields({ ...completeIdentity(), abn: "2028437914" })).toContain("abn");
  });

  it("requires the declaration, a message type, a postcode and a valid email", () => {
    const identity = {
      ...completeIdentity(),
      declarationAcceptedAt: null,
      messageTypes: [],
      postcode: "20",
      contactEmail: "not-an-email",
    };
    const missing = missingIdentityFields(identity);
    expect(missing).toEqual(
      expect.arrayContaining(["declaration", "messageTypes", "postcode", "contactEmail"]),
    );
  });

  it("describes what is outstanding in plain words", () => {
    expect(describeMissingIdentityFields(["abn", "postcode"])).toBe("ABN and Postcode");
    expect(describeMissingIdentityFields(["abn"])).toBe("ABN");
  });

  it("normalises and formats ABNs", () => {
    expect(normaliseAbn("20 284 379 143")).toBe("20284379143");
    expect(formatAbn("20284379143")).toBe("20 284 379 143");
  });
});
