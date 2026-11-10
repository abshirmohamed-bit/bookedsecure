import { describe, expect, it } from "vitest";
import { splitOwnerTranslation } from "./customer-language";

describe("replies in the customer's language", () => {
  it("separates the reply from the owner's English line", () => {
    expect(splitOwnerTranslation("شكراً لتواصلك! راسلنا للحصول على عرض سعر.\nEN: Thanks for reaching out! Message us for a quote.")).toEqual({
      reply: "شكراً لتواصلك! راسلنا للحصول على عرض سعر.",
      english: "Thanks for reaching out! Message us for a quote.",
    });
  });
  it("leaves English replies alone", () => {
    expect(splitOwnerTranslation("Thanks Sam, we'll be in touch.")).toEqual({ reply: "Thanks Sam, we'll be in touch.", english: null });
  });
});
