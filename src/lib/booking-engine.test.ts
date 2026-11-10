import { describe, expect, it } from "vitest";
import { isSlotStillAvailable, resolveAvailableSlots, type AvailabilityConfig } from "@/lib/availability";
import {
  bookingRequestSchema,
  parseSizeOptions,
  priceKindOf,
  quoteBooking,
  readIdempotencyKey,
  type CatalogAddon,
  type CatalogService,
} from "@/lib/booking-engine";
import { reminderDecision, renderCustomerReminder } from "@/lib/customer-reminder";

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const ADDON_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ADDON = "33333333-3333-4333-8333-333333333333";

const fullDetail: CatalogService = {
  id: SERVICE_ID,
  name: "Full Detail",
  price_guidance: "$229",
  duration_minutes: 180,
  size_options: [],
};
const addons: CatalogAddon[] = [
  { id: ADDON_ID, name: "Leather Protection", price_guidance: "$150.00", duration_minutes: 60, serviceIds: [SERVICE_ID] },
  { id: OTHER_ADDON, name: "Engine Bay", price_guidance: "On enquiry", duration_minutes: 30, serviceIds: ["someone-else"] },
];

describe("booking quotes", () => {
  it("adds the package, add-ons and lengths from the business's own catalogue", () => {
    const result = quoteBooking({ service: fullDetail, addonIds: [ADDON_ID], addons });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quote.price).toEqual({ amount: 379, kind: "exact", currency: "AUD", label: "$379" });
    expect(result.quote.duration_minutes).toBe(240);
  });

  it("uses the size's own price and length when the service is priced by size", () => {
    const sized = { ...fullDetail, size_options: parseSizeOptions([
      { label: "Small car", price: 229, duration_minutes: 180 },
      { label: "Large SUV", price: 289, duration_minutes: 240 },
    ]) };
    expect(quoteBooking({ service: sized, addons })).toEqual({ ok: false, error: "size_required" });
    const result = quoteBooking({ service: sized, sizeKey: "large-suv", addons });
    expect(result.ok && result.quote.price.amount).toBe(289);
    expect(result.ok && result.quote.duration_minutes).toBe(240);
    expect(quoteBooking({ service: sized, sizeKey: "bus", addons })).toMatchObject({ ok: false, error: "size_not_found" });
  });

  it("never invents a price: no figure means the business confirms it", () => {
    const onEnquiry = { ...fullDetail, price_guidance: "On enquiry" };
    const result = quoteBooking({ service: onEnquiry, addons });
    expect(result.ok && result.quote.price).toMatchObject({ amount: null, kind: "on_request" });
    expect(priceKindOf("from $149")).toBe("from");
    expect(priceKindOf("$230 - $320")).toBe("from");
    expect(priceKindOf("$129.99")).toBe("exact");
  });

  it("refuses add-ons that aren't offered with the package, and packages without a length", () => {
    expect(quoteBooking({ service: fullDetail, addonIds: [OTHER_ADDON], addons })).toMatchObject({ ok: false, error: "addon_not_available" });
    expect(quoteBooking({ service: { ...fullDetail, duration_minutes: null }, addons })).toEqual({ ok: false, error: "duration_missing" });
    expect(quoteBooking({ service: null, addons })).toEqual({ ok: false, error: "service_not_found" });
  });
});

const config: AvailabilityConfig = {
  timezone: "Australia/Sydney",
  active: true,
  leadTimeMinutes: 0,
  horizonDays: 3,
  offerTtlMinutes: 120,
  // Wednesday 8am to 4pm.
  weeklyWindows: [{ weekday: 3, start: "08:00", end: "16:00" }],
  quietHoursStart: 21,
  quietHoursEnd: 7,
  bufferMinutes: 30,
};
// Tuesday 10 Nov 2026, 9am Sydney (UTC+11).
const now = new Date("2026-11-09T22:00:00Z");
const nineAm = "2026-11-10T22:00:00.000Z"; // Wed 11 Nov 9:00 am
const elevenAm = "2026-11-11T00:00:00.000Z"; // Wed 11 Nov 11:00 am

describe("availability with job lengths, travel buffers and blocked time", () => {
  it("steps start times by the chosen spacing, not the job length", () => {
    const slots = resolveAvailableSlots({ config, slotMinutes: 120, stepMinutes: 30, now, limit: 50 });
    expect(slots.slice(0, 3).map((slot) => slot.start)).toEqual(["2026-11-10T21:00:00.000Z", "2026-11-10T21:30:00.000Z", "2026-11-10T22:00:00.000Z"]);
    // Last start that still finishes by 4pm.
    expect(slots.at(-1)?.start).toBe("2026-11-11T03:00:00.000Z");
  });

  it("keeps a booked job and the travel buffer either side free", () => {
    const busy = [{ start: nineAm, end: elevenAm, kind: "job" as const }];
    const labels = resolveAvailableSlots({ config, slotMinutes: 60, stepMinutes: 30, now, busy, limit: 50 }).map((slot) => slot.start);
    // 7:30-8:30 overlaps the 30-minute buffer before 9:00; 11:00 is inside the buffer after.
    expect(labels).not.toContain("2026-11-10T21:00:00.000Z");
    expect(labels).not.toContain("2026-11-10T22:30:00.000Z");
    expect(labels).not.toContain("2026-11-11T00:00:00.000Z");
    expect(labels).toContain("2026-11-11T00:30:00.000Z");
  });

  it("blocked time is exact: no travel buffer around it", () => {
    const busy = [{ start: nineAm, end: elevenAm, kind: "block" as const }];
    const labels = resolveAvailableSlots({ config, slotMinutes: 60, stepMinutes: 30, now, busy, limit: 50 }).map((slot) => slot.start);
    expect(labels).toContain("2026-11-10T21:00:00.000Z");
    expect(labels).toContain("2026-11-11T00:00:00.000Z");
    expect(labels).not.toContain("2026-11-10T23:00:00.000Z");
  });

  it("re-checks a chosen time against the same rules before booking", () => {
    const busy = [{ start: nineAm, end: elevenAm, kind: "job" as const }];
    expect(isSlotStillAvailable({ config, slotMinutes: 60, stepMinutes: 30, now, busy, slotStart: elevenAm }).available).toBe(false);
    expect(isSlotStillAvailable({ config, slotMinutes: 60, stepMinutes: 30, now, busy, slotStart: "2026-11-11T00:30:00.000Z" }).available).toBe(true);
    // Off the start-time grid: refused.
    expect(isSlotStillAvailable({ config, slotMinutes: 60, stepMinutes: 30, now, slotStart: "2026-11-11T00:10:00.000Z" }).available).toBe(false);
  });

  it("keeps the quote chat's behaviour when no new options are passed", () => {
    const { bufferMinutes: _ignored, ...plain } = config;
    const slots = resolveAvailableSlots({ config: plain, slotMinutes: 120, now, limit: 10 });
    expect(slots.map((slot) => slot.start)).toEqual([
      "2026-11-10T21:00:00.000Z", "2026-11-10T23:00:00.000Z", "2026-11-11T01:00:00.000Z", "2026-11-11T03:00:00.000Z",
    ]);
  });
});

describe("booking requests", () => {
  it("requires an idempotency key of a sensible length", () => {
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "web-7f3a9c21" }))).toBe("web-7f3a9c21");
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "short" }))).toBeNull();
    expect(readIdempotencyKey(new Headers())).toBeNull();
  });

  it("validates the customer and the chosen time", () => {
    const ok = bookingRequestSchema.safeParse({
      service_id: SERVICE_ID,
      starts_at: elevenAm,
      customer: { name: "Sam", mobile: "0412 345 678" },
      sms_consent: true,
    });
    expect(ok.success).toBe(true);
    expect(bookingRequestSchema.safeParse({ service_id: SERVICE_ID, starts_at: "tomorrow", customer: { name: "Sam", mobile: "0412345678" } }).success).toBe(false);
  });
});

describe("customer reminders", () => {
  const job = { scheduled_at: "2026-11-11T00:00:00.000Z", created_at: "2026-11-01T00:00:00.000Z", completion_status: "scheduled" };
  it("sends once the reminder window opens, and skips bookings made inside it", () => {
    expect(reminderDecision(job, 24, new Date("2026-11-09T23:00:00Z"))).toBe("not_yet");
    expect(reminderDecision(job, 24, new Date("2026-11-10T01:00:00Z"))).toBe("due");
    expect(reminderDecision({ ...job, created_at: "2026-11-10T12:00:00Z" }, 24, new Date("2026-11-10T13:00:00Z"))).toBe("skip_booked_late");
    expect(reminderDecision({ ...job, completion_status: "cancelled" }, 24, new Date("2026-11-10T01:00:00Z"))).toBe("skip_not_scheduled");
  });

  it("writes the reminder in the business's timezone", () => {
    const text = renderCustomerReminder({ customerName: "Sam Lee", businessName: "Glocast", serviceName: "Full Detail", startsAt: job.scheduled_at, timezone: "Australia/Sydney" });
    expect(text).toContain("Hi Sam");
    expect(text).toContain("Full Detail with Glocast");
    expect(text).toContain("Wednesday 11 November");
    expect(text).toContain("Reply STOP to opt out");
  });
});
