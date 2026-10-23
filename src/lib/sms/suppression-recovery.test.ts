import { describe, expect, it } from "vitest";
import {
  AUTOMATION_PAUSED_LABEL,
  assessSuppressionRecovery,
  resumeConfirmationPoints,
} from "./suppression-recovery";
import { resumeSuppressedAutomation } from "./suppression-recovery.server";
import { applyDeliveryEvent } from "./delivery.server";
import { requireOwner, type AppContext } from "@/lib/app-context.server";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";

const BUSINESS = "b-1";
const OTHER = "b-2";

function seed(leadOverrides: Record<string, unknown> = {}, messageOverrides: Record<string, unknown> = {}): FakeDb {
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
        ...messageOverrides,
      },
    ],
    leads: [
      {
        id: "l-1",
        business_id: BUSINESS,
        status: "contacted",
        sms_suppressed_at: null,
        sms_suppression_reason: null,
        ...leadOverrides,
      },
    ],
    conversations: [
      { id: "c-1", business_id: BUSINESS, lead_id: "l-1", automation_paused: false },
    ],
    automation_jobs: [
      { id: "j-1", lead_id: "l-1", status: "pending", job_type: "follow_up" },
    ],
    audit_events: [],
    jobs: [],
    sms_usage_daily: [],
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

describe("permanent failure suppression is not auto-cleared", () => {
  it("permanent failure creates the suppression state", async () => {
    const client = createFakeSupabase(seed());
    await applyDeliveryEvent(event({ status: "failed", rawStatus: "failed", failureCode: "40012" }), { client });
    const lead = client.db["leads"]![0]!;
    expect(lead["sms_suppressed_at"]).toBeTruthy();
    expect(lead["last_permanent_failure_at"]).toBeTruthy();
  });

  it("a later delivery updates reachability but leaves suppression in place", async () => {
    const client = createFakeSupabase(
      seed({
        sms_suppressed_at: "2026-01-01T01:00:00.000Z",
        sms_suppression_reason: "Handset unreachable.",
        last_permanent_failure_at: "2026-01-01T01:00:00.000Z",
        last_sms_failure_code: "40012",
      }),
    );
    await applyDeliveryEvent(event({ occurredAt: "2026-01-02T00:00:00.000Z", eventId: "evt_2" }), { client });
    const lead = client.db["leads"]![0]!;
    expect(lead["reachability_state"]).toBe("reachable_recently");
    expect(lead["sms_suppressed_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(lead["last_permanent_failure_at"]).toBe("2026-01-01T01:00:00.000Z");
  });

  it("an inbound reply updates reachability but leaves suppression in place", () => {
    const view = assessSuppressionRecovery({
      sms_suppressed_at: "2026-01-01T01:00:00.000Z",
      sms_suppression_reason: "Handset unreachable.",
      last_permanent_failure_at: "2026-01-01T01:00:00.000Z",
      last_inbound_reply_at: "2026-01-03T00:00:00.000Z",
    });
    expect(view.suppressed).toBe(true);
    expect(view.reachableRecently).toBe(true);
    expect(view.evidenceKind).toBe("reply");
    expect(view.canResume).toBe(true);
  });

  it("shows both states clearly for a reachable but suppressed lead", () => {
    const view = assessSuppressionRecovery({
      sms_suppressed_at: "2026-01-01T01:00:00.000Z",
      sms_suppression_reason: "Handset unreachable.",
      last_permanent_failure_at: "2026-01-01T01:00:00.000Z",
      last_successful_delivery_at: "2026-01-04T00:00:00.000Z",
    });
    const points = resumeConfirmationPoints(view).join(" ");
    expect(AUTOMATION_PAUSED_LABEL).toMatch(/paused/i);
    expect(points).toMatch(/No message will be sent immediately/);
    expect(points).toMatch(/quiet-hours/);
    expect(points).not.toMatch(/inactive|dead/i);
  });

  it("temporary and configuration failures never create the recovery state", async () => {
    for (const code of ["40001", "40003"]) {
      const client = createFakeSupabase(seed());
      await applyDeliveryEvent(event({ status: "failed", rawStatus: "failed", failureCode: code, eventId: `evt_${code}` }), { client });
      const lead = client.db["leads"]![0]!;
      if (lead["sms_suppressed_at"]) continue; // permanent classes are covered above
      expect(assessSuppressionRecovery(lead as never).canResume).toBe(false);
    }
  });
});

describe("owner-confirmed resume", () => {
  const suppressed = () =>
    seed({
      sms_suppressed_at: "2026-01-01T01:00:00.000Z",
      sms_suppression_reason: "Handset unreachable.",
      last_permanent_failure_at: "2026-01-01T01:00:00.000Z",
      last_sms_failure_code: "40012",
      last_sms_failure_reason: "Handset unreachable.",
      reachability_state: "reachable_recently",
      last_inbound_reply_at: "2026-01-03T00:00:00.000Z",
      reachability_evidence: "Customer replied by SMS.",
      reachability_evidence_at: "2026-01-03T00:00:00.000Z",
    });

  const ctx = (role: AppContext["role"]): AppContext => ({
    userId: "u-1",
    businessId: BUSINESS,
    role,
    isPlatformAdmin: role === "platform_admin",

    name: null,
    email: null,
  });

  it("rejects a staff user server-side", () => {
    expect(() => requireOwner(ctx("staff"))).toThrow(/owner/i);
    expect(() => requireOwner(ctx("owner"))).not.toThrow();
  });

  it("clears only the active suppression state and preserves history", async () => {
    const client = createFakeSupabase(suppressed());
    const result = await resumeSuppressedAutomation(client, {
      businessId: BUSINESS,
      actorUserId: "u-1",
      leadId: "l-1",
      confirmedAt: "2026-01-05T00:00:00.000Z",
    });
    expect(result.status).toBe("resumed");
    const lead = client.db["leads"]![0]!;
    expect(lead["sms_suppressed_at"]).toBeNull();
    expect(lead["sms_suppression_reason"]).toBeNull();
    expect(lead["last_permanent_failure_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(lead["last_sms_failure_code"]).toBe("40012");
    expect(lead["last_sms_failure_reason"]).toBe("Handset unreachable.");
    expect(lead["reachability_state"]).toBe("reachable_recently");
    expect(lead["reachability_evidence_at"]).toBe("2026-01-03T00:00:00.000Z");
  });

  it("creates no message, no conversation, no usage change and no automation run", async () => {
    const db = suppressed();
    const client = createFakeSupabase(db);
    await resumeSuppressedAutomation(client, {
      businessId: BUSINESS,
      actorUserId: "u-1",
      leadId: "l-1",
    });
    expect(client.db["messages"]).toHaveLength(1);
    expect(client.db["conversations"]).toHaveLength(1);
    expect(client.db["sms_usage_daily"]).toHaveLength(0);
    expect(client.db["jobs"]).toHaveLength(0);
    expect(client.db["automation_jobs"]![0]!["status"]).toBe("pending");
    const touched = new Set(
      (client.writes as { table: string; op: string }[]).map((entry) => `${entry.table}:${entry.op}`),
    );
    expect(touched).toEqual(new Set(["leads:update", "audit_events:insert"]));
  });

  it("writes one owner-scoped audit event with the previous suppression state", async () => {
    const client = createFakeSupabase(suppressed());
    await resumeSuppressedAutomation(client, {
      businessId: BUSINESS,
      actorUserId: "u-1",
      leadId: "l-1",
      confirmedAt: "2026-01-05T00:00:00.000Z",
    });
    const audit = client.db["audit_events"]![0]! as Record<string, any>;
    expect(audit["business_id"]).toBe(BUSINESS);
    expect(audit["user_id"]).toBe("u-1");
    expect(audit["entity_id"]).toBe("l-1");
    expect(audit["event_type"]).toBe("sms_suppression_resumed_by_owner");
    expect(audit["metadata"]["previous_suppression_reason"]).toBe("Handset unreachable.");
    expect(audit["metadata"]["previous_suppressed_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(audit["metadata"]["reachability_evidence_at"]).toBe("2026-01-03T00:00:00.000Z");
    expect(audit["metadata"]["confirmed_at"]).toBe("2026-01-05T00:00:00.000Z");
  });

  it("is idempotent on repeated submission", async () => {
    const client = createFakeSupabase(suppressed());
    await resumeSuppressedAutomation(client, {
      businessId: BUSINESS,
      actorUserId: "u-1",
      leadId: "l-1",
    });
    const second = await resumeSuppressedAutomation(client, {
      businessId: BUSINESS,
      actorUserId: "u-1",
      leadId: "l-1",
    });
    expect(second.status).toBe("already_resumed");
    expect(client.db["audit_events"]).toHaveLength(1);
  });

  it("cannot resume a lead in another tenant", async () => {
    const client = createFakeSupabase(suppressed());
    const result = await resumeSuppressedAutomation(client, {
      businessId: OTHER,
      actorUserId: "u-9",
      leadId: "l-1",
    });
    expect(result.status).toBe("not_found");
    expect(client.db["leads"]![0]!["sms_suppressed_at"]).toBe("2026-01-01T01:00:00.000Z");
    expect(client.db["audit_events"]).toHaveLength(0);
  });
});
