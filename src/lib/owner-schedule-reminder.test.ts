import { describe, expect, it } from "vitest";
import { renderOwnerScheduleReminder, reminderRequestKeyMaterial } from "./owner-schedule-reminder";

const booking = (iso: string, name = "Sam") => ({ scheduledAt: iso, customerName: name, serviceName: "Full detail", suburb: "Parramatta" });

describe("owner schedule reminder", () => {
  it("lists bookings in the business timezone with a total", () => {
    const [text] = renderOwnerScheduleReminder({
      label: "Tomorrow",
      timeZone: "Australia/Sydney",
      bookings: [booking("2026-10-24T22:00:00Z")],
    });
    expect(text).toContain("9:00");
    expect(text).toContain("Total: 1 booking.");
  });

  it("splits long schedules into several texts without dropping bookings", () => {
    const bookings = Array.from({ length: 40 }, (_, i) => booking(new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), `Customer ${i}`));
    const parts = renderOwnerScheduleReminder({ label: "Month", timeZone: "Australia/Sydney", bookings });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(450);
    for (let i = 0; i < 40; i++) expect(parts.join("\n")).toContain(`Customer ${i} `);
    expect(parts.at(-1)).toContain("Total: 40 bookings.");
  });

  it("says when there are no bookings", () => {
    expect(renderOwnerScheduleReminder({ label: "Today", timeZone: "Australia/Sydney", bookings: [] })[0]).toContain("No bookings scheduled.");
  });

  it("treats the same request within a minute as one reminder", () => {
    const a = reminderRequestKeyMaterial({ sendAt: "2026-10-25T08:00:10+11:00", rangeStart: "2026-10-25T00:00:00+11:00", rangeEnd: "2026-10-26T00:00:00+11:00" });
    const b = reminderRequestKeyMaterial({ sendAt: "2026-10-25T08:00:40+11:00", rangeStart: "2026-10-25T00:00:00+11:00", rangeEnd: "2026-10-26T00:00:00+11:00" });
    expect(a).toBe(b);
  });
});
