import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  PURGE_CONFIRMATION_PHRASE,
  buildPurgeConfirmation,
  evaluatePurgeEligibility,
  isPurgeConfirmed,
  planPermanentDelete,
  purgeButtonLabel,
  summarisePurgeResult,
} from "@/lib/lead-purge";
import { permanentlyDeleteLeads } from "@/lib/lead-purge.server";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const CLEAN = "aaaaaaaa-0000-4000-8000-000000000001";
const WITH_MESSAGES = "aaaaaaaa-0000-4000-8000-000000000002";
const ACTIVE = "aaaaaaaa-0000-4000-8000-000000000003";
const FOREIGN = "bbbbbbbb-0000-4000-8000-000000000001";

function lead(id: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id,
    business_id: TENANT,
    name: `Lead ${id.slice(-1)}`,
    mobile_number: "+61412345678",
    source_channel: "godaddy",
    lead_origin: "crm_import",
    import_batch_id: "batch-1",
    source_metadata: {},
    deleted_at: "2026-09-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function db(): FakeDb {
  return {
    leads: [
      lead(CLEAN),
      lead(WITH_MESSAGES),
      lead(ACTIVE, { deleted_at: null }),
      lead(FOREIGN, { business_id: OTHER_TENANT }),
    ],
    messages: [{ id: "m1", business_id: TENANT, lead_id: WITH_MESSAGES }],
    consent_events: [],
    jobs: [],
    automation_jobs: [],
    conversations: [],
    ai_outputs: [],
    notifications: [],
    ai_usage_events: [{ id: "u1", business_id: TENANT, lead_id: CLEAN, estimated_cost: 0.02 }],
    lead_import_rows: [
      { id: "r1", business_id: TENANT, resulting_lead_id: CLEAN, dedupe_match_lead_id: null },
    ],
    lead_deletion_requests: [],
    audit_events: [],
  };
}

describe("permanent deletion policy (pure)", () => {
  it("requires the exact DELETE confirmation phrase", () => {
    expect(PURGE_CONFIRMATION_PHRASE).toBe("DELETE");
    expect(isPurgeConfirmed("DELETE")).toBe(true);
    expect(isPurgeConfirmed(" DELETE ")).toBe(true);
    expect(isPurgeConfirmed("delete")).toBe(false);
    expect(isPurgeConfirmed("")).toBe(false);
    expect(isPurgeConfirmed(null)).toBe(false);
  });

  it("only allows soft-deleted leads", () => {
    expect(evaluatePurgeEligibility({ leadId: CLEAN, lead: lead(CLEAN) as any }).allowed).toBe(true);
    const active = evaluatePurgeEligibility({
      leadId: ACTIVE,
      lead: lead(ACTIVE, { deleted_at: null }) as any,
    });
    expect(active.allowed).toBe(false);
    expect(active.blockedReasons).toContain("not_soft_deleted");
    const missing = evaluatePurgeEligibility({ leadId: CLEAN, lead: null });
    expect(missing.blockedReasons).toContain("not_found");
  });

  it("blocks protected dependencies with explicit reasons", () => {
    const result = evaluatePurgeEligibility({
      leadId: CLEAN,
      lead: lead(CLEAN) as any,
      dependencies: { messages: 2, consentEvents: 1, jobs: 1, pendingAutomationJobs: 1 },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockedReasons).toEqual([
      "message_history",
      "consent_history",
      "financial_history",
      "pending_automation",
    ]);
  });

  it("lists retained dependencies", () => {
    const result = evaluatePurgeEligibility({
      leadId: CLEAN,
      lead: lead(CLEAN) as any,
      dependencies: { aiUsageEvents: 1, importRows: 2 },
    });
    expect(result.retained).toEqual(["audit_events", "ai_usage_events", "import_rows"]);
  });

  it("builds a confirmation with names, masked phones, sources and ids", () => {
    const confirmation = buildPurgeConfirmation([CLEAN], [lead(CLEAN) as any]);
    expect(confirmation.count).toBe(1);
    expect(confirmation.rows[0]!.phone).toBe("••• ••• 678");
    expect(confirmation.rows[0]!.id).toBe(CLEAN);
    expect(confirmation.rows[0]!.source.length).toBeGreaterThan(0);
    expect(confirmation.warning).toMatch(/cannot be undone/i);
    expect(purgeButtonLabel(2)).toBe("Permanently delete 2 leads");
  });

  it("plans only eligible ids", () => {
    const plan = planPermanentDelete({
      requestedIds: [CLEAN, WITH_MESSAGES, ACTIVE, FOREIGN],
      leads: [lead(CLEAN), lead(WITH_MESSAGES), lead(ACTIVE, { deleted_at: null })] as any,
      dependenciesByLead: { [WITH_MESSAGES]: { messages: 1 } },
    });
    expect(plan.toPurge).toEqual([CLEAN]);
    expect(plan.blocked.map((row) => row.leadId).sort()).toEqual(
      [WITH_MESSAGES, ACTIVE, FOREIGN].sort(),
    );
  });

  it("summarises results honestly", () => {
    expect(
      summarisePurgeResult({
        requestId: REQUEST,
        requested: 2,
        deleted: 1,
        blocked: 1,
        outcomes: [],
        idempotentReplay: true,
      }),
    ).toBe("2 selected · 1 permanently deleted · 1 blocked · repeat request. nothing new deleted");
  });
});

describe("permanentlyDeleteLeads (server)", () => {
  it("removes an eligible soft-deleted lead and retains detachable records", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const result = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [CLEAN],
      reason: "customer erasure request",
    });

    expect(result.deleted).toBe(1);
    expect(result.blocked).toBe(0);
    expect(data["leads"]!.some((row) => row["id"] === CLEAN)).toBe(false);
    // retained, detached
    expect(data["ai_usage_events"]![0]!["lead_id"]).toBeNull();
    expect(data["lead_import_rows"]![0]!["resulting_lead_id"]).toBeNull();
    expect(data["ai_usage_events"]!.length).toBe(1);
  });

  it("records an owner-only permanent deletion audit event", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [CLEAN],
      reason: "erasure",
    });
    const perLead = data["audit_events"]!.find(
      (row) => row["event_type"] === "lead_permanently_deleted",
    );
    expect(perLead).toBeTruthy();
    expect(perLead!["business_id"]).toBe(TENANT);
    expect(perLead!["user_id"]).toBe(ACTOR);
    expect(perLead!["entity_id"]).toBe(CLEAN);
    expect((perLead!["metadata"] as any).reason).toBe("erasure");
    expect((perLead!["metadata"] as any).retained_dependencies).toContain(
      "Audit trail (kept, including this deletion)",
    );
    expect(
      data["audit_events"]!.some((row) => row["event_type"] === "leads_permanently_deleted"),
    ).toBe(true);
  });

  it("blocks leads with protected dependencies and leaves them untouched", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const result = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [WITH_MESSAGES],
    });
    expect(result.deleted).toBe(0);
    expect(result.blocked).toBe(1);
    expect(result.outcomes[0]!.reason).toMatch(/provider reconciliation/);
    expect(data["leads"]!.some((row) => row["id"] === WITH_MESSAGES)).toBe(true);
    expect(data["messages"]!.length).toBe(1);
  });

  it("never permanently deletes an active lead", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const result = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [ACTIVE],
    });
    expect(result.deleted).toBe(0);
    expect(result.outcomes[0]!.reason).toMatch(/not found|still active/i);
    expect(data["leads"]!.some((row) => row["id"] === ACTIVE)).toBe(true);
  });

  it("isolates tenants: another tenant's lead is never touched", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const result = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [FOREIGN],
    });
    expect(result.deleted).toBe(0);
    expect(data["leads"]!.some((row) => row["id"] === FOREIGN)).toBe(true);
  });

  it("is idempotent when the same request is replayed", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const first = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [CLEAN],
    });
    const auditCount = data["audit_events"]!.length;
    const second = await permanentlyDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [CLEAN],
    });
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.deleted).toBe(first.deleted);
    expect(data["audit_events"]!.length).toBe(auditCount);
  });

  it("touches no provider, automation or usage tables", async () => {
    const data = db();
    const client = createFakeSupabase(data);
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      await permanentlyDeleteLeads(client, {
        businessId: TENANT,
        actorUserId: ACTOR,
        requestId: REQUEST,
        leadIds: [CLEAN, WITH_MESSAGES],
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    const writtenTables = new Set(
      (client.writes as { table: string; op: string }[])
        .filter((entry) => entry.op !== "select")
        .map((entry) => entry.table),
    );
    expect(writtenTables).toEqual(
      new Set(["lead_deletion_requests", "ai_usage_events", "lead_import_rows", "audit_events", "leads"]),
    );
    for (const forbidden of [
      "messages",
      "automation_rules",
      "automation_jobs",
      "businesses",
      "sms_senders",
      "sms_usage_periods",
      "sms_usage_daily",
      "import_automation_state",
      "consent_events",
    ]) {
      expect(writtenTables.has(forbidden)).toBe(false);
    }
  });
});

describe("permanent deletion authorization", () => {
  it("accepts an owner and rejects a non-owner", async () => {
    const { requireOwner } = await import("@/lib/app-context.server");
    const owner = { userId: ACTOR, businessId: TENANT, role: "owner", name: null, email: null } as const;
    const staff = { ...owner, role: "staff" } as const;
    expect(() => requireOwner(owner as any)).not.toThrow();
    expect(() => requireOwner(staff as any)).toThrow(/owner/i);
  });

  it("gates the server function on owner role, the DELETE phrase and server-side tenant scope", async () => {
    const source = await readFile("src/lib/lead-deletion.functions.ts", "utf8");
    const block = source.slice(source.indexOf("permanentlyDeleteLeadsRequest"));
    expect(block).toContain("requireSupabaseAuth");
    expect(block).toContain("requireOwner(app)");
    expect(block).toContain("isPurgeConfirmed(data.confirmationPhrase)");
    expect(block).toContain("businessId: app.businessId");
    expect(block).not.toMatch(/businessId: data\./);
  });
});
