import { describe, expect, it } from "vitest";
import {
  AUTOMATION_BLOCKED_STATUSES,
  AUTOMATION_STOP_STATUSES,
  businessLocalHour,
  isOptOutMessage,
  isQuietHour,
  normaliseAuMobile,
  renderTemplate,
  stopsAutomation,
} from "./domain";
import { countSegments } from "./sms/segments";

describe("follow-up stop rules", () => {
  it("stops follow-ups once the contact replies", () => {
    expect(stopsAutomation("customer_replied")).toBe(true);
    expect(AUTOMATION_STOP_STATUSES).toContain("customer_replied");
  });

  it("stops follow-ups after an opt-out", () => {
    expect(stopsAutomation("contacted", "2026-08-25T01:00:00Z")).toBe(true);
    expect(stopsAutomation("opted_out")).toBe(true);
  });

  it("keeps sending while the lead is still waiting", () => {
    expect(stopsAutomation("new")).toBe(false);
    expect(stopsAutomation("contacted")).toBe(false);
    expect(stopsAutomation("waiting_for_customer")).toBe(false);
  });

  it("never sends automated SMS to blocked statuses", () => {
    expect(AUTOMATION_BLOCKED_STATUSES).toEqual(["opted_out", "invalid", "completed", "lost"]);
  });
});

describe("STOP handling", () => {
  it("recognises common unsubscribe keywords", () => {
    for (const word of ["STOP", "stop", " Stop! ", "unsubscribe", "CANCEL", "quit", "opt out"]) {
      expect(isOptOutMessage(word)).toBe(true);
    }
  });

  it("does not treat normal replies as opt-outs", () => {
    expect(isOptOutMessage("Yes please, Sedan in Bondi")).toBe(false);
    expect(isOptOutMessage("stop by tomorrow at 9")).toBe(false);
  });
});

describe("quiet hours", () => {
  it("respects a window that wraps midnight (20:00-08:00)", () => {
    expect(isQuietHour(21, 20, 8)).toBe(true);
    expect(isQuietHour(2, 20, 8)).toBe(true);
    expect(isQuietHour(8, 20, 8)).toBe(false);
    expect(isQuietHour(13, 20, 8)).toBe(false);
  });

  it("respects a same-day window and an empty window", () => {
    expect(isQuietHour(13, 12, 14)).toBe(true);
    expect(isQuietHour(15, 12, 14)).toBe(false);
    expect(isQuietHour(3, 9, 9)).toBe(false);
  });

  it("evaluates the hour in the tenant timezone", () => {
    const at = new Date("2026-08-25T13:00:00Z"); // 23:00 Sydney
    expect(businessLocalHour("Australia/Sydney", at)).toBe(23);
    expect(isQuietHour(businessLocalHour("Australia/Sydney", at), 20, 8)).toBe(true);
  });
});

describe("tenant number mapping inputs", () => {
  it("normalizes AU mobiles to E.164 so webhook lookups match", () => {
    expect(normaliseAuMobile("0412 345 678")).toBe("+61412345678");
    expect(normaliseAuMobile("+61 412 345 678")).toBe("+61412345678");
    expect(normaliseAuMobile("61412345678")).toBe("+61412345678");
    expect(normaliseAuMobile("12345")).toBeNull();
  });
});

describe("usage tracking", () => {
  it("counts GSM-7 segments", () => {
    expect(countSegments("Hi").segments).toBe(1);
    expect(countSegments("a".repeat(160)).segments).toBe(1);
    expect(countSegments("a".repeat(161)).segments).toBe(2);
  });

  it("counts unicode messages as UCS-2", () => {
    expect(countSegments("😀".repeat(40)).segments).toBeGreaterThan(1);
  });
});

describe("message templating", () => {
  it("fills tenant-specific variables", () => {
    expect(
      renderTemplate("Hi {{first_name}}, {{business_name}} here.", {
        first_name: "Sam",
        business_name: "Glocast",
      }),
    ).toBe("Hi Sam, Glocast here.");
  });
});
