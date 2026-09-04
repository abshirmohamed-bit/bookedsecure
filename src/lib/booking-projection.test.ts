import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  bookingBlocksReactivation,
  bookingProjectionUpToDate,
  bookingStateLabel,
  projectLeadAfterBookingCommit,
  projectLeadAfterBookingNotCommitted,
  type LeadBookingState,
} from "./booking-projection";
import { runSandboxSuite } from "./sandbox/runner";

const MIGRATIONS = "supabase/migrations";

/** Newest migration that redefines the booking commit routine. */
function commitRoutineSql(): string {
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const file of files) {
    const sql = readFileSync(`${MIGRATIONS}/${file}`, "utf8");
    if (sql.includes("FUNCTION public.commit_web_chat_booking")) return sql;
  }
  throw new Error("commit_web_chat_booking migration not found");
}

const base: LeadBookingState = {
  status: "new",
  booking_status: "none",
  quote_status: "in_progress",
  customer_status: "prospect",
};

describe("lead booking projection", () => {
  it("1. a confirmed offer plus scheduled job sets booking_status = scheduled", () => {
    const projected = projectLeadAfterBookingCommit(base);
    expect(projected).toEqual({
      status: "scheduled",
      booking_status: "scheduled",
      customer_status: "booked_lead",
    });
  });

  it("1b. quote_status is never part of the booking commit projection", () => {
    expect(Object.keys(projectLeadAfterBookingCommit(base))).not.toContain("quote_status");
    const sql = commitRoutineSql();
    expect(sql).not.toMatch(/quote_status\s*=/);
  });

  it("1c. a previous customer keeps that label", () => {
    expect(
      projectLeadAfterBookingCommit({ ...base, customer_status: "previous_customer" })
        .customer_status,
    ).toBe("previous_customer");
  });

  it("2. replaying the same commit creates no duplicate job or offer", () => {
    const sql = commitRoutineSql();
    // The replay branch returns the existing job id and inserts nothing.
    const replay = sql.slice(
      sql.indexOf("IF v_offer.status = 'confirmed' AND v_offer.job_id IS NOT NULL THEN"),
      sql.indexOf("'replay', true"),
    );
    expect(replay).not.toContain("INSERT INTO public.jobs");
    expect(replay).not.toContain("INSERT INTO public.booking_offers");
    // It still repairs the lead projection, tenant- and lead-scoped.
    expect(replay).toContain("booking_status = 'scheduled'");
    expect(replay).toContain("AND business_id = p_business_id");
    // Only one job is ever inserted, and only when none exists.
    expect(sql.match(/INSERT INTO public\.jobs/g)?.length).toBe(1);
    expect(sql).toContain("IF v_job_id IS NULL THEN");
  });

  it("2b. an already-projected lead needs no further write on retry", () => {
    expect(bookingProjectionUpToDate({ ...base, status: "scheduled", booking_status: "scheduled" }))
      .toBe(true);
    expect(bookingProjectionUpToDate(base)).toBe(false);
  });

  it("3. declined, withdrawn or expired slots never set scheduled status", () => {
    const declined: LeadBookingState = { ...base, status: "quoted", booking_status: "none" };
    expect(projectLeadAfterBookingNotCommitted(declined)).toEqual(declined);

    const sql = commitRoutineSql();
    // Every failure branch returns immediately, writing nothing.
    for (const reason of ["offer_closed", "offer_expired", "slot_unavailable", "offer_not_found"]) {
      expect(sql).toContain(`RETURN jsonb_build_object('ok', false, 'reason', '${reason}');`);
    }
    // The lead is projected in exactly two places: the replay repair and the
    // successful commit. Both set scheduled, neither runs on a failure path.
    expect(sql.match(/UPDATE public\.leads/g)?.length).toBe(2);
  });

  it("4. failed job creation cannot falsely set scheduled status", () => {
    const sql = commitRoutineSql();
    const commitTail = sql.slice(sql.indexOf("UPDATE public.booking_offers\n     SET status = 'accepted'"));
    // The projection is written only after a job id exists, and a missing job
    // aborts the whole transaction rather than leaving a confirmed offer.
    expect(commitTail.indexOf("RAISE EXCEPTION")).toBeLessThan(
      commitTail.indexOf("UPDATE public.leads"),
    );
    expect(commitTail).toContain("booking job could not be created");
    expect(commitTail.indexOf("SET status = 'confirmed'")).toBeGreaterThan(
      commitTail.indexOf("RAISE EXCEPTION"),
    );
  });

  it("4b. the commit routine has no SMS, campaign, consent or owner-review side effects", () => {
    const sql = commitRoutineSql();
    for (const forbidden of [
      "messages",
      "notifications",
      "agent_actions",
      "sequence_campaigns",
      "automation_jobs",
      "consent_status",
      "consent_record",
      "requires_owner_review",
      "net.http_post",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("5. an existing booked lead cannot enter an SMS reactivation canary", () => {
    expect(bookingBlocksReactivation({ booking_status: "scheduled" })).toBe(true);
    expect(bookingBlocksReactivation({ booking_status: "offered" })).toBe(true);
    expect(bookingBlocksReactivation({ booking_status: "none" })).toBe(false);

    const booked = runSandboxSuite({ testRunId: "booking-projection-regression" }).records.find(
      (r) => r.trace.scenarioId === "S06_existing_booking",
    )!;
    expect(booked.outcome).toBe("SANDBOX_BLOCKED_BOOKING");
    expect(booked.wouldSend).toBe(false);
    expect(booked.gatesFailed.map((g) => g.gate)).toContain("booking_conflict");
  });

  it("6. UI and database show the same booking state", () => {
    const committed = projectLeadAfterBookingCommit(base);
    expect(bookingStateLabel(committed)).toBe("Scheduled");
    expect(bookingStateLabel(base)).toBe("Not booked");
    expect(bookingStateLabel({ booking_status: "offered" })).toBe("Slots offered");
    expect(bookingStateLabel({ booking_status: "completed" })).toBe("Completed");
    expect(bookingStateLabel({ booking_status: "cancelled" })).toBe("Cancelled");
    // Database status and UI label are derived from the same column.
    expect(committed.booking_status).toBe("scheduled");
    expect(committed.status).toBe("scheduled");
  });
});
