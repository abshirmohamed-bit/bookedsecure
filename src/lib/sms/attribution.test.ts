import { describe, expect, it } from "vitest";
import { proposeAttribution, summariseProposals, type AttributableMessage, type AttributionEvidence } from "./attribution";

const message = (overrides: Partial<AttributableMessage> = {}): AttributableMessage => ({
  id: "m1",
  business_id: "b1",
  lead_id: "l1",
  direction: "outbound",
  message_kind: "follow_up",
  message_source: null,
  idempotency_key: "l1:follow_up:1",
  ...overrides,
});

const evidence = (overrides: Partial<AttributionEvidence> = {}): AttributionEvidence => ({
  automationJobKeyMatches: 0,
  auditEventsNamingMessage: [],
  unlinkedManualSendAuditEvents: 0,
  importSendRecords: 0,
  ...overrides,
});

describe("proposeAttribution", () => {
  it("attributes automation from an exact automation job key match", () => {
    const result = proposeAttribution(message(), evidence({ automationJobKeyMatches: 1 }));
    expect(result.proposedSource).toBe("automation");
    expect(result.confidence).toBe("deterministic");
    expect(result.updateAllowed).toBe(true);
  });

  it("leaves follow-ups unattributed when no automation job exists", () => {
    const result = proposeAttribution(message(), evidence());
    expect(result.proposedSource).toBe("unknown");
    expect(result.updateAllowed).toBe(false);
  });

  it("attributes manual sends from the stored message kind", () => {
    const result = proposeAttribution(
      message({ message_kind: "manual", idempotency_key: null }),
      evidence({ auditEventsNamingMessage: [{ id: "a1", event_type: "sms_sent_manual" }] }),
    );
    expect(result.proposedSource).toBe("manual");
    expect(result.updateAllowed).toBe(true);
  });

  it("flags a conflict when two categories are both supported", () => {
    const result = proposeAttribution(
      message({ message_kind: "manual" }),
      evidence({ automationJobKeyMatches: 1 }),
    );
    expect(result.proposedSource).toBe("unknown");
    expect(result.conflict).toBe(true);
    expect(result.updateAllowed).toBe(false);
  });

  it("flags duplicate automation job matches as unresolved", () => {
    const result = proposeAttribution(message(), evidence({ automationJobKeyMatches: 2 }));
    expect(result.confidence).toBe("unresolved");
    expect(result.conflict).toBe(true);
  });

  it("never rewrites an existing attribution", () => {
    const result = proposeAttribution(message({ message_source: "quote_page" }), evidence({ automationJobKeyMatches: 1 }));
    expect(result.proposedSource).toBe("quote_page");
    expect(result.updateAllowed).toBe(false);
  });

  it("does not attribute inbound messages", () => {
    const result = proposeAttribution(message({ direction: "inbound", message_kind: "customer_reply" }), evidence());
    expect(result.proposedSource).toBe("unknown");
    expect(result.updateAllowed).toBe(false);
  });

  it("attributes import-originated sends", () => {
    const result = proposeAttribution(message({ message_kind: "acknowledgement" }), evidence({ importSendRecords: 1 }));
    expect(result.proposedSource).toBe("imported_historical");
    expect(result.updateAllowed).toBe(true);
  });

  it("is idempotent: re-running on an updated row proposes no further change", () => {
    const first = proposeAttribution(message(), evidence({ automationJobKeyMatches: 1 }));
    const second = proposeAttribution(
      message({ message_source: first.proposedSource }),
      evidence({ automationJobKeyMatches: 1 }),
    );
    expect(second.updateAllowed).toBe(false);
  });

  it("summarises proposals by category", () => {
    const summary = summariseProposals([
      proposeAttribution(message({ id: "a" }), evidence({ automationJobKeyMatches: 1 })),
      proposeAttribution(message({ id: "b", message_kind: "manual" }), evidence()),
      proposeAttribution(message({ id: "c" }), evidence()),
    ]);
    expect(summary.total).toBe(3);
    expect(summary.attributable).toBe(2);
    expect(summary.unattributed).toBe(1);
    expect(summary.byCategory.automation).toBe(1);
    expect(summary.byCategory.manual).toBe(1);
  });
});
