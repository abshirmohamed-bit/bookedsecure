/**
 * Wall-clock helpers for the owner assistant.
 *
 * The assistant is told the tenant's own local date and time, and it hands back
 * a local date plus a local time. These helpers convert between that wall time
 * and UTC using the tenant's timezone, so a booking is stored at the moment the
 * owner actually meant. Pure: no reads, no writes, no tenant special-casing.
 */

const DEFAULT_TIME_ZONE = "Australia/Sydney";

export function assistantTimeZone(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (value.length === 0) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function zonedParts(instant: Date, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  // Midnight is reported as hour 24 by some runtimes.
  if (parts["hour"] === 24) parts["hour"] = 0;
  return parts;
}

/** Minutes the zone is ahead of UTC at that instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * Turns a local date ("2026-09-19") and local time ("09:00") in the tenant's
 * timezone into a UTC ISO timestamp. Returns null when either value is not a
 * real date or time, so nothing is ever booked at a guessed moment.
 */
export function zonedWallTimeToIso(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec((date ?? "").trim());
  const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((time ?? "09:00").trim());
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59) return null;

  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(guess)) return null;
  // Two passes settle daylight-saving boundaries.
  let instant = guess - offsetMinutes(new Date(guess), timeZone) * 60000;
  instant = guess - offsetMinutes(new Date(instant), timeZone) * 60000;
  const result = new Date(instant);
  if (Number.isNaN(result.getTime())) return null;
  // Reject a rolled-over date such as 31 February.
  const back = zonedParts(result, timeZone);
  if (back["day"] !== day || back["month"] !== month) return null;
  return result.toISOString();
}

/** The tenant's own local date, time and weekday right now. */
export function nowInZone(
  timeZone: string,
  now: Date = new Date(),
): { date: string; time: string; weekday: string } {
  const parts = zonedParts(now, timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  const weekday = new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "long" }).format(now);
  return {
    date: `${parts["year"]}-${pad(parts["month"] ?? 1)}-${pad(parts["day"] ?? 1)}`,
    time: `${pad(parts["hour"] ?? 0)}:${pad(parts["minute"] ?? 0)}`,
    weekday,
  };
}

/** Owner-readable local date and time, e.g. "Sat 19 Sept, 9:00 am". */
export function formatInZone(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}
