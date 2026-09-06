import { describe, expect, it } from "vitest";
import {
  containsDisallowedDash,
  sanitiseCustomerLines,
  sanitiseCustomerText,
} from "@/lib/customer-text";
import { promptFor } from "@/lib/web-chat";
import { cleanDisplayText } from "@/lib/web-chat-presentation";

describe("sanitiseCustomerText", () => {
  it("replaces an em dash used as punctuation with a sentence break", () => {
    expect(sanitiseCustomerText("Thanks — we'll be in touch soon.")).toBe(
      "Thanks. We'll be in touch soon.",
    );
  });

  it("replaces an en dash used as punctuation", () => {
    expect(sanitiseCustomerText("All good – see you Tuesday")).toBe("All good. See you Tuesday");
  });

  it("replaces double hyphens used as punctuation", () => {
    expect(sanitiseCustomerText("Booked in -- Tuesday at 11am")).toBe("Booked in. Tuesday at 11am");
  });

  it("keeps hyphens inside ordinary words", () => {
    for (const text of [
      "We'll send a follow-up message.",
      "Sydney-based mobile detailing.",
      "Pet hair and odour treatment is a add-on.",
      "Customer-facing copy stays intact.",
    ]) {
      expect(sanitiseCustomerText(text)).toBe(text);
    }
  });

  it("keeps numeric ranges readable", () => {
    expect(sanitiseCustomerText("Takes 2–3 hours")).toBe("Takes 2-3 hours");
  });

  it("never rewrites links, emails, phone numbers or ids", () => {
    for (const text of [
      "See https://bookedsecure.lovable.app/quote/glocast--test for details",
      "Email us at support--team@example.com",
      "Call +61 468 045 220 to change your booking",
      "Ref 8f1a2c34-5b6d-4e7f-8a9b-0c1d2e3f4a5b",
      "tenant_owner_booking_confirmation:{booking_id}",
      '{"service_name":"Full Interior Detail"}',
    ]) {
      expect(sanitiseCustomerText(text)).toBe(text);
    }
  });

  it("does not double up punctuation already present", () => {
    expect(sanitiseCustomerText("Confirmed, — Tuesday works")).toBe("Confirmed, Tuesday works");
    expect(sanitiseCustomerText("Thanks —")).toBe("Thanks.");
  });

  it("is idempotent and safe on empty input", () => {
    const once = sanitiseCustomerText("Great — thanks");
    expect(sanitiseCustomerText(once)).toBe(once);
    expect(sanitiseCustomerText("")).toBe("");
  });

  it("handles multi-line copy line by line", () => {
    expect(sanitiseCustomerText("Line one — done\nLine two – done")).toBe(
      "Line one. Done\nLine two. Done",
    );
  });

  it("detects disallowed dashes outside protected tokens only", () => {
    expect(containsDisallowedDash("Hi — there")).toBe(true);
    expect(containsDisallowedDash("follow-up call")).toBe(false);
    expect(containsDisallowedDash("https://example.com/a--b")).toBe(false);
  });

  it("sanitises lists of lines", () => {
    expect(sanitiseCustomerLines(["A — b", "c-d"])).toEqual(["A. B", "c-d"]);
  });
});

describe("customer-facing boundaries apply the sanitizer", () => {
  const tenant = {
    name: "Glocast",
    services: [
      { id: "s1", name: "Full Interior Detail — deep clean", description: null } as never,
    ],
    flexibleRequestsEnabled: false,
  } as never;

  it("cleans quote chat prompts", () => {
    const prompt = promptFor("vehicle", tenant, {});
    expect(containsDisallowedDash(prompt.text)).toBe(false);
    for (const option of prompt.options ?? []) {
      expect(containsDisallowedDash(option.label)).toBe(false);
    }
  });

  it("cleans tenant text rendered on service cards", () => {
    expect(cleanDisplayText("Includes: seats — carpets")).toBe("Includes: seats. Carpets");
    expect(cleanDisplayText("follow-up wash")).toBe("follow-up wash");
  });
});
