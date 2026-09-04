// Hardening tests for the Glocast Full Detail pilot booking path in the public
// AI quote chat. Everything runs against an in-memory stand-in for the database
// plus a faithful re-implementation of the `commit_web_chat_booking` routine, so
// conflict, expiry, resume and replay behaviour is asserted on state rather than
// on the UI.
//
// The suite also asserts the hard boundary of this path: no SMS row, no provider
// call, no AI usage event, no automation job and no owner notification is ever
// written while a web-chat booking is made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeDb } from "@/lib/test-utils/fake-supabase";
import { PILOT_BUSINESS_ID } from "@/lib/web-chat-booking";

const OTHER_BUSINESS = "22222222-2222-2222-2222-222222222222";
const SERVICE_ID = "710cdf04-aae0-48e3-b84a-0e01ccec1da8";
const LEAD_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const LEAD_B = "aaaaaaaa-0000-4000-8000-00000000000b";
const FOREIGN_LEAD = "bbbbbbbb-0000-4000-8000-00000000000b";
const NOW = "2026-09-07T00:00:00.000Z"; // Mon 7 Sep, 10:00 am Sydney

/** Side-effect tables that must stay untouched by the web booking path. */
const FORBIDDEN_TABLES = ["messages", "ai_usage_events", "automation_jobs", "notifications"] as const;

type Row = Record<string, any>;

function lead(id: string, businessId = PILOT_BUSINESS_ID): Row {
  return {
    id,
    business_id: businessId,
    name: "Sam",
    mobile_number: "+61447852565",
    status: "new",
    opted_out_at: null,
    sms_suppressed_at: null,
    deleted_at: null,
    approved_service_id: SERVICE_ID,
    service_name_snapshot: "Full Interior Detail",
    requires_owner_review: false,
  };
}

function seed(): FakeDb {
  return {
    businesses: [
      {
        id: PILOT_BUSINESS_ID,
        name: "Glocast Detailing",
        timezone: "Australia/Sydney",
        quiet_hours_start: 21,
        quiet_hours_end: 8,
      },
      { id: OTHER_BUSINESS, name: "Other", timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 },
    ],
    booking_availability: [
      {
        business_id: PILOT_BUSINESS_ID,
        active: true,
        lead_time_minutes: 120,
        horizon_days: 7,
        offer_ttl_minutes: 120,
        weekly_windows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: "08:00", end: "18:00" })),
      },
    ],
    services: [
      {
        id: SERVICE_ID,
        business_id: PILOT_BUSINESS_ID,
        name: "Full Interior Detail",
        active: true,
        duration_minutes: 120,
      },
    ],
    leads: [lead(LEAD_A), lead(LEAD_B), lead(FOREIGN_LEAD, OTHER_BUSINESS)],
    conversations: [],
    booking_offers: [],
    jobs: [],
    audit_events: [],
    messages: [],
    ai_usage_events: [],
    automation_jobs: [],
    notifications: [],
  };
}

/** Faithful stand-in for the database routine, including the peer/replay rules. */
function commitRoutine(db: FakeDb) {
  return (args: Record<string, any>) => {
    const businessId = args["p_business_id"];
    const leadId = args["p_lead_id"];
    const offers = db["booking_offers"] ?? [];
    const jobs = db["jobs"] ?? [];
    const offer = offers.find(
      (row) => row["id"] === args["p_offer_id"] && row["business_id"] === businessId && row["lead_id"] === leadId,
    );
    if (!offer) return { ok: false, reason: "offer_not_found" };
    if (offer["status"] === "confirmed" && offer["job_id"]) {
      return { ok: true, replay: true, offer_id: offer["id"], job_id: offer["job_id"], slot_start: offer["slot_start"] };
    }
    if (!["offered", "accepted"].includes(offer["status"])) return { ok: false, reason: "offer_closed" };
    if (new Date(offer["expires_at"]).getTime() <= Date.now()) return { ok: false, reason: "offer_expired" };

    const takenOffer = offers.some(
      (row) =>
        row["business_id"] === businessId &&
        row["slot_start"] === offer["slot_start"] &&
        ["accepted", "confirmed"].includes(row["status"]) &&
        row["id"] !== offer["id"],
    );
    const takenJob = jobs.some(
      (row) =>
        row["business_id"] === businessId &&
        row["completion_status"] === "scheduled" &&
        row["scheduled_at"] === offer["slot_start"] &&
        row["lead_id"] !== leadId,
    );
    if (takenOffer || takenJob) return { ok: false, reason: "slot_unavailable" };

    let job = jobs.find((row) => row["business_id"] === businessId && row["lead_id"] === leadId);
    if (!job) {
      job = {
        id: `job-${jobs.length + 1}`,
        business_id: businessId,
        lead_id: leadId,
        service_id: offer["service_id"] ?? null,
        scheduled_at: offer["slot_start"],
        completion_status: "scheduled",
        notes: args["p_idempotency_key"],
      };
      jobs.push(job);
    } else {
      job["scheduled_at"] = offer["slot_start"];
      job["completion_status"] = "scheduled";
    }

    offer["status"] = "confirmed";
    offer["confirmed_at"] = new Date().toISOString();
    offer["job_id"] = job["id"];
    for (const peer of offers) {
      if (peer["business_id"] === businessId && peer["lead_id"] === leadId && peer["status"] === "offered") {
        peer["status"] = "withdrawn";
      }
    }
    const target = (db["leads"] ?? []).find((row) => row["id"] === leadId);
    if (target) target["status"] = "scheduled";

    return { ok: true, replay: false, offer_id: offer["id"], job_id: job["id"], slot_start: offer["slot_start"] };
  };
}

let db: FakeDb;
let supabase: any;

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return supabase;
  },
}));

async function bookingServer() {
  return await import("@/lib/web-chat-booking.server");
}

function offersFor(leadId: string): Row[] {
  return (db["booking_offers"] ?? []).filter((row) => row["lead_id"] === leadId);
}

function confirmedOffers(): Row[] {
  return (db["booking_offers"] ?? []).filter((row) => row["status"] === "confirmed");
}

function forbiddenSideEffects(): number {
  return FORBIDDEN_TABLES.reduce((total, table) => total + (db[table] ?? []).length, 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  db = seed();
  supabase = createFakeSupabase(db, { commit_web_chat_booking: commitRoutine(db) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("pilot booking offers",  () => {
  it("offers server-computed Sydney slots inside the tenant's working windows", async () => {
    const { openBookingStep } = await bookingServer();
    const result = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    expect(result.offered).toBe(true);
    if (!result.offered) return;
    expect(result.offers.length).toBeGreaterThan(0);
    for (const offer of result.offers) {
      const hour = Number(
        new Intl.DateTimeFormat("en-AU", {
          timeZone: "Australia/Sydney",
          hour: "2-digit",
          hour12: false,
        }).format(new Date(offer.slot_start)),
      );
      expect(hour).toBeGreaterThanOrEqual(8);
      expect(hour).toBeLessThan(18);
      // The label is rendered in the tenant timezone, not UTC.
      expect(offer.label).toMatch(/am|pm/);
    }
    expect(forbiddenSideEffects()).toBe(0);
  });

  it("offers any approved active service under booking-only mode, but nothing when the service is inactive", async () => {
    (db["services"] ?? [])[0]!["name"] = "Exterior Wash";
    const { openBookingStep } = await bookingServer();
    const allowed = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    expect(allowed.offered).toBe(true);

    (db["services"] ?? [])[0]!["active"] = false;
    const blocked = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    expect(blocked.offered).toBe(false);
  });

});

describe("scenario 1 — slot conflict", () => {
  it("lets the first customer book and rejects the second safely with fresh options", async () => {
    const { openBookingStep, commitWebChatBooking, refreshBookingOffers } = await bookingServer();
    const first = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    const second = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_B });
    expect(first.offered && second.offered).toBe(true);
    if (!first.offered || !second.offered) return;

    const contested = first.offers[0]!;
    const rival = second.offers.find((offer) => offer.slot_start === contested.slot_start)!;
    expect(rival).toBeTruthy();

    const winner = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: contested.offer_id,
    });
    expect(winner.ok).toBe(true);

    const loser = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_B,
      conversationId: "conv-b",
      offerId: rival.offer_id,
    });
    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.reason).toBe("slot_unavailable");

    // Exactly one job and one confirmed offer, for the winning lead only.
    expect((db["jobs"] ?? []).length).toBe(1);
    expect(confirmedOffers().length).toBe(1);
    expect(confirmedOffers()[0]!["lead_id"]).toBe(LEAD_A);
    expect(offersFor(LEAD_B).every((row) => row["status"] === "offered")).toBe(true);

    // The second conversation continues on the booking step with fresh options
    // that no longer include the taken slot.
    const fresh = await refreshBookingOffers({ businessId: PILOT_BUSINESS_ID, leadId: LEAD_B });
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.some((offer) => offer.slot_start === contested.slot_start)).toBe(false);
    expect(forbiddenSideEffects()).toBe(0);
  });
});

describe("scenario 2 — expired offer", () => {
  it("refuses an expired offer id without reaching the commit routine", async () => {
    const { openBookingStep, commitWebChatBooking, refreshBookingOffers } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");
    const chosen = opened.offers[0]!;
    for (const row of offersFor(LEAD_A)) row["expires_at"] = "2026-09-06T00:00:00.000Z";

    const result = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: chosen.offer_id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("offer_expired");
    expect(supabase.rpcCalls.length).toBe(0);
    expect((db["jobs"] ?? []).length).toBe(0);
    expect(confirmedOffers().length).toBe(0);
    expect((db["leads"] ?? []).filter((row) => row["id"] === LEAD_A).length).toBe(1);

    // The customer is handed fresh options rather than a dead end.
    const fresh = await refreshBookingOffers({ businessId: PILOT_BUSINESS_ID, leadId: LEAD_A });
    expect(fresh.length).toBeGreaterThan(0);
    expect(forbiddenSideEffects()).toBe(0);
  });

  it("refuses an offer that has already been withdrawn", async () => {
    const { openBookingStep, commitWebChatBooking } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");
    offersFor(LEAD_A)[0]!["status"] = "withdrawn";
    const result = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: opened.offers[0]!.offer_id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("offer_closed");
    expect((db["jobs"] ?? []).length).toBe(0);
  });
});

describe("scenario 3 — refresh and resume", () => {
  it("rehydrates only offers that are still live", async () => {
    const { openBookingStep, rehydrateBookingOffers } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");

    const rows = offersFor(LEAD_A);
    rows[0]!["expires_at"] = "2026-09-06T00:00:00.000Z";
    const resumed = await rehydrateBookingOffers({ businessId: PILOT_BUSINESS_ID, leadId: LEAD_A });
    expect(resumed.state).toBe("open");
    if (resumed.state !== "open") return;
    expect(resumed.offers.some((offer) => offer.offer_id === rows[0]!["id"])).toBe(false);
    expect(resumed.offers.length).toBeGreaterThan(0);
  });

  it("reports an already-booked lead instead of offering a second booking", async () => {
    const { openBookingStep, commitWebChatBooking, rehydrateBookingOffers } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");
    await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: opened.offers[0]!.offer_id,
    });
    const resumed = await rehydrateBookingOffers({ businessId: PILOT_BUSINESS_ID, leadId: LEAD_A });
    expect(resumed.state).toBe("already_booked");
    expect((db["jobs"] ?? []).length).toBe(1);
  });

  it("returns nothing for a lead belonging to another tenant", async () => {
    const { rehydrateBookingOffers } = await bookingServer();
    const resumed = await rehydrateBookingOffers({ businessId: PILOT_BUSINESS_ID, leadId: FOREIGN_LEAD });
    expect(resumed.state).toBe("unavailable");
  });
});

describe("scenario 4 — replay and idempotency", () => {
  it("returns the existing booking on a replayed selection", async () => {
    const { openBookingStep, commitWebChatBooking } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");
    const chosen = opened.offers[1] ?? opened.offers[0]!;

    const first = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: chosen.offer_id,
    });
    const replay = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_A,
      conversationId: "conv-a",
      offerId: chosen.offer_id,
    });

    expect(first.ok && replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.jobId).toBe(first.jobId);
    // The replay short-circuits before the transaction, so peers are not
    // reprocessed and nothing is written twice.
    expect(supabase.rpcCalls.length).toBe(1);
    expect((db["jobs"] ?? []).length).toBe(1);
    expect(confirmedOffers().length).toBe(1);
    expect(offersFor(LEAD_A).filter((row) => row["status"] === "withdrawn").length).toBe(
      offersFor(LEAD_A).length - 1,
    );
    expect(forbiddenSideEffects()).toBe(0);
  });

  it("keeps offer generation idempotent across repeated opens", async () => {
    const { openBookingStep } = await bookingServer();
    const first = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    const second = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!first.offered || !second.offered) throw new Error("expected offers");
    expect(offersFor(LEAD_A).length).toBe(first.offers.length);
    expect(second.offers.map((offer) => offer.offer_id).sort()).toEqual(
      first.offers.map((offer) => offer.offer_id).sort(),
    );
  });
});

describe("cross-tenant rejection", () => {
  it("cannot commit an offer created for another business", async () => {
    const { openBookingStep, commitWebChatBooking } = await bookingServer();
    const opened = await openBookingStep({ businessId: PILOT_BUSINESS_ID, slug: "glocast", leadId: LEAD_A });
    if (!opened.offered) throw new Error("expected offers");
    const stolen = opened.offers[0]!.offer_id;

    const wrongTenant = await commitWebChatBooking({
      businessId: OTHER_BUSINESS,
      leadId: LEAD_A,
      conversationId: "conv-x",
      offerId: stolen,
    });
    expect(wrongTenant.ok).toBe(false);
    if (wrongTenant.ok) return;
    expect(wrongTenant.reason).toBe("cross_tenant");

    const wrongLead = await commitWebChatBooking({
      businessId: PILOT_BUSINESS_ID,
      leadId: LEAD_B,
      conversationId: "conv-b",
      offerId: stolen,
    });
    expect(wrongLead.ok).toBe(false);
    if (wrongLead.ok) return;
    expect(wrongLead.reason).toBe("offer_not_found");
    expect((db["jobs"] ?? []).length).toBe(0);
    expect(forbiddenSideEffects()).toBe(0);
  });
});
