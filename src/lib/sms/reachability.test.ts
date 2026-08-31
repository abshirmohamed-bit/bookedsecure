import { describe, expect, it } from "vitest";
import {
  assessReachability,
  hasHistoricalFailure,
  reachabilityUpdateFor,
  REACHABILITY_LABELS,
} from "./reachability";
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
      {
        id: "l-1",
        business_id: BUSINESS,
        status: "contacted",
        sms_suppressed_at: null,
        reachability_state: "unknown",
        last_successful_delivery_at: null,
        last_permanent_failure_at: null,
        last_inbound_reply_at: null,
      },
      {
        id: "other-1",
        business_id: OTHER_BUSINESS,
        status: "contacted",
        sms_suppressed_at: null,
        reachability_state: "unknown",
      },
    ],
    conversations: [
      {
        id: "c-1",
        business_id: BUSINESS,
        lead_id: "l-1",
        automation_paused: false,
        next_follow_up_at: "2026-01-02T00:00:00.000Z",
      },
    ],
    automation_jobs: [
      { id: "j-1", lead_id: "l-1", status: "pending", job_type: "follow_up", next_attempt_at: null },
    ],
    audit_events: [],
    jobs: [],
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    providerName: "telnyx",
    businessId: BUSINESS,
    providerMessageId: "pmsg_1",
    status: "delivered" as const,
    rawStatus: "delivered",
    eventId: "evt_1",
    occurredAt: "2026-01-01T01:00:00.000Z",
    ...overrides,
  } as Parameters<typeof applyDeliveryEvent>[0];
}

const lead = (row: Record<string, unknown>) => row as never;

describe("reachability model (pure)", () => {
  it("starts unknown with no evidence", () => {
    expect(assessReachability({}).state).toBe("unknown");
    expect(assessReachability({}).evidence).toBe(null);
  });

  it("marks reachable_recently on a delivery receipt", () => {
    const patch = reachabilityUpdateFor({}, { kind: "delivered", at: "2026-01-01T01:00:00.000Z" });
    expect(patch["reachability_state"]).toBe("reachable_recently");
    expect(patch["last_successful_delivery_at"]).toBe("2026-01-01T01:00:00.000Z");
  });

  it("marks reachable_recently on an inbound reply", () => {
    const patch = reachabilityUpdateFor({}, { kind: "inbound_reply", at: "2026-01-01T02:00:00.000Z" });
    expect(patch["reachability_state"]).toBe("reachable_recently");
    expect(patch["last_inbound_reply_at"]).toBe("2026-01-01T02:00:00.000Z");
  });

  it("uses suppressed_pending_review for a permanent failure and never claims inactive", () => {
    const patch = reachabilityUpdateFor(
      {},
      { kind: "permanent_failure", at: "2026-01-01T03:00:00.000Z", reason: "Invalid destination number.", code: "40012" },
    );
    expect(patch["reachability_state"]).toBe("suppressed_pending_review");
    expect(patch["last_permanent_failure_at"]).toBe("2026-01-01T03:00:00.000Z");
    expect(String(patch["reachability_evidence"])).toContain("not proven inactive");
    expect(String(patch["reachability_evidence"]).toLowerCase()).not.toContain("permanently inactive");
    expect(REACHABILITY_LABELS["suppressed_pending_review"]).not.toMatch(/dead|inactive/i);
  });

  it("temporary and configuration failures change nothing", () => {
    expect(reachabilityUpdateFor({}, { kind: "temporary_failure", at: "2026-01-01T03:00:00.000Z" })).toEqual({});
    expect(reachabilityUpdateFor({}, { kind: "configuration_failure", at: "2026-01-01T03:00:00.000Z" })).toEqual({});
  });

  it("unreachable_recently only when a permanent failure exists without suppression", () => {
    expect(
      assessReachability({ last_permanent_failure_at: "2026-01-01T03:00:00.000Z" }).state,
    ).toBe("unreachable_recently");
  });

  it("a later delivery clears suppressed_pending_review but keeps failure history", () => {
    const record = {
      sms_suppressed_at: "2026-01-01T03:00:00.000Z",
      last_permanent_failure_at: "2026-01-01T03:00:00.000Z",
    };
    const patch = reachabilityUpdateFor(record, { kind: "delivered", at: "2026-01-02T00:00:00.000Z" });
    expect(patch["reachability_state"]).toBe("reachable_recently");
    expect(record.last_permanent_failure_at).toBe("2026-01-01T03:00:00.000Z");
    expect(hasHistoricalFailure({ ...record, ...patch })).toBe(true);
  });

  it("a later reply clears suppressed_pending_review", () => {
    const patch = reachabilityUpdateFor(
      { sms_suppressed_at: "2026-01-01T03:00:00.000Z", last_permanent_failure_at: "2026-01-01T03:00:00.000Z" },
      { kind: "inbound_reply", at: "2026-01-02T00:00:00.000Z" },
    );
    expect(patch["reachability_state"]).toBe("reachable_recently");
    expect(String(patch["reachability_evidence"])).toContain("replied");
  });

  it("an older delivery does not override a newer permanent failure", () => {
    expect(
      assessReachability({
        last_successful_delivery_at: "2026-01-01T00:00:00.000Z",
        last_permanent_failure_at: "2026-01-05T00:00:00.000Z",
        sms_suppressed_at: "2026-01-05T00:00:00.000Z",
      }).state,
    ).toBe("suppressed_pending_review");
  });

  it("mixed outcomes: latest message status and reachability stay independent", () => {
    // Latest outbound failed temporarily, but the customer replied afterwards.
    const assessment = assessReachability({
      last_inbound_reply_at: "2026-01-03T00:00:00.000Z",
      last_permanent_failure_at: null,
    });
    expect(assessment.state).toBe("reachable_recently");
  });
});

describe("reachability through the delivery pipeline", () => {
  it("delivered message marks the lead reachable_recently", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event(), { client });
    const row = client.db["leads"]!.find((r: Record<string, unknown>) => r["id"] === "l-1")!;
    expect(row["reachability_state"]).toBe("reachable_recently");
    expect(row["last_successful_delivery_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(row["last_outbound_sms_status"]).toBe("delivered");
  });

  it("permanent failure stops automation and sets suppressed_pending_review", async () => {
    const client = createFakeSupabase(seed());
    const result = await applyDeliveryEvent(
      event({ status: "undelivered", failureCode: "40012" }),
      { client },
    );
    const row = client.db["leads"]!.find((r: Record<string, unknown>) => r["id"] === "l-1")!;
    expect(result.automationStopped).toBe(true);
    expect(row["reachability_state"]).toBe("suppressed_pending_review");
    expect(row["sms_suppressed_at"]).toBeTruthy();
    expect(row["last_sms_failure_code"]).toBe("40012");
    expect(client.db["conversations"]![0]!["automation_paused"]).toBe(true);
  });

  it("temporary failure does not suppress or mark unreachable", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event({ status: "failed", failureCode: "40006" }), { client });
    const row = client.db["leads"]!.find((r: Record<string, unknown>) => r["id"] === "l-1")!;
    expect(row["sms_suppressed_at"]).toBe(null);
    expect(row["reachability_state"]).toBe("unknown");
  });

  it("later delivery restores reachable_recently and keeps the failure record", async () => {
    const db = seed();
    db["leads"]![0]!["sms_suppressed_at"] = "2026-01-01T03:00:00.000Z";
    db["leads"]![0]!["last_permanent_failure_at"] = "2026-01-01T03:00:00.000Z";
    db["leads"]![0]!["last_sms_failure_code"] = "40012";
    db["leads"]![0]!["reachability_state"] = "suppressed_pending_review";
    db["messages"]!.push({
      ...db["messages"]![0]!,
      id: "m-2",
      provider_message_id: "pmsg_2",
      delivery_status: "provider_accepted",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    const client = createFakeSupabase(db);
    await applyDeliveryEvent(
      event({ providerMessageId: "pmsg_2", eventId: "evt_2", occurredAt: "2026-02-01T01:00:00.000Z" }),
      { client },
    );
    const row = client.db["leads"]!.find((r: Record<string, unknown>) => r["id"] === "l-1")!;
    expect(row["reachability_state"]).toBe("reachable_recently");
    expect(row["last_permanent_failure_at"]).toBe("2026-01-01T03:00:00.000Z");
    expect(row["last_sms_failure_code"]).toBe("40012");
  });

  it("never touches another tenant's lead", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event({ status: "undelivered", failureCode: "40012" }), { client });
    const other = client.db["leads"]!.find((r: Record<string, unknown>) => r["id"] === "other-1")!;
    expect(other["reachability_state"]).toBe("unknown");
    expect(other["sms_suppressed_at"]).toBe(null);
  });

  it("sends nothing and creates no messages, jobs or usage while assessing", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event(), { client });
    expect(client.db["messages"]!.length).toBe(1);
    expect(client.db["jobs"]!.length).toBe(0);
    expect(
      client.writes.some(
        (write: { table: string; op: string }) => write.op === "insert" && write.table !== "audit_events",
      ),
    ).toBe(false);
  });
});

// Keeps the unused helper honest for type-only lead shaping in future tests.
void lead;
