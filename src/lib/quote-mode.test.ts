import { describe, expect, it } from "vitest";
import { DEFAULT_QUOTE_MODE, isQuoteMode, resolveQuoteMode } from "@/lib/quote-mode";

describe("quote mode", () => {
  it("defaults to the manual form", () => {
    expect(DEFAULT_QUOTE_MODE).toBe("manual_sms");
  });

  it("never fails open into AI mode", () => {
    for (const value of [null, undefined, "", "ai", "AI_CHAT", 1, {}, "manual"]) {
      expect(resolveQuoteMode(value)).toBe("manual_sms");
    }
  });

  it("accepts the two supported modes verbatim", () => {
    expect(resolveQuoteMode("manual_sms")).toBe("manual_sms");
    expect(resolveQuoteMode("ai_chat")).toBe("ai_chat");
    expect(isQuoteMode("ai_chat")).toBe(true);
    expect(isQuoteMode("something")).toBe(false);
  });
});
