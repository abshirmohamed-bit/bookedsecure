/**
 * Owner assistant: one-customer updates, parsed deterministically.
 *
 * Turns a plain-English instruction such as "Andrew's detail is done, he paid
 * $450, book him again on 12 March at 9am" into a PROPOSAL. Parsing never
 * writes anything: the owner confirms on screen before any record changes.
 *
 * Tenant-neutral: no business, customer or service name is special-cased.
 */

/** Contact/vehicle details the owner can correct in passing. */
export type LeadDetailPatch = {
  mobile_number?: string;
  email?: string;
  suburb?: string;
  vehicle_type?: string;
  service_intent?: string;
};

export type LeadUpdateRequest = {
  kind: "lead_update";
  /** The customer name as the owner typed it. Resolved against their own leads. */
  name: string;
  details: LeadDetailPatch;
  /** Mark the most recent visit as completed. */
  markCompleted: boolean;
  /** Payment recorded against the completed visit, in dollars. */
  paidAmount: number | null;
  /** Future visit to book, as an ISO timestamp. */
  bookAt: string | null;
};

const COMPLETED_CUE =
  /\b(?:is\s+)?(?:done|complete|completed|finished|finalised|wrapped up)\b|\bjob\s+done\b/i;
const PAID_CUE =
  /(?:paid|payment(?: of)?|charged|invoiced|took|received)\s*(?:me\s*)?\$?\s*(\d[\d,]*(?:\.\d{1,2})?)|\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:paid|received|cash|in cash)/i;
const BOOK_CUE = /\b(?:book|rebook|re-?book|schedule|reschedule|put (?:him|her|them) in)\b/i;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function clampAmount(raw: string): number | null {
  const value = Number(raw.replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 && value <= 1_000_000 ? value : null;
}

/** Hour/minute the owner named, defaulting to 9am when they only gave a day. */
function parseTimeOfDay(text: string): { hour: number; minute: number } {
  const match = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(text);
  if (!match) return { hour: 9, minute: 0 };
  let hour = Number(match[1]) % 12;
  if ((match[3] ?? "").toLowerCase() === "pm") hour += 12;
  const minute = match[2] ? Number(match[2]) : 0;
  return { hour, minute: minute >= 0 && minute < 60 ? minute : 0 };
}

/**
 * Resolves a future date the owner named. Only forward-looking dates are
 * accepted: a bare day/month already past this year rolls into next year, so a
 * booking is never created in the past.
 */
export function parseFutureDate(text: string, now: Date): string | null {
  const { hour, minute } = parseTimeOfDay(text);
  const build = (year: number, month: number, day: number): string | null => {
    const date = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  // 12/03/2026 or 12-03-26 (day first, Australian convention).
  const numeric = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(text);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]) - 1;
    const yearRaw = numeric[3] ? Number(numeric[3]) : now.getUTCFullYear();
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      const iso = build(year, month, day);
      if (iso && (numeric[3] || iso > now.toISOString())) return iso;
      if (iso) return build(year + 1, month, day);
    }
  }

  // "12 March", "March 12", "12th of March"
  const monthIndex = MONTHS.findIndex((month) => new RegExp(`\\b${month}\\b`, "i").test(text));
  if (monthIndex >= 0) {
    const dayMatch =
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?[a-z]+\b/i.exec(text) ??
      /\b[a-z]+\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);
    const day = dayMatch ? Number(dayMatch[1]) : 1;
    if (day >= 1 && day <= 31) {
      const iso = build(now.getUTCFullYear(), monthIndex, day);
      if (iso && iso > now.toISOString()) return iso;
      return build(now.getUTCFullYear() + 1, monthIndex, day);
    }
  }

  if (/\btomorrow\b/i.test(text)) {
    const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return build(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  }

  // "next Friday" / "on Friday" — the next occurrence of that weekday.
  const weekdayIndex = WEEKDAYS.findIndex((day) => new RegExp(`\\b${day}\\b`, "i").test(text));
  if (weekdayIndex >= 0) {
    let delta = (weekdayIndex - now.getUTCDay() + 7) % 7;
    if (delta === 0 || /\bnext\b/i.test(text)) delta = delta === 0 ? 7 : delta;
    const next = new Date(now.getTime() + delta * 24 * 60 * 60 * 1000);
    return build(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  }

  // "in 2 weeks" / "in 3 months"
  const relative = /\bin\s+(\d{1,3})\s*(day|days|week|weeks|month|months)\b/i.exec(text);
  if (relative) {
    const value = Number(relative[1]);
    const unit = (relative[2] ?? "").toLowerCase();
    const days = unit.startsWith("week") ? value * 7 : unit.startsWith("month") ? value * 30 : value;
    const next = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return build(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
  }

  return null;
}

/** Detail corrections stated explicitly, e.g. "his suburb is Burwood". */
function parseDetails(text: string): LeadDetailPatch {
  const details: LeadDetailPatch = {};

  const mobile = /\b((?:\+?61|0)[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3})\b/.exec(text);
  if (mobile?.[1]) details.mobile_number = mobile[1].replace(/[\s-]/g, "");

  const email = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.exec(text);
  if (email?.[0]) details.email = email[0].toLowerCase();

  const suburb = /\bsuburb\s*(?:is|to|=|:)?\s*([A-Za-z][A-Za-z' -]{1,40})/i.exec(text);
  if (suburb?.[1]) details.suburb = suburb[1].trim().replace(/\s+(and|then|he|she|they)$/i, "");

  const vehicle =
    /\b(?:vehicle|car|ute|van|truck)\s*(?:is|was|to|=|:)\s*([A-Za-z0-9][A-Za-z0-9' -]{1,40})/i.exec(
      text,
    );
  if (vehicle?.[1]) details.vehicle_type = vehicle[1].trim();

  const service =
    /\b(?:service|job|package)\s*(?:was|is|to|=|:)\s*([A-Za-z0-9][A-Za-z0-9' &+-]{1,60})/i.exec(text);
  if (service?.[1]) details.service_intent = service[1].trim();

  return details;
}

const NAME_PATTERNS: readonly RegExp[] = [
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)'s\b/,
  /\b(?:for|update|mark|record|book|rebook|schedule)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:is|has|paid|was)\b/,
];

/** The customer the instruction is about, or null when no name is stated. */
export function parseCustomerName(text: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(text);
    const name = match?.[1]?.trim();
    if (name && name.length >= 2) return name;
  }
  return null;
}

/**
 * Parses a single-customer instruction. Returns null when the message names no
 * customer or asks for nothing this flow can do, so the assistant falls back to
 * answering as usual.
 */
export function parseLeadUpdateRequest(
  question: string,
  now: Date = new Date(),
): LeadUpdateRequest | null {
  const text = (question ?? "").trim();
  if (text.length === 0) return null;

  const name = parseCustomerName(text);
  if (!name) return null;

  const paidMatch = PAID_CUE.exec(text);
  const paidAmount = clampAmount(paidMatch?.[1] ?? paidMatch?.[2] ?? "") ?? null;
  const markCompleted = COMPLETED_CUE.test(text) || paidAmount !== null;
  const bookAt = BOOK_CUE.test(text) ? parseFutureDate(text, now) : null;
  const details = parseDetails(text);

  if (!markCompleted && !bookAt && Object.keys(details).length === 0) return null;
  return { kind: "lead_update", name, details, markCompleted, paidAmount, bookAt };
}

const DETAIL_LABELS: Record<keyof LeadDetailPatch, string> = {
  mobile_number: "mobile",
  email: "email",
  suburb: "suburb",
  vehicle_type: "vehicle",
  service_intent: "service",
};

function money(amount: number): string {
  return `$${amount.toLocaleString("en-AU", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Human date the owner can check before confirming. */
export function formatBookingDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** Plain-language lines describing exactly what confirming will do. */
export function describeLeadUpdate(input: {
  leadName: string;
  request: LeadUpdateRequest;
}): string[] {
  const lines: string[] = [];
  for (const [field, value] of Object.entries(input.request.details)) {
    lines.push(`Set ${input.leadName}'s ${DETAIL_LABELS[field as keyof LeadDetailPatch]} to ${value}.`);
  }
  if (input.request.markCompleted) {
    lines.push(
      input.request.paidAmount === null
        ? `Mark ${input.leadName}'s most recent visit as completed.`
        : `Mark ${input.leadName}'s most recent visit as completed and record ${money(input.request.paidAmount)} paid.`,
    );
  }
  if (input.request.bookAt) {
    lines.push(`Book ${input.leadName} again for ${formatBookingDate(input.request.bookAt)}.`);
  }
  return lines;
}
