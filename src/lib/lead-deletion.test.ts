import { describe, expect, it } from "vitest";
import {
  activeLeads,
  buildConfirmation,
  clearSelection,
  confirmButtonLabel,
  headerCheckboxState,
  leadEligibility,
  maskPhone,
  normaliseSelection,
  planSoftDelete,
  restrictToVisible,
  selectAllVisible,
  summariseResult,
  toggleSelection,
} from "@/lib/lead-deletion";
import { restoreLeads, softDeleteLeads, listDeletedLeads } from "@/lib/lead-deletion.server";
import { createFakeSupabase } from "@/lib/test-utils/fake-supabase";
import { leadSourceLabel } from "@/lib/lead-source";
import { SOURCE_LABELS } from "@/lib/domain";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "99999999-9999-4999-8999-999999999999";
const ACTOR = "22222222-2222-4222-8222-222222222222";
const REQUEST = "33333333-3333-4333-8333-333333333333";

const L1 = "aaaaaaaa-0000-4000-8000-000000000001";
const L2 = "aaaaaaaa-0000-4000-8000-000000000002";
const L3 = "aaaaaaaa-0000-4000-8000-000000000003";
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
    source_metadata: { original_source: { channel: "godaddy" } },
    status: "new",
    created_at: "2025-07-01T00:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deletion_reason: null,
    deletion_request_id: null,
    ...overrides,
  };
}

type FakeDbShape = {
  leads: any[];
  conversations: any[];
  messages: any[];
  jobs: any[];
  notifications: any[];
  webhook_events: any[];
  import_batches: any[];
  lead_deletion_requests: any[];
  audit_events: any[];
};

function freshDb(): FakeDbShape {
  return {
    leads: [
      lead(L1),
      lead(L2),
      lead(L3, { source_channel: "meta", lead_origin: null }),
      lead(FOREIGN, { business_id: OTHER_TENANT }),
    ],
    conversations: [{ lead_id: L3, business_id: TENANT, status: "closed", next_follow_up_at: null }],
    messages: [{ id: "m1", lead_id: L3, business_id: TENANT, body: "hi" }],
    jobs: [] as Record<string, any>[],
    notifications: [{ id: "n1", lead_id: L3, business_id: TENANT }],
    webhook_events: [{ id: "w1", business_id: TENANT }],
    import_batches: [{ id: "batch-1", business_id: TENANT }],
    lead_deletion_requests: [] as Record<string, any>[],
    audit_events: [] as Record<string, any>[],
  };
}

/* ------------------------------------------------------------------ selection */

describe("lead selection", () => {
  it("selects a single lead", () => {
    expect(toggleSelection([], L1)).toEqual([L1]);
  });

  it("selects multiple individual leads and unselects on repeat", () => {
    const two = toggleSelection(toggleSelection([], L1), L2);
    expect(two).toEqual([L1, L2]);
    expect(toggleSelection(two, L1)).toEqual([L2]);
  });

  it("selects all visible filtered leads only", () => {
    const visible = [{ id: L1 }, { id: L2 }];
    expect(selectAllVisible(visible)).toEqual([L1, L2]);
  });

  it("never selects hidden or unfiltered leads", () => {
    const visible = [{ id: L1 }];
    const selection = selectAllVisible(visible);
    expect(selection).not.toContain(L2);
    expect(restrictToVisible([L1, L2, L3], visible)).toEqual([L1]);
  });

  it("de-duplicates duplicate selections", () => {
    expect(normaliseSelection([L1, L1, L2, L2])).toEqual([L1, L2]);
  });

  it("reports header checkbox state from the visible rows", () => {
    const visible = [{ id: L1 }, { id: L2 }];
    expect(headerCheckboxState([], visible)).toBe("unchecked");
    expect(headerCheckboxState([L1], visible)).toBe("indeterminate");
    expect(headerCheckboxState([L1, L2], visible)).toBe("checked");
    expect(headerCheckboxState([L3], visible)).toBe("unchecked");
  });

  it("clears the selection", () => {
    expect(clearSelection()).toEqual([]);
  });
});

/* --------------------------------------------------------------- confirmation */

describe("confirmation summary", () => {
  it("shows the exact count in the button label", () => {
    expect(confirmButtonLabel(1)).toBe("Delete 1 lead");
    expect(confirmButtonLabel(3)).toBe("Delete 3 leads");
  });

  it("lists names, masked phones and source attribution", () => {
    const summary = buildConfirmation([L1, L2], [lead(L1), lead(L2)] as never);
    expect(summary.count).toBe(2);
    expect(summary.buttonLabel).toBe("Delete 2 leads");
    expect(summary.rows[0]?.source).toBe("Website / GoDaddy");
    expect(summary.rows[0]?.importMethod).toBe("CRM CSV");
    expect(summary.rows[0]?.phone).toBe("••• ••• 678");
    expect(summary.warning).toContain("active Leads inbox");
  });

  it("never exposes a full phone number", () => {
    expect(maskPhone("+61412345678")).toBe("••• ••• 678");
    expect(maskPhone(null)).toBeNull();
  });

  it("cancelling the confirmation leaves the selection intact and deletes nothing", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    const selection = [L1, L2];
    buildConfirmation(selection, [lead(L1), lead(L2)] as never); // modal opened, then cancelled
    expect(selection).toEqual([L1, L2]);
    expect(client.writes).toHaveLength(0);
    expect(db.leads.every((row) => row.deleted_at === null)).toBe(true);
  });

  it("flags protected operational history", () => {
    const protectedLead = lead(L1, {
      job: { completion_status: "completed", completed_value: 250 },
      conversation: { status: "active", next_follow_up_at: "2025-08-01T00:00:00Z" },
    });
    const eligibility = leadEligibility(protectedLead as never);
    expect(eligibility.protectedReasons).toEqual(
      expect.arrayContaining([
        "completed_job",
        "recorded_revenue",
        "active_conversation",
        "pending_action",
      ]),
    );
    const summary = buildConfirmation([L1], [protectedLead] as never);
    expect(summary.protectedCount).toBe(1);
  });
});

/* -------------------------------------------------------------------- planning */

describe("soft delete planning", () => {
  it("blocks protected leads unless explicitly confirmed", () => {
    const leads = [lead(L1, { job: { completion_status: "completed", completed_value: 100 } })];
    const blocked = planSoftDelete({ requestedIds: [L1], tenantLeads: leads as never });
    expect(blocked.toDelete).toEqual([]);
    expect(blocked.failures[0]?.reason).toContain("completed job");
    const allowed = planSoftDelete({
      requestedIds: [L1],
      tenantLeads: leads as never,
      allowProtected: true,
    });
    expect(allowed.toDelete).toEqual([L1]);
  });

  it("treats leads outside the tenant as failures, never deletions", () => {
    const plan = planSoftDelete({ requestedIds: [L1, FOREIGN], tenantLeads: [lead(L1)] as never });
    expect(plan.toDelete).toEqual([L1]);
    expect(plan.failures).toEqual([
      { leadId: FOREIGN, name: null, reason: "Lead not found for this business" },
    ]);
  });

  it("treats already-deleted leads as idempotent no-ops", () => {
    const plan = planSoftDelete({
      requestedIds: [L1],
      tenantLeads: [lead(L1, { deleted_at: "2025-08-01T00:00:00Z" })] as never,
    });
    expect(plan.toDelete).toEqual([]);
    expect(plan.alreadyDeleted).toEqual([L1]);
    expect(plan.failures).toEqual([]);
  });

  it("summarises requested, deleted and failed counts", () => {
    expect(
      summariseResult({
        requestId: REQUEST,
        requested: 3,
        deleted: 2,
        failed: 1,
        failures: [],
        alreadyDeleted: 0,
        idempotentReplay: false,
      }),
    ).toBe("3 requested · 2 deleted · 1 failed");
  });

  it("hides soft-deleted leads from active views", () => {
    const rows = [lead(L1), lead(L2, { deleted_at: "2025-08-01T00:00:00Z" })];
    expect(activeLeads(rows).map((row) => row["id"])).toEqual([L1]);
  });
});

/* ---------------------------------------------------------------- server side */

describe("soft delete execution", () => {
  it("deletes one lead and records an audit event without phone numbers", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    const result = await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
      reason: "Duplicate record",
    });
    expect(result.deleted).toBe(1);
    expect(result.failed).toBe(0);
    const row = db.leads.find((item) => item.id === L1)!;
    expect(row.deleted_at).toBeTruthy();
    expect(row.deleted_by).toBe(ACTOR);
    expect(row.deletion_reason).toBe("Duplicate record");
    expect(row.deletion_request_id).toBe(REQUEST);

    const audit = db.audit_events.at(-1)!;
    expect(audit.event_type).toBe("leads_soft_deleted");
    expect(audit.business_id).toBe(TENANT);
    expect(audit.user_id).toBe(ACTOR);
    expect(JSON.stringify(audit.metadata)).not.toContain("61412345678");
  });

  it("deletes multiple leads and de-duplicates repeated ids", async () => {
    const db = freshDb();
    const result = await softDeleteLeads(createFakeSupabase(db), {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1, L2, L1],
    });
    expect(result.requested).toBe(2);
    expect(result.deleted).toBe(2);
  });

  it("never deletes another business's leads", async () => {
    const db = freshDb();
    const result = await softDeleteLeads(createFakeSupabase(db), {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [FOREIGN],
    });
    expect(result.deleted).toBe(0);
    expect(result.failed).toBe(1);
    expect(db.leads.find((item) => item.id === FOREIGN)!.deleted_at).toBeNull();
  });

  it("reports failed records by id and name", async () => {
    const db = freshDb();
    db.jobs.push({
      lead_id: L2,
      business_id: TENANT,
      completion_status: "completed",
      completed_value: 320,
    });
    const result = await softDeleteLeads(createFakeSupabase(db), {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1, L2],
    });
    expect(result.deleted).toBe(1);
    expect(result.failures.map((failure) => failure.leadId)).toEqual([L2]);
    expect(db.leads.find((item) => item.id === L2)!.deleted_at).toBeNull();
  });

  it("is idempotent when the same request is retried", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    const first = await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
    });
    const second = await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
    });
    expect(first.deleted).toBe(1);
    expect(second.idempotentReplay).toBe(true);
    expect(second.deleted).toBe(1);
    expect(db.lead_deletion_requests).toHaveLength(1);
    expect(db.audit_events.filter((row) => row.event_type === "leads_soft_deleted")).toHaveLength(1);
  });

  it("refuses a second request while one is still processing", async () => {
    const db = freshDb();
    db.lead_deletion_requests.push({
      id: "req-1",
      business_id: TENANT,
      request_id: REQUEST,
      status: "processing",
      requested_count: 1,
      deleted_count: 0,
      failed_count: 0,
      failures: [],
    });
    await expect(
      softDeleteLeads(createFakeSupabase(db), {
        businessId: TENANT,
        actorUserId: ACTOR,
        requestId: REQUEST,
        leadIds: [L1],
      }),
    ).rejects.toThrow(/already processing/i);
  });

  it("preserves conversations, messages, jobs, revenue, webhooks and import records", async () => {
    const db = freshDb();
    db.jobs.push({
      lead_id: L1,
      business_id: TENANT,
      completion_status: "scheduled",
      completed_value: null,
    });
    const before = JSON.stringify({
      conversations: db.conversations,
      messages: db.messages,
      jobs: db.jobs,
      notifications: db.notifications,
      webhook_events: db.webhook_events,
      import_batches: db.import_batches,
    });
    const client = createFakeSupabase(db);
    await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
    });
    expect(
      JSON.stringify({
        conversations: db.conversations,
        messages: db.messages,
        jobs: db.jobs,
        notifications: db.notifications,
        webhook_events: db.webhook_events,
        import_batches: db.import_batches,
      }),
    ).toBe(before);

    // Only leads, the deletion-request ledger and the audit trail are written.
    const touched = new Set(client.writes.map((write: { table: string }) => write.table));
    expect(Array.from(touched).sort()).toEqual(["audit_events", "lead_deletion_requests", "leads"]);
    expect(client.writes.some((write: { op: string }) => write.op === "delete")).toBe(false);
  });

  it("causes no SMS, email, automation or provider side effects", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1, L2],
    });
    for (const table of ["messages", "notifications", "automation_jobs", "conversations"]) {
      expect(client.writes.some((write: { table: string }) => write.table === table)).toBe(false);
    }
  });

  it("keeps the GoDaddy attribution, import batch and metadata unchanged", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
    });
    const row = db.leads.find((item) => item.id === L1)!;
    expect(row.source_channel).toBe("godaddy");
    expect(row.lead_origin).toBe("crm_import");
    expect(row.import_batch_id).toBe("batch-1");
    expect(row.source_metadata).toEqual({ original_source: { channel: "godaddy" } });
    expect(leadSourceLabel(row as never)).toBe("Website / GoDaddy");
    expect(SOURCE_LABELS["godaddy"]).toBe("Website / GoDaddy");
  });
});

/* -------------------------------------------------------------------- recovery */

describe("recovery view", () => {
  it("lists only this business's deleted leads", async () => {
    const db = freshDb();
    db.leads.find((item) => item.id === L1)!.deleted_at = "2025-08-01T00:00:00Z";
    db.leads.find((item) => item.id === FOREIGN)!.deleted_at = "2025-08-01T00:00:00Z";
    const deleted = await listDeletedLeads(createFakeSupabase(db), TENANT);
    expect(deleted.leads.map((row) => row.id)).toEqual([L1]);
    expect(deleted.page.totalCount).toBe(1);
  });

  it("restores a lead in place without creating a duplicate", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db);
    await softDeleteLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      requestId: REQUEST,
      leadIds: [L1],
    });
    const countBefore = db.leads.length;
    const result = await restoreLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      leadIds: [L1],
    });
    expect(result.restored).toBe(1);
    expect(db.leads).toHaveLength(countBefore);
    const row = db.leads.find((item) => item.id === L1)!;
    expect(row.deleted_at).toBeNull();
    expect(row.source_channel).toBe("godaddy");
    expect(row.import_batch_id).toBe("batch-1");
  });

  it("never restores another business's lead", async () => {
    const db = freshDb();
    db.leads.find((item) => item.id === FOREIGN)!.deleted_at = "2025-08-01T00:00:00Z";
    const result = await restoreLeads(createFakeSupabase(db), {
      businessId: TENANT,
      actorUserId: ACTOR,
      leadIds: [FOREIGN],
    });
    expect(result.restored).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(db.leads.find((item) => item.id === FOREIGN)!.deleted_at).toBe("2025-08-01T00:00:00Z");
  });
});
