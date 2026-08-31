import { describe, expect, it, vi } from "vitest";
import {
  classifyDeliveryFailure,
  decideTransition,
  deliveryLabel,
  isPendingStatus,
  isTerminal,
  matchesSmsFilter,
  summariseDelivery,
} from "./delivery";
import { applyDeliveryEvent } from "./delivery.server";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";

const BUSINESS = "b-1";
const OTHER_BUSINESS = "b-2";

function seed(overrides: Record<string, unknown> = {}): FakeDb {
  return {
    messages: [
      {
        id: "m-1",
        business_id: BUSINESS,
        lead_id: "l-1",
        conversation_id: "c-1",
        direction: "outbound",
        delivery_status: "provider_accepted",
        provider: "telnyx",
        provider_message_id: "pmsg_1",
        delivery_event_count: 0,
        last_provider_event_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        message_source: "quote_page",
        ...overrides,
      },
    ],
    leads: [
      { id: "l-1", business_id: BUSINESS, status: "contacted", sms_suppressed_at: null },
    ],
    conversations: [
      { id: "c-1", business_id: BUSINESS, lead_id: "l-1", automation_paused: false, next_follow_up_at: "2026-01-02T00:00:00.000Z" },
    ],
    automation_jobs: [
      { id: "j-1", lead_id: "l-1", status: "pending", job_type: "follow_up", next_attempt_at: "2026-01-02T00:00:00.000Z" },
    ],
    audit_events: [],
    jobs: [],
  };
}

function event(overrides: Partial<Parameters<typeof applyDeliveryEvent>[0]> = {}) {
  return {
    providerName: "telnyx",
    businessId: BUSINESS,
    providerMessageId: "pmsg_1",
    status: "delivered" as const,
    rawStatus: "delivered",
    eventId: "evt_1",
    occurredAt: "2026-01-01T01:00:00.000Z",
    ...overrides,
  };
}

describe("delivery state model", () => {
  it("treats only delivered/failed/undelivered as terminal", () => {
    expect(isTerminal("delivered")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("undelivered")).toBe(true);
    expect(isTerminal("provider_accepted")).toBe(false);
    expect(isPendingStatus("provider_accepted")).toBe(true);
    expect(isPendingStatus("delivered")).toBe(false);
  });

  it("allows only forward transitions", () => {
    expect(decideTransition("queued", "provider_accepted").apply).toBe(true);
    expect(decideTransition("provider_accepted", "sent").apply).toBe(true);
    expect(decideTransition("provider_accepted", "delivered").apply).toBe(true);
    expect(decideTransition("provider_accepted", "failed").apply).toBe(true);
    expect(decideTransition("provider_accepted", "undelivered").apply).toBe(true);
    expect(decideTransition("sent", "delivered").apply).toBe(true);
  });

  it("never downgrades a terminal state (9, 10)", () => {
    expect(decideTransition("delivered", "sent")).toEqual({ apply: false, reason: "terminal_state" });
    expect(decideTransition("delivered", "queued")).toEqual({ apply: false, reason: "terminal_state" });
    expect(decideTransition("failed", "delivered")).toEqual({ apply: false, reason: "terminal_state" });
    expect(decideTransition("undelivered", "sent")).toEqual({ apply: false, reason: "terminal_state" });
    expect(decideTransition("sent", "provider_accepted")).toEqual({ apply: false, reason: "not_forward" });
  });

  it("labels statuses without implying delivery", () => {
    expect(deliveryLabel("provider_accepted")).toBe("Accepted by provider");
    expect(deliveryLabel("unknown")).toBe("Awaiting confirmation");
    expect(deliveryLabel(null)).toBe("No SMS yet");
  });
});

describe("failure classification", () => {
  it("classifies documented permanent recipient codes", () => {
    for (const code of ["40001", "40003", "40012", "40310", "40309"]) {
      const result = classifyDeliveryFailure({ code });
      expect(result.failureClass).toBe("permanent");
      expect(result.suppressLead).toBe(true);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it("treats a STOP rejection as permanent plus opt-out", () => {
    const result = classifyDeliveryFailure({ code: "40300" });
    expect(result.failureClass).toBe("permanent");
    expect(result.optOut).toBe(true);
  });

  it("classifies documented temporary codes without suppressing", () => {
    for (const code of ["40006", "40008", "40011", "40320"]) {
      const result = classifyDeliveryFailure({ code });
      expect(result.failureClass).toBe("temporary");
      expect(result.suppressLead).toBe(false);
    }
  });

  it("classifies sender configuration problems separately", () => {
    const result = classifyDeliveryFailure({ code: "40305" });
    expect(result.failureClass).toBe("configuration");
    expect(result.suppressLead).toBe(false);
  });

  it("never assumes a dead number without a reliable code", () => {
    const result = classifyDeliveryFailure({ code: null, detail: "carrier said no" });
    expect(result.failureClass).toBe("unknown");
    expect(result.suppressLead).toBe(false);
  });
});

describe("applyDeliveryEvent", () => {
  it("applies a verified delivered receipt (3)", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(event(), { client });
    expect(result.applied).toBe(true);
    const message = client.db["messages"]![0]!;
    expect(message["delivery_status"]).toBe("delivered");
    expect(message["delivered_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(message["provider_raw_status"]).toBe("delivered");
    expect(message["delivery_event_count"]).toBe(1);
    expect(client.db["leads"]![0]!["last_outbound_sms_status"]).toBe("delivered");
    expect(client.db["leads"]![0]!["last_delivered_sms_at"]).toBe("2026-01-01T01:00:00.000Z");
  });

  it("applies failed and undelivered receipts and preserves code + reason (4, 5, 6, 29)", async () => {
    for (const status of ["failed", "undelivered"] as const) {
      const client = createFakeSupabase(seed());
      await applyDeliveryEvent(
        event({ status, rawStatus: status === "failed" ? "sending_failed" : "delivery_failed", failureCode: "40012" }),
        { client },
      );
      const message = client.db["messages"]![0]!;
      expect(message["delivery_status"]).toBe(status);
      expect(message["failure_code"]).toBe("40012");
      expect(message["failure_class"]).toBe("permanent");
      expect(String(message["failure_reason"])).toContain("Invalid destination");
      expect(message["provider_raw_status"]).toBe(status === "failed" ? "sending_failed" : "delivery_failed");
      expect(message["failed_at"]).toBeTruthy();
    }
  });

  it("is idempotent for duplicate delivery and failure webhooks (7, 8, 25)", async () => {
    for (const status of ["delivered", "failed"] as const) {
      const client = createFakeSupabase(seed());
      const first = await applyDeliveryEvent(event({ status, failureCode: "40012" }), { client });
      const second = await applyDeliveryEvent(event({ status, failureCode: "40012" }), { client });
      expect(first.applied).toBe(true);
      expect(second.handled).toBe(true);
      expect(second.applied).toBe(false);
      expect(second.reason).toBe("duplicate_event");
      expect(client.db["messages"]!.length).toBe(1);
      expect(client.db["messages"]![0]!["delivery_event_count"]).toBe(1);
    }
  });

  it("cannot downgrade delivered with a late sent event (9, 11)", async () => {
    const client = createFakeSupabase(seed({ delivery_status: "delivered" }));
    const result = await applyDeliveryEvent(event({ status: "sent", eventId: "evt_late" }), { client });
    expect(result.handled).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("terminal_state");
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("delivered");
    // the late event is still recorded for audit
    expect(client.db["messages"]![0]!["last_provider_event_id"]).toBe("evt_late");
  });

  it("cannot downgrade a permanent failure (10)", async () => {
    const client = createFakeSupabase(
      seed({ delivery_status: "undelivered", failure_class: "permanent", failure_code: "40012" }),
    );
    await applyDeliveryEvent(event({ status: "delivered", eventId: "evt_x" }), { client });
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("undelivered");
    expect(client.db["messages"]![0]!["failure_class"]).toBe("permanent");
  });

  it("safely handles and audits an unknown provider message id (13)", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(event({ providerMessageId: "pmsg_missing" }), { client });
    expect(result.handled).toBe(false);
    expect(result.reason).toBe("unknown_provider_message_id");
    expect(client.db["audit_events"]!.some((row) => row["event_type"] === "sms_delivery_event_unmatched")).toBe(true);
  });

  it("cannot update a message belonging to another tenant (14, 28)", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(event({ businessId: OTHER_BUSINESS }), { client });
    expect(result.applied).toBe(false);
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("provider_accepted");
  });

  it("never sends, never creates a message, conversation, job or revenue (15, 16, 17, 18)", async () => {
    const client = createFakeSupabase(seed());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await applyDeliveryEvent(event(), { client });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(client.db["messages"]!.length).toBe(1);
    expect(client.db["conversations"]!.length).toBe(1);
    expect(client.db["jobs"]!.length).toBe(0);
    expect(client.writes.some((write) => write.table === "jobs")).toBe(false);
    expect(client.writes.some((write) => write.table === "messages" && write.op === "insert")).toBe(false);
    expect(client.writes.some((write) => write.table === "conversations" && write.op === "insert")).toBe(false);
  });

  it("stops automation and suppresses future automated SMS on permanent failure (20, 21)", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(event({ status: "undelivered", failureCode: "40012" }), { client });
    expect(result.suppressed).toBe(true);
    expect(result.automationStopped).toBe(true);
    expect(client.db["leads"]![0]!["sms_suppressed_at"]).toBeTruthy();
    expect(client.db["conversations"]![0]!["automation_paused"]).toBe(true);
    expect(client.db["conversations"]![0]!["next_follow_up_at"]).toBe(null);
    expect(client.db["automation_jobs"]![0]!["status"]).toBe("cancelled");
    expect(client.db["messages"]![0]!["automation_stopped"]).toBe(true);
  });

  it("does not suppress the lead on a temporary failure (22)", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(event({ status: "failed", failureCode: "40006" }), { client });
    expect(result.failureClass).toBe("temporary");
    expect(result.suppressed).toBe(false);
    expect(client.db["leads"]![0]!["sms_suppressed_at"]).toBe(null);
    expect(client.db["conversations"]![0]!["automation_paused"]).toBe(false);
  });

  it("keeps delivered when the customer never replies (23)", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event(), { client });
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("delivered");
    expect(client.db["leads"]![0]!["last_reply_at"]).toBeUndefined();
  });

  it("does not rewrite history when a reply arrives afterwards (24)", async () => {
    const db = seed();
    const client = createFakeSupabase(db);
    await applyDeliveryEvent(event(), { client });
    // simulate the inbound path recording the reply separately
    db["leads"]![0]!["last_reply_at"] = "2026-01-01T02:00:00.000Z";
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("delivered");
    expect(client.db["messages"]![0]!["delivered_at"]).toBe("2026-01-01T01:00:00.000Z");
  });

  it("does not let a late failure on an older message override a newer delivery", async () => {
    const db = seed();
    db["messages"]!.push({
      ...db["messages"]![0]!,
      id: "m-2",
      provider_message_id: "pmsg_2",
      delivery_status: "delivered",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    db["leads"]![0]!["last_outbound_sms_status"] = "delivered";
    const client = createFakeSupabase(db);
    await applyDeliveryEvent(event({ status: "failed", failureCode: "40006", eventId: "evt_old" }), { client });
    expect(client.db["leads"]![0]!["last_outbound_sms_status"]).toBe("delivered");
    expect(client.db["leads"]![0]!["last_sms_failure_reason"]).toBeTruthy();
  });

  it("records reconciliation timestamps without resending (read-only reconciliation)", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event({ reconciliation: true, eventId: "reconcile:pmsg_1:delivered" }), { client });
    expect(client.db["messages"]![0]!["reconciled_at"]).toBeTruthy();
    expect(client.db["messages"]![0]!["delivery_status"]).toBe("delivered");
  });

  it("logs no phone numbers, bodies or secrets (30)", async () => {
    const client = createFakeSupabase(seed());
    const logs: string[] = [];
    const spy = vi.spyOn(console, "info").mockImplementation((...args) => logs.push(args.join(" ")));
    const warn = vi.spyOn(console, "warn").mockImplementation((...args) => logs.push(args.join(" ")));
    const error = vi.spyOn(console, "error").mockImplementation((...args) => logs.push(args.join(" ")));
    await applyDeliveryEvent(event({ status: "failed", failureCode: "40012" }), { client });
    spy.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    for (const line of logs) {
      expect(line).not.toMatch(/\+?61\d{8,}/);
      expect(line).not.toMatch(/TELNYX|SUPABASE|secret/i);
    }
    const audit = JSON.stringify(client.db["audit_events"]);
    expect(audit).not.toMatch(/\+?61\d{8,}/);
  });
});

describe("delivery summary", () => {
  it("computes delivery rate from final outcomes only", () => {
    const summary = summariseDelivery([
      { delivery_status: "delivered", message_source: "manual" },
      { delivery_status: "delivered", message_source: "automation" },
      { delivery_status: "failed", failure_class: "permanent", message_source: "automation" },
      { delivery_status: "undelivered", failure_class: "temporary", message_source: "manual" },
      { delivery_status: "provider_accepted", message_source: "quote_page" },
      { delivery_status: "sent", message_source: "quote_page" },
    ]);
    expect(summary.total).toBe(6);
    expect(summary.pending).toBe(2);
    expect(summary.finalOutcomes).toBe(4);
    expect(summary.deliveryRate).toBeCloseTo(0.5);
    expect(summary.failureRate).toBeCloseTo(0.5);
    expect(summary.permanentFailures).toBe(1);
    expect(summary.temporaryFailures).toBe(1);
    expect(summary.providerAccepted).toBe(1);
    expect(summary.bySource.find((row) => row.source === "quote_page")?.pending).toBe(2);
  });

  it("returns null rates when nothing is final yet", () => {
    const summary = summariseDelivery([{ delivery_status: "provider_accepted" }]);
    expect(summary.deliveryRate).toBe(null);
    expect(summary.failureRate).toBe(null);
  });
});

describe("lead SMS filters", () => {
  it("matches each delivery filter", () => {
    expect(matchesSmsFilter({ last_outbound_sms_status: "delivered" }, "sms_delivered")).toBe(true);
    expect(matchesSmsFilter({ last_outbound_sms_status: "provider_accepted" }, "sms_pending")).toBe(true);
    expect(matchesSmsFilter({ last_outbound_sms_status: "failed" }, "sms_failed")).toBe(true);
    expect(matchesSmsFilter({ last_outbound_sms_status: "undelivered" }, "sms_undelivered")).toBe(true);
    expect(matchesSmsFilter({ sms_suppressed_at: "2026-01-01T00:00:00Z" }, "sms_suppressed")).toBe(true);
    expect(
      matchesSmsFilter({ last_delivered_sms_at: "2026-01-01T00:00:00Z" }, "no_reply_after_delivery"),
    ).toBe(true);
    expect(
      matchesSmsFilter(
        { last_delivered_sms_at: "2026-01-01T00:00:00Z", last_reply_at: "2026-01-02T00:00:00Z" },
        "no_reply_after_delivery",
      ),
    ).toBe(false);
  });
});
