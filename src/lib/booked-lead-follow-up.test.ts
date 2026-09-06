// A confirmed booking ends the follow-up sequence. Pure policy tests plus a
// source tripwire that the two scheduling paths consult the policy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { followUpSuppressedByBooking } from "./booking-projection";

describe("followUpSuppressedByBooking", () => {
  it("suppresses follow-ups once a booking is scheduled", () => {
    expect(followUpSuppressedByBooking({ booking_status: "scheduled", status: "scheduled" })).toBe(true);
  });

  it("suppresses follow-ups for a completed booking", () => {
    expect(followUpSuppressedByBooking({ booking_status: "completed", status: "completed" })).toBe(true);
  });

  it("suppresses follow-ups when only the lead status records the booking", () => {
    expect(followUpSuppressedByBooking({ booking_status: "none", status: "booked" })).toBe(true);
  });

  it("keeps follow-ups for an unbooked lead", () => {
    expect(followUpSuppressedByBooking({ booking_status: "none", status: "new" })).toBe(false);
  });

  it("keeps follow-ups while slots are only offered", () => {
    expect(followUpSuppressedByBooking({ booking_status: "offered", status: "quote_sent" })).toBe(false);
  });
});

describe("scheduling paths consult the policy", () => {
  const engine = readFileSync("src/lib/lead-engine.server.ts", "utf8");

  it("checks the booking state before arming the next follow-up", () => {
    expect(engine).toContain("followUpSuppressedByBooking");
    expect(engine.match(/followUpSuppressedByBooking\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("clears the pending timer when a booking is confirmed", () => {
    expect(readFileSync("src/lib/web-chat-booking.server.ts", "utf8")).toContain(
      "next_follow_up_at: null",
    );
  });
});
