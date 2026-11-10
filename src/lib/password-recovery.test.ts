import { describe, expect, it } from "vitest";
import { readRecoveryLink } from "./password-recovery";

describe("readRecoveryLink", () => {
  it("accepts a recovery link from the password-reset email", () => {
    expect(readRecoveryLink("#type=recovery&access_token=abc&refresh_token=def")).toBe("recovery");
  });

  it("rejects other auth links that land on the same page", () => {
    expect(readRecoveryLink("#type=invite&access_token=abc")).toBe("none");
    expect(readRecoveryLink("#access_token=abc&refresh_token=def")).toBe("none");
  });

  it("accepts a one-time code from a PKCE style link", () => {
    expect(readRecoveryLink("?code=xyz123&state=456")).toBe("code");
  });

  it("says nothing is there for a plain visit", () => {
    expect(readRecoveryLink("")).toBe("none");
    expect(readRecoveryLink("#")).toBe("none");
  });
});
