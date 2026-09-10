/**
 * Bookings calendar: pure logic only.
 *
 * The booking tables are authoritative (`jobs` holds the confirmed start time,
 * `booking_offers` holds the service name that was booked). Nothing here reads,
 * writes, sends or books, and no tenant is special-cased.
 */

export type BookingState = "scheduled" | "completed" | "cancelled";

export type BookingEntry = {
  jobId: string;
  leadId: string;
  customerName: string | null;
  phone: string | null;
  /** Booked service name, already resolved with its fallback. */
  serviceName: string | null;
  scheduledAt: string | null;
  state: BookingState;
  completedValue: number | null;
  completedAt: string | null;
  address: string | null;
  suburb: string | null;
  notes: string | null;
};

/** Normalises the stored completion status into the three states we show. */
export function bookingState(completionStatus: string | null | undefined): BookingState {
  const value = (completionStatus ?? "").toLowerCase();
  if (value === "completed") return "completed";
  if (value === "cancelled" || value === "canceled") return "cancelled";
  return "scheduled";
}

export function bookingStateText(state: BookingState): string {
  switch (state) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "Scheduled";
  }
}

/**
 * The service name shown on a booking. A scheduled job has no
 * `service_performed` yet (that column is only written on completion), so the
 * confirmed offer's snapshot is used, then the lead's requested service.
 */
export function resolveServiceName(
  parts: {
    servicePerformed?: string | null;
    offerServiceName?: string | null;
    leadServiceIntent?: string | null;
  },
): string | null {
  const candidates = [parts.servicePerformed, parts.offerServiceName, parts.leadServiceIntent];
  for (const candidate of candidates) {
    const text = (candidate ?? "").trim();
    if (text.length > 0) return text;
  }
  return null;
}

/** Name shown on a card; never blank. */
export function customerLabel(name: string | null | undefined): string {
  const text = (name ?? "").trim();
  return text.length > 0 ? text : "Unnamed customer";
}

/** Local calendar day of an instant, as YYYY-MM-DD, in the given time zone. */
export function dayKey(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
  return parts;
}

export function timeLabel(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  })
    .format(date)
    .toLowerCase();
}

export function longDateLabel(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(timeZone ? { timeZone } : {}),
  }).format(date);
}

/** Bookings for one calendar day, earliest first. */
export function groupByDay(
  entries: readonly BookingEntry[],
  timeZone?: string | null,
): Map<string, BookingEntry[]> {
  const groups = new Map<string, BookingEntry[]>();
  for (const entry of entries) {
    if (!entry.scheduledAt) continue;
    const key = dayKey(entry.scheduledAt, timeZone);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  }
  return groups;
}

export type CalendarCell = { key: string; day: number; inMonth: boolean };

/**
 * Six-week Monday-start grid covering the given month, so the grid height never
 * jumps between months.
 */
export function monthGrid(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const offset = (first.getUTCDay() + 6) % 7; // Monday = 0
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(year, monthIndex, 1 - offset + index));
    cells.push({
      key: date.toISOString().slice(0, 10),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === ((monthIndex % 12) + 12) % 12,
    });
  }
  return cells;
}

export function monthLabel(year: number, monthIndex: number): string {
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, monthIndex, 1)),
  );
}

/** Adds months, keeping the result a valid year/month pair. */
export function shiftMonth(
  year: number,
  monthIndex: number,
  delta: number,
): { year: number; monthIndex: number } {
  const total = year * 12 + monthIndex + delta;
  return { year: Math.floor(total / 12), monthIndex: ((total % 12) + 12) % 12 };
}

/** Scheduled bookings from now on, earliest first. */
export function upcomingBookings(
  entries: readonly BookingEntry[],
  nowIso: string,
): BookingEntry[] {
  return entries
    .filter(
      (entry) => entry.state === "scheduled" && entry.scheduledAt && entry.scheduledAt >= nowIso,
    )
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
