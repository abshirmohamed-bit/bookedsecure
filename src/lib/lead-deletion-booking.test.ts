import { describe, expect, it } from "vitest";

import {
  authoritativeBookingState,
  bookingPreservationColumns,
  deletionBlockedByBooking,
  reactivationBlocked,
  BOOKED_DELETION_BLOCK_REASON,
} from "@/lib/lead-deletion-booking";
import { restoreLeads, softDeleteLeads } from "@/lib/lead-deletion.server";
import { createFakeSupabase } from "@/lib/test-utils/fake-supabase";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const ACTOR = "22222222-2222-4222-8222-222222222222";

const UNBOOKED = "aaaaaaaa-0000-4000-8000-00000000000a";
const OFFERED = "aaaaaaaa-0000-4000-8000-00000000000b";
const JOBBED = "aaaaaaaa-0000-4000-8000-00000000000c";
const FOREIGN = "bbbbbbbb-0000-4000-8000-00000000000d";

function lead(id: string, overrides: Record<string, any> = {}): Record<string, any> {
  return {
    id,
    business_id: TENANT,
    name: `Lead ${id.slice(-1)}`,
    mobile_number: "+61412345678",
    source_channel: "website",
    lead_origin: "ai_web_chat",
    status: "new",
    booking_status: "none",
    quote_status: "in_progress",
    customer_status: "prospect",
    consent_status: "granted",
    consent_source: "website",
    requires_owner_review: false,
    created_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    deleted_by: null,
    deletion_reason: null,
    deletion_request_id: null,
    ...overrides,
  };
}

function freshDb() {
  return {
    leads: [
      lead(UNBOOKED),
      // A drifted projection: the booking tables say scheduled, the lead does not.
      lead(OFFERED),
      lead(JOBBED),
      lead(FOREIGN, { business_id: OTHER }),
    ],
    conversations: [] as Record<string, any>[],
    messages: [] as Record<string, any>[],
    booking_offers: [
      { id: "o1", business_id: TENANT, lead_id: OFFERED, status: "confirmed" },
      { id: "o2", business_id: TENANT, lead_id: UNBOOKED, status: "declined" },
      { id: "o3", business_id: OTHER, lead_id: FOREIGN, status: "confirmed" },
    ],
    jobs: [{ id: "j1", business_id: TENANT, lead_id: JOBBED, completion_status: "scheduled" }],
    notifications: [] as Record<string, any>[],
    agent_actions: [] as Record<string, any>[],
    sequence_campaigns: [] as Record<string, any>[],
    automation_jobs: [] as Record<string, any>[],
    consent_events: [] as Record<string, any>[],
    lead_deletion_requests: [] as Record<string, any>[],
    audit_events: [] as Record<string, any>[],
  };
}

async function del(client: any, leadIds: string[], requestId: string, extra: any = {}) {
  return softDeleteLeads(client, {
    businessId: TENANT,
    actorUserId: ACTOR,
    requestId,
    leadIds,
    reason: "test",
    allowProtected: true,
    ...extra,
  });
}

type LeadRow = {
  id: string;
  status: string;
  booking_status: string;
  quote_status: string;
  customer_status: string;
  consent_status: string;
  requires_owner_review: boolean;
  deleted_at: string | null;
};

function leadRow(db: { leads: Record<string, any>[] }, id: string): LeadRow {
  return db.leads.find((row) => row["id"] === id) as unknown as LeadRow;
}

const R = (n: number) => `33333333-3333-4333-8333-00000000000${n}`;

describe("booking-aware soft deletion", () => {
  it("1. soft-deleting an unbooked lead preserves its normal non-booked state", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    const result = await del(client, [UNBOOKED], R(1));
    expect(result.deleted).toBe(1);
    const row = leadRow(db, UNBOOKED);
    expect(row.deleted_at).toBeTruthy();
    expect(row.status).toBe("new");
    expect(row.booking_status).toBe("none");
    expect(row.quote_status).toBe("in_progress");
    expect(row.customer_status).toBe("prospect");
    expect(row.consent_status).toBe("granted");
  });

  it("2. soft-deleting a lead with a confirmed offer preserves booking_status = scheduled", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [OFFERED], R(2));
    const row = leadRow(db, OFFERED);
    expect(row.deleted_at).toBeTruthy();
    expect(row.booking_status).toBe("scheduled");
    expect(row.status).toBe("scheduled");
    expect(row.customer_status).toBe("booked_lead");
    // Offer records are untouched.
    expect(db.booking_offers.find((o) => o.lead_id === OFFERED)!.status).toBe("confirmed");
  });

  it("3. soft-deleting a lead with a scheduled job preserves status = scheduled", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [JOBBED], R(3));
    const row = leadRow(db, JOBBED);
    expect(row.status).toBe("scheduled");
    expect(row.booking_status).toBe("scheduled");
    expect(db.jobs).toHaveLength(1);
    expect(db.jobs[0]!.completion_status).toBe("scheduled");
  });

  it("3b. authoritative state comes from the booking tables, not the projection", () => {
    const state = authoritativeBookingState({
      leadId: OFFERED,
      offers: [{ lead_id: OFFERED, status: "confirmed" }],
      jobs: [],
    });
    expect(state).toEqual({
      leadId: OFFERED,
      hasConfirmedOffer: true,
      hasScheduledJob: false,
      booked: true,
    });
    expect(
      authoritativeBookingState({ leadId: UNBOOKED, offers: [{ lead_id: UNBOOKED, status: "declined" }] })
        .booked,
    ).toBe(false);
    expect(
      bookingPreservationColumns(
        { status: "new", booking_status: "none", quote_status: "in_progress", customer_status: "prospect" },
        state,
      ),
    ).toEqual({ status: "scheduled", booking_status: "scheduled", customer_status: "booked_lead" });
  });

  it("4. a deleted booked lead remains blocked from reactivation", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [OFFERED], R(4));
    const row = leadRow(db, OFFERED);
    expect(reactivationBlocked(row)).toBe(true);
    // Deleted alone blocks, booked alone blocks, neither does not.
    expect(reactivationBlocked({ deleted_at: "2026-09-04T00:00:00Z", booking_status: "none" })).toBe(true);
    expect(reactivationBlocked({ deleted_at: null, booking_status: "scheduled" })).toBe(true);
    expect(reactivationBlocked({ deleted_at: null, booking_status: "none" })).toBe(false);
  });

  it("5. restore preserves the scheduled booking projection", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [OFFERED], R(5));
    // Simulate drift while deleted.
    const row = leadRow(db, OFFERED);
    row.status = "new";
    row.booking_status = "none";
    const restored = await restoreLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      leadIds: [OFFERED],
    });
    expect(restored.restored).toBe(1);
    expect(row.deleted_at).toBeNull();
    expect(row.status).toBe("scheduled");
    expect(row.booking_status).toBe("scheduled");
    expect(row.quote_status).toBe("in_progress");
  });

  it("6. deletion cannot reset a booked lead to new or booking_status = none", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [OFFERED, JOBBED], R(6));
    for (const id of [OFFERED, JOBBED]) {
      const row = leadRow(db, id);
      expect(row.status).not.toBe("new");
      expect(row.booking_status).not.toBe("none");
    }
  });

  it("6b. the blocking policy returns a clear reason instead of deleting", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    const result = await del(client, [OFFERED, UNBOOKED], R(7), { blockBookedLeads: true });
    expect(result.deleted).toBe(1);
    expect(result.failures.map((f) => f.leadId)).toEqual([OFFERED]);
    expect(result.failures[0]!.reason).toBe(BOOKED_DELETION_BLOCK_REASON);
    expect(leadRow(db, OFFERED).deleted_at).toBeNull();
    expect(leadRow(db, UNBOOKED).deleted_at).toBeTruthy();
    expect(deletionBlockedByBooking({ leadId: OFFERED, hasConfirmedOffer: true, hasScheduledJob: false, booked: true })).toBe(false);
  });

  it("7. tenant isolation is enforced", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    const result = await del(client, [FOREIGN], R(8));
    expect(result.deleted).toBe(0);
    expect(result.failures[0]!.reason).toBe("Lead not found for this business");
    const foreign = leadRow(db, FOREIGN);
    expect(foreign.deleted_at).toBeNull();
    expect(foreign.status).toBe("new");
    const restore = await restoreLeads(client, {
      businessId: TENANT,
      actorUserId: ACTOR,
      leadIds: [FOREIGN],
    });
    expect(restore.restored).toBe(0);
  });

  it("8. no SMS, campaign, automation, consent, owner-review, offer or job side effects", async () => {
    const db = freshDb();
    const client = createFakeSupabase(db as never);
    await del(client, [OFFERED, JOBBED, UNBOOKED], R(9));
    await restoreLeads(client, { businessId: TENANT, actorUserId: ACTOR, leadIds: [OFFERED] });

    const written = new Set(
      (client.writes as { table: string; op: string }[])
        .filter((w) => w.op !== "select")
        .map((w) => w.table),
    );
    expect(written).toEqual(new Set(["leads", "lead_deletion_requests", "audit_events"]));
    expect(db.messages).toHaveLength(0);
    expect(db.notifications).toHaveLength(0);
    expect(db.agent_actions).toHaveLength(0);
    expect(db.sequence_campaigns).toHaveLength(0);
    expect(db.automation_jobs).toHaveLength(0);
    expect(db.consent_events).toHaveLength(0);
    expect(db.booking_offers).toHaveLength(3);
    expect(db.jobs).toHaveLength(1);
    for (const row of db.leads) {
      expect(row["consent_status"]).toBe("granted");
      expect(row["requires_owner_review"]).toBe(false);
      expect(row["quote_status"]).toBe("in_progress");
    }
  });
});
