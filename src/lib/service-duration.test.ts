// Appointment duration is a per-service, server-side value. There is no
// business-wide fallback and it is never taken from the browser, the customer,
// AI text, price guidance or the description.
import { describe, expect, it } from "vitest";
import { resolveAvailableSlots, type AvailabilityConfig } from "@/lib/availability";
import { assessOfferGeneration, type BookingLead } from "@/lib/booking";
import { isPilotEligible, PILOT_BUSINESS_ID, PILOT_TENANT_SLUG } from "@/lib/web-chat-booking";

const SYDNEY = "Australia/Sydney";

function config(overrides: Partial<AvailabilityConfig> = {}): AvailabilityConfig {
  return {
    timezone: SYDNEY,
    active: true,
    leadTimeMinutes: 0,
    horizonDays: 1,
    offerTtlMinutes: 120,
    weeklyWindows: [{ weekday: 1, start: "09:00", end: "15:00" }],
    quietHoursStart: 21,
    quietHoursEnd: 8,
    ...overrides,
  };
}

const MONDAY = new Date("2025-07-13T12:00:00.000Z"); // Sun 22:00 Sydney → Monday next

function starts(slotMinutes: number) {
  return resolveAvailableSlots({
    config: config(),
    slotMinutes,
    now: MONDAY,
    occupiedStarts: [],
    limit: 10,
  });
}

describe("per-service appointment duration drives slot generation", () => {
  it("different services generate different slots from their own durations", () => {
    const short = starts(60);
    const long = starts(180);
    // 09:00–15:00: six 60-minute slots vs two 180-minute slots.
    expect(short.length).toBe(6);
    expect(long.length).toBe(2);
    expect(new Date(short[0]!.end).getTime() - new Date(short[0]!.start).getTime()).toBe(3_600_000);
    expect(new Date(long[0]!.end).getTime() - new Date(long[0]!.start).getTime()).toBe(10_800_000);
    expect(long.map((slot) => slot.start)).not.toEqual(short.slice(0, 2).map((slot) => slot.start));
  });

  it("uses no global fallback: an absent or invalid duration yields no slots", () => {
    for (const value of [0, -60, 90.5, Number.NaN, undefined as unknown as number]) {
      expect(
        resolveAvailableSlots({
          config: config(),
          slotMinutes: value,
          now: MONDAY,
          occupiedStarts: [],
        }),
      ).toEqual([]);
    }
  });

  it("rejects a client-supplied duration by ignoring anything outside the service value", () => {
    // The resolver only ever sees the server-derived number; a browser value of
    // 15 minutes cannot widen a 180-minute service into more slots.
    const serviceDuration = 180;
    const clientClaim = 15;
    expect(starts(serviceDuration).length).toBeLessThan(starts(clientClaim).length);
    expect(starts(serviceDuration).length).toBe(2);
  });
});

describe("services without a duration are not bookable", () => {
  const lead: BookingLead = {
    id: "lead-1",
    business_id: "biz-1",
    status: "new",
    opted_out_at: null,
    sms_suppressed_at: null,
  };

  it("blocks offer generation when the service has no duration", () => {
    const decision = assessOfferGeneration({
      businessId: "biz-1",
      lead,
      availabilityActive: true,
      serviceDurationMinutes: null,
      slotCount: 3,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("service_duration_missing");
    expect(decision.needsHumanReview).toBe(true);
  });

  it("allows offer generation with a valid positive duration", () => {
    expect(
      assessOfferGeneration({
        businessId: "biz-1",
        lead,
        availabilityActive: true,
        serviceDurationMinutes: 120,
        slotCount: 3,
      }).allowed,
    ).toBe(true);
  });
});

describe("pilot eligibility requires a valid service duration", () => {
  const base = {
    businessId: PILOT_BUSINESS_ID,
    slug: PILOT_TENANT_SLUG,
    approvedServiceId: "710cdf04-aae0-48e3-b84a-0e01ccec1da8",
    serviceName: "Full Interior Detail",
    serviceActive: true,
    serviceDurationMinutes: 120 as number | null,
    availabilityActive: true,
    slotCount: 3,
  };

  it("accepts the verified Full Detail service with its configured duration", () => {
    expect(isPilotEligible(base)).toBe(true);
  });

  it("rejects a missing duration, an inactive service and another tenant", () => {
    expect(isPilotEligible({ ...base, serviceDurationMinutes: null })).toBe(false);
    expect(isPilotEligible({ ...base, serviceActive: false })).toBe(false);
    expect(isPilotEligible({ ...base, businessId: "22222222-2222-2222-2222-222222222222" })).toBe(
      false,
    );
    expect(isPilotEligible({ ...base, slug: "other-tenant" })).toBe(false);
  });
});
