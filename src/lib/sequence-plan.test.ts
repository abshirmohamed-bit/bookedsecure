import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const planner = readFileSync("src/lib/sequence-plan.server.ts", "utf8");

describe("server-side sequence planner boundary", () => {
  it("never writes, sends, enqueues or books", () => {
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".delete(",
      ".upsert(",
      ".rpc(",
      "sendSms",
      "enqueueJob",
      "createNotification",
      "sendSlotOffer",
      "commitWebChatBooking",
      "fetch(",
      "current_sequence",
    ]) {
      expect(planner).not.toContain(forbidden);
    }
  });

  it("reads tenant state through existing loaders rather than reimplementing them", () => {
    expect(planner).toContain("loadAvailabilityConfig");
    expect(planner).toContain("loadServiceDurationMinutes");
    expect(planner).toContain("evaluateQuietHoursGate");
    expect(planner).toContain("selectSequence");
    expect(planner).toContain("planSequenceActions");
  });

  it("scopes every lead read to the tenant", () => {
    expect(planner).toContain('.eq("business_id", input.businessId)');
  });

  it("stays dry-run: the plan carries no live mode branch", () => {
    expect(planner).not.toContain('"live"');
    expect(planner).not.toContain("wouldSend: true");
  });
});
