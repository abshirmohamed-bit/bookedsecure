// Owner schedule reminder texts (pure, no I/O).
// Builds the SMS parts for an owner's own booking summary. Long schedules are
// split across several texts so no booking is dropped.

export type ReminderBooking = {
  scheduledAt: string;
  customerName: string | null;
  serviceName: string | null;
  suburb: string | null;
};

/** Max characters per text part (about three SMS segments). */
export const REMINDER_PART_LIMIT = 450;

export function reminderRequestKeyMaterial(input: {
  sendAt: string;
  rangeStart: string;
  rangeEnd: string;
}): string {
  const minute = (iso: string) => new Date(Math.floor(Date.parse(iso) / 60000) * 60000).toISOString();
  return `${minute(input.sendAt)}|${minute(input.rangeStart)}|${minute(input.rangeEnd)}`;
}

function formatLine(b: ReminderBooking, timeZone: string): string {
  const when = new Intl.DateTimeFormat("en-AU", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(b.scheduledAt));
  const who = b.customerName?.trim() || "Customer booking";
  const extra = [b.serviceName?.trim(), b.suburb?.trim()].filter(Boolean).join(", ");
  return `- ${when}: ${who}${extra ? ` (${extra})` : ""}`;
}

export function renderOwnerScheduleReminder(input: {
  label: string;
  bookings: ReminderBooking[];
  timeZone: string;
  limit?: number;
}): string[] {
  const limit = input.limit ?? REMINDER_PART_LIMIT;
  const header = `BookedSecure reminder: ${input.label}`;
  const sorted = [...input.bookings].sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  if (sorted.length === 0) return [`${header}\nNo bookings scheduled.`];
  const footer = `Total: ${sorted.length} booking${sorted.length === 1 ? "" : "s"}.`;
  const lines = sorted.map((b) => formatLine(b, input.timeZone).slice(0, limit - header.length - 12));
  const parts: string[][] = [[]];
  let size = header.length + 10;
  for (const line of [...lines, footer]) {
    if (size + line.length + 1 > limit && parts[parts.length - 1]!.length > 0) {
      parts.push([]);
      size = header.length + 10;
    }
    parts[parts.length - 1]!.push(line);
    size += line.length + 1;
  }
  const n = parts.length;
  return parts.map((p, i) => `${header}${n > 1 ? ` (${i + 1}/${n})` : ""}\n${p.join("\n")}`);
}
