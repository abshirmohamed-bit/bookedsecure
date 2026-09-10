import { describe, expect, it } from "vitest";
import {
  bookingState,
  bookingStateText,
  customerLabel,
  groupByDay,
  monthGrid,
  resolveServiceName,
  shiftMonth,
  upcomingBookings,
  type BookingEntry,
} from "@/lib/bookings";

function entry(overrides: Partial<BookingEntry>): BookingEntry {
  return {
    jobId: "job",
    leadId: "lead",
    customerName: "Sam",
    phone: null,
    serviceName: null,
    scheduledAt: "2026-09-12T01:00:00.000Z",
    state: "scheduled",
    completedValue: null,
    completedAt: null,
    address: null,
    suburb: null,
    notes: null,
    ...overrides,
  };
}

describe("booking state", () => {
  it("maps stored completion status", () => {
    expect(bookingState("completed")).toBe("completed");
    expect(bookingState("cancelled")).toBe("cancelled");
    expect(bookingState("scheduled")).toBe("scheduled");
    expect(bookingState(null)).toBe("scheduled");
    expect(bookingStateText("completed")).toBe("Completed");
  });
});

describe("service name", () => {
  it("prefers the performed service, then the booked snapshot, then the enquiry", () => {
    expect(resolveServiceName({ servicePerformed: "Full detail", offerServiceName: "Interior" })).toBe(
      "Full detail",
    );
    expect(resolveServiceName({ servicePerformed: " ", offerServiceName: "Interior" })).toBe("Interior");
    expect(resolveServiceName({ leadServiceIntent: "Wash" })).toBe("Wash");
    expect(resolveServiceName({})).toBeNull();
  });

  it("never shows a blank customer", () => {
    expect(customerLabel(" ")).toBe("Unnamed customer");
    expect(customerLabel("Andrew")).toBe("Andrew");
  });
});

describe("calendar layout", () => {
  it("always renders six Monday-start weeks", () => {
    const cells = monthGrid(2026, 8);
    expect(cells).toHaveLength(42);
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(30);
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, monthIndex: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, monthIndex: 0 });
  });

  it("groups bookings by local day, earliest first", () => {
    const groups = groupByDay(
      [
        entry({ jobId: "b", scheduledAt: "2026-09-12T04:00:00.000Z" }),
        entry({ jobId: "a", scheduledAt: "2026-09-12T01:00:00.000Z" }),
        entry({ jobId: "c", scheduledAt: null }),
      ],
      "UTC",
    );
    expect(groups.get("2026-09-12")?.map((item) => item.jobId)).toEqual(["a", "b"]);
    expect([...groups.keys()]).toHaveLength(1);
  });
});

describe("upcoming bookings", () => {
  it("keeps only future scheduled jobs", () => {
    const list = upcomingBookings(
      [
        entry({ jobId: "past", scheduledAt: "2026-09-01T01:00:00.000Z" }),
        entry({ jobId: "done", state: "completed", scheduledAt: "2026-09-20T01:00:00.000Z" }),
        entry({ jobId: "next", scheduledAt: "2026-09-15T01:00:00.000Z" }),
      ],
      "2026-09-10T00:00:00.000Z",
    );
    expect(list.map((item) => item.jobId)).toEqual(["next"]);
  });
});
