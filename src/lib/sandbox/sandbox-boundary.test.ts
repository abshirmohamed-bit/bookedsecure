// Source-level boundary proof: the sandbox cannot reach a live provider,
// a campaign activation, a booking writer, a job enqueuer, a production
// notification path, production counters or SMS usage.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FILES = [
  "src/lib/sandbox/adapters.ts",
  "src/lib/sandbox/runner.ts",
  "src/lib/sandbox/scenarios.ts",
  "src/lib/agent-templates.ts",
];

const sources = FILES.map((path) => [path, readFileSync(path, "utf8")] as const);

const FORBIDDEN = [
  // providers and clients
  "supabaseAdmin",
  "integrations/supabase",
  "telnyx",
  "twilio",
  "sinch",
  "provider.server",
  "getProvider",
  "fetch(",
  // send / queue / write paths
  "sendSms",
  "sendSlotOffer",
  "enqueueJob",
  "performJob",
  "commitWebChatBooking",
  "generateBookingOffers",
  "createNotification(",
  "recordDeliveryEvent",
  // activation, counters and usage
  "authoriseCampaign",
  "activateCampaign",
  "execution_authorised_at",
  "reserveSegments",
  "recordUsage",
  "usage.server",
  // raw persistence
  ".insert(",
  ".update(",
  ".upsert(",
  ".delete(",
  ".rpc(",
];

describe("sandbox provider and write boundary", () => {
  it("imports no provider, client, sender, writer or usage module", () => {
    for (const [path, source] of sources) {
      for (const forbidden of FORBIDDEN) {
        expect(source, `${path} must not contain ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("declares sandbox as its only execution mode", () => {
    const runner = sources.find(([p]) => p.endsWith("runner.ts"))![1];
    expect(runner).toContain("SANDBOX_EXECUTION_MODE");
    expect(runner).not.toContain('executionMode: "live"');
  });

  it("keeps the recorder incapable of sending", () => {
    const adapters = sources.find(([p]) => p.endsWith("adapters.ts"))![1];
    expect(adapters).toContain("canReachProvider: false");
    expect(adapters).toContain("canWriteBookings: false");
    expect(adapters).toContain("canReachProductionNotifications: false");
    expect(adapters).toContain("sent: false");
  });

  it("reuses production decision modules rather than reimplementing them", () => {
    const runner = sources.find(([p]) => p.endsWith("runner.ts"))![1];
    for (const shared of [
      "evaluateActivationGates",
      "evaluateQuietHoursGate",
      "planSequenceActions",
      "selectSequence",
      "renderAgentMessage",
      "assessOfferGeneration",
      "assessBookingConfirmation",
      "normaliseAgentAttribution",
    ]) {
      expect(runner).toContain(shared);
    }
  });
});
