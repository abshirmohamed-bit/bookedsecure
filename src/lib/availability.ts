// Phase 3: deterministic, tenant-scoped availability resolution.
//
// Pure module: no I/O, no AI. The server is the only source of appointment
// times; the model can never invent, widen or reinterpret a slot. Every slot is
// derived from the tenant's own configuration (timezone, weekly bookable
// windows, appointment length, minimum notice, horizon) and then filtered by
// quiet hours and slots that are already taken.
//
// businesses.opening_hours is free text and is deliberately NOT treated as
// bookable time. Bookable time only comes from booking_availability.

import { isQuietHour } from "@/lib/domain";

export const MAX_OFFERED_SLOTS = 3;

export type AvailabilityWindow = {
  /** 0 = Sunday … 6 = Saturday, matching Date#getUTCDay. */
  weekday: number;
  /** Local wall-clock "HH:MM" in the tenant timezone. */
  start: string;
  end: string;
};

export type AvailabilityConfig = {
  /** Tenant timezone (IANA). Required — never defaulted silently. */
  timezone: string;
  active: boolean;
  leadTimeMinutes: number;
  horizonDays: number;
  offerTtlMinutes: number;
  weeklyWindows: AvailabilityWindow[];
  quietHoursStart: number;
  quietHoursEnd: number;
};

export type AvailableSlot = {
  /** UTC instant, ISO 8601. The canonical identity of a slot. */
  start: string;
  end: string;
  /** Tenant-local human label, e.g. "Tue 2 Sep, 9:00 am". */
  label: string;
  weekday: number;
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseTimeOfDay(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function isValidTimezone(timezone: unknown): boolean {
  if (typeof timezone !== "string" || timezone.trim().length === 0) return false;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Normalises stored jsonb into validated windows. Invalid entries are dropped. */
export function parseWeeklyWindows(value: unknown): AvailabilityWindow[] {
  if (!Array.isArray(value)) return [];
  const windows: AvailabilityWindow[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const weekday = Number(raw["weekday"]);
    const start = parseTimeOfDay(raw["start"]);
    const end = parseTimeOfDay(raw["end"]);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (start === null || end === null || end <= start) continue;
    windows.push({ weekday, start: raw["start"] as string, end: raw["end"] as string });
  }
  return windows.sort((a, b) =>
    a.weekday === b.weekday
      ? (parseTimeOfDay(a.start) ?? 0) - (parseTimeOfDay(b.start) ?? 0)
      : a.weekday - b.weekday,
  );
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function zonedParts(timezone: string, at: Date): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
  };
}

function offsetMs(timezone: string, at: Date): number {
  const parts = zonedParts(timezone, at);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  // Second precision is enough: no supported zone has sub-minute offsets.
  return asUtc - Math.floor(at.getTime() / 60000) * 60000;
}

/**
 * Converts a tenant-local wall-clock time to a UTC instant.
 *
 * Returns null when the wall-clock time does not exist in that zone (the
 * spring-forward DST gap), so such a slot is never offered. Ambiguous
 * repeated times (autumn fall-back) resolve deterministically to the first
 * occurrence.
 */
export function zonedWallClockToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
): Date | null {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let instant = naive - offsetMs(timezone, new Date(naive));
  instant = naive - offsetMs(timezone, new Date(instant));
  const check = zonedParts(timezone, new Date(instant));
  if (
    check.year !== year ||
    check.month !== month ||
    check.day !== day ||
    check.hour !== hour ||
    check.minute !== minute
  ) {
    return null;
  }
  return new Date(instant);
}

function labelFor(timezone: string, at: Date): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(at)
    .replace(/\u202f/g, " ");
}

function addLocalDays(parts: Parts, days: number): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function weekdayOf(date: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export type ResolveInput = {
  config: AvailabilityConfig;
  /**
   * Appointment length in minutes. Always the selected approved service's
   * server-side `duration_minutes` — there is no business-wide fallback and it
   * is never taken from the browser, the customer or model text.
   */
  slotMinutes: number;
  now: Date;
  /** ISO starts already taken for this tenant (booked jobs + accepted offers). */
  occupiedStarts?: readonly string[];
  limit?: number;
};

/**
 * The single availability resolver. Anything not returned here is not bookable.
 * An inactive configuration, an invalid timezone or no windows yields no slots.
 */
export function resolveAvailableSlots(input: ResolveInput): AvailableSlot[] {
  const { config, now } = input;
  const slotMinutes = input.slotMinutes;
  if (!config.active) return [];
  if (!isValidTimezone(config.timezone)) return [];
  const windows = parseWeeklyWindows(config.weeklyWindows);
  if (windows.length === 0) return [];
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) return [];

  const occupied = new Set(
    (input.occupiedStarts ?? []).map((value) => new Date(value).toISOString()),
  );
  const earliest = now.getTime() + Math.max(0, config.leadTimeMinutes) * 60_000;
  const limit = input.limit ?? MAX_OFFERED_SLOTS;
  const today = zonedParts(config.timezone, now);
  const slots: AvailableSlot[] = [];

  for (let dayOffset = 0; dayOffset <= config.horizonDays && slots.length < limit; dayOffset += 1) {
    const date = addLocalDays(today, dayOffset);
    const weekday = weekdayOf(date);
    for (const window of windows.filter((entry) => entry.weekday === weekday)) {
      const windowStart = parseTimeOfDay(window.start)!;
      const windowEnd = parseTimeOfDay(window.end)!;
      for (
        let minutes = windowStart;
        minutes + slotMinutes <= windowEnd;
        minutes += slotMinutes
      ) {
        if (slots.length >= limit) break;
        const start = zonedWallClockToUtc(config.timezone, date.year, date.month, date.day, minutes);
        if (!start) continue; // non-existent local time (DST gap)
        if (start.getTime() < earliest) continue;
        const end = new Date(start.getTime() + slotMinutes * 60_000);

        // Quiet hours apply to the whole appointment window, in tenant time.
        const startHour = zonedParts(config.timezone, start).hour;
        const lastHour = zonedParts(config.timezone, new Date(end.getTime() - 60_000)).hour;
        if (
          isQuietHour(startHour, config.quietHoursStart, config.quietHoursEnd) ||
          isQuietHour(lastHour, config.quietHoursStart, config.quietHoursEnd)
        ) {
          continue;
        }
        if (occupied.has(start.toISOString())) continue;

        slots.push({
          start: start.toISOString(),
          end: end.toISOString(),
          label: labelFor(config.timezone, start),
          weekday,
        });
      }
    }
  }
  return slots;
}

/**
 * Authoritative slot check. A slot is valid only when the resolver would offer
 * it right now — so an expired, malformed, out-of-hours or occupied slot is
 * rejected even if it was once offered.
 */
export function isSlotStillAvailable(
  input: ResolveInput & { slotStart: string },
): { available: boolean; slot: AvailableSlot | null } {
  const time = new Date(input.slotStart).getTime();
  if (Number.isNaN(time)) return { available: false, slot: null };
  const target = new Date(time).toISOString();
  const slots = resolveAvailableSlots({
    ...input,
    // Scan the full horizon, not just the offer shortlist.
    limit: Number.MAX_SAFE_INTEGER,
  });
  const slot = slots.find((candidate) => candidate.start === target) ?? null;
  return { available: Boolean(slot), slot };
}

export function describeAvailability(config: AvailabilityConfig): string {
  if (!config.active) return "Bookable availability is switched off — no slots are offered.";
  const windows = parseWeeklyWindows(config.weeklyWindows);
  if (windows.length === 0) return "No bookable windows configured — no slots are offered.";
  return windows
    .map((window) => `${WEEKDAY_LABELS[window.weekday]} ${window.start}–${window.end}`)
    .join(", ");
}
