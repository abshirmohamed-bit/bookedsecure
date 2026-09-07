// Personal campaign links: every campaign text carries the contact's private
// token so the quote chat recognises them and never re-asks name, number or
// email. Tenant-neutral: the helper only joins a URL and a token.

import { describe, expect, it } from "vitest";
import { campaignQuoteUrl } from "@/lib/reactivation";

describe("campaignQuoteUrl", () => {
  it("appends the contact token to a plain quote link", () => {
    expect(campaignQuoteUrl("https://bookedsecure.lovable.app/quote/any-tenant", "tok-123")).toBe(
      "https://bookedsecure.lovable.app/quote/any-tenant?c=tok-123",
    );
  });

  it("uses & when the link already has parameters", () => {
    expect(campaignQuoteUrl("https://x.example/quote/t?utm=sms", "tok-9")).toBe(
      "https://x.example/quote/t?utm=sms&c=tok-9",
    );
  });

  it("returns the plain link when the contact has no token", () => {
    expect(campaignQuoteUrl("https://x.example/quote/t", null)).toBe("https://x.example/quote/t");
    expect(campaignQuoteUrl("https://x.example/quote/t", "  ")).toBe("https://x.example/quote/t");
  });

  it("returns null when the tenant has no quote link at all", () => {
    expect(campaignQuoteUrl(null, "tok-1")).toBeNull();
    expect(campaignQuoteUrl("", "tok-1")).toBeNull();
  });
});
