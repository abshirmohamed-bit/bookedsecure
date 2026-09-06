import { describe, expect, it } from "vitest";
import {
  formatOwnerNotificationNumber,
  isValidOwnerNotificationNumber,
  maskOwnerNotificationNumber,
  normaliseOwnerNotificationNumber,
  validateOwnerNotificationNumber,
} from "@/lib/owner-phone";
import {
  evaluateOwnerNotificationEligibility,
  resolveOwnerNotificationNumber,
} from "@/lib/owner-notification";

describe("owner notification number normalisation", () => {
  it("accepts Australian mobiles in every common format", () => {
    for (const input of [
      "+61447852565",
      "+61 447 852 565",
      "0447852565",
      "0447 852 565",
      "0447-852-565",
      "61447852565",
    ]) {
      expect(normaliseOwnerNotificationNumber(input)).toBe("+61447852565");
    }
  });

  it("rejects landlines and malformed numbers", () => {
    for (const input of [
      "+61298765432", // Sydney landline
      "0298765432",
      "+61 3 9876 5432",
      "0712345678",
      "0812345678",
      "044785256", // too short
      "04478525650", // too long
      "not a number",
      "",
      null,
      undefined,
    ]) {
      expect(normaliseOwnerNotificationNumber(input as string | null)).toBeNull();
      expect(isValidOwnerNotificationNumber(input as string | null)).toBe(false);
    }
  });

  it("explains rejection in owner-facing language", () => {
    expect(validateOwnerNotificationNumber("0298765432")).toEqual({
      ok: false,
      reason:
        "That is not a valid Australian mobile number. Use a format like 0447 852 565 or +61 447 852 565.",
    });
    expect(validateOwnerNotificationNumber("   ").ok).toBe(false);
    expect(validateOwnerNotificationNumber("0447852565")).toEqual({
      ok: true,
      e164: "+61447852565",
    });
  });

  it("masks and formats for display", () => {
    expect(maskOwnerNotificationNumber("0447852565")).toBe("+61 4•• ••• 565");
    expect(maskOwnerNotificationNumber(null)).toBe("Not set");
    expect(maskOwnerNotificationNumber("0298765432")).toBe("Not set");
    expect(formatOwnerNotificationNumber("+61447852565")).toBe("+61 447 852 565");
    expect(formatOwnerNotificationNumber("bad")).toBe("");
  });
});

describe("owner notification eligibility uses the mobile-only rule", () => {
  const bookedFacts = { offerStatus: "confirmed" as const, jobId: "job-1" };

  it("resolves a stored mobile and rejects a stored landline", () => {
    expect(resolveOwnerNotificationNumber({ owner_notification_number: "0447852565" })).toBe(
      "+61447852565",
    );
    expect(resolveOwnerNotificationNumber({ owner_notification_number: "0298765432" })).toBeNull();
    expect(resolveOwnerNotificationNumber({ owner_notification_number: "" })).toBeNull();
    expect(resolveOwnerNotificationNumber(null)).toBeNull();
  });

  it("blocks the owner alert when the stored number is a landline", () => {
    const decision = evaluateOwnerNotificationEligibility({
      ...bookedFacts,
      ownerNotificationNumber: "0298765432",
    } as never);
    expect(decision.sendable).toBe(false);
    expect(decision.outcome).toBe("blocked_invalid_owner_number");
  });

  it("stays eligible for a valid mobile", () => {
    const decision = evaluateOwnerNotificationEligibility({
      ...bookedFacts,
      ownerNotificationNumber: "+61447852565",
    } as never);
    expect(decision).toEqual({ outcome: "eligible", sendable: true, reason: "Eligible to send." });
  });
});
