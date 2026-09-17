/**
 * Converting between what an owner types into a date/time field and the UTC
 * instant stored in the database.
 *
 * A `<input type="datetime-local">` value has no timezone ("2026-09-18T09:00").
 * Passing it to `new Date(...)` on the server reads it in the server's zone
 * (UTC), so 9:00 am Sydney was being stored as 9:00 am UTC — 7:00 pm Sydney.
 * Every conversion in both directions goes through this module instead.
 */

export const DEFAULT_TIME_ZONE = "Australia/Sydney";

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Minutes that `timeZone` is ahead of UTC at the given instant (DST aware). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second"),
  );
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * Turns a naive "YYYY-MM-DDTHH:mm" value typed in `timeZone` into a UTC ISO
 * string. Values that already carry a zone (trailing `Z` or `+10:00`) are
 * passed through unchanged, so API callers are unaffected.
 */
export function localDateTimeToIso(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const trimmed = value.trim();
  const match = LOCAL_INPUT.exec(trimmed);
  if (!match) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) throw new Error("That date and time could not be read.");
    return parsed.toISOString();
  }

  const [, year, month, day, hour, minute, second] = match;
  const naiveUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );

  // Two passes so the hour lands correctly across a daylight-saving change:
  // the first guess picks an offset, the second confirms it for that instant.
  let guess = new Date(naiveUtc - zoneOffsetMinutes(new Date(naiveUtc), timeZone) * 60_000);
  guess = new Date(naiveUtc - zoneOffsetMinutes(guess, timeZone) * 60_000);
  return guess.toISOString();
}

/** Formats a stored UTC timestamp back into a `datetime-local` field value. */
export function isoToLocalDateTimeInput(
  iso: string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  if (!iso) return "";
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "";
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/** Today's date in the business timezone, as a `<input type="date">` value. */
export function todayInZone(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): string {
  return isoToLocalDateTimeInput(now.toISOString(), timeZone).slice(0, 10);
}
