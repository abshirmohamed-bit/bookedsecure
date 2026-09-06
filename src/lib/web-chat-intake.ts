/**
 * Natural-language booking intake for the public booking-only conversation.
 *
 * Pure functions only — no database, no network, no model call. Everything here
 * either matches the customer's own words against the tenant's APPROVED data
 * (services, locations) or parses a value the customer literally supplied.
 *
 * Hard rules encoded here:
 * - A service is only ever resolved to an entry in the tenant's approved
 *   catalogue. An unmatched request stays unmatched; nothing is substituted.
 * - A location is only ever resolved to one of the tenant's approved locations.
 * - When two or more approved options match, the result is AMBIGUOUS. The
 *   conversation must ask, never guess.
 * - Dates and times are resolved in the tenant's timezone (Australia/Sydney for
 *   Glocast) and only when the customer stated them.
 * - Prices, durations, availability and slots are never produced here.
 */

import { normaliseAuMobile } from "@/lib/domain";
import { FIELD_LABELS, FIELD_WORDS, extractCorrectionValue, type CorrectableStep } from "@/lib/web-chat-correction";
import {
  applyAnswer,
  type WebChatCollected,
  type WebChatStep,
  type WebChatTenant,
} from "@/lib/web-chat";

export type IntakeService = { id: string; name: string };

export type IntakeTenant = {
  timezone: string;
  services: IntakeService[];
  /** Approved locations, tenant-configured. Empty = no location catalogue. */
  locations: string[];
};

export type IntakeIntent =
  | "booking"
  | "change"
  | "unsupported"
  | "ambiguous"
  | "unclear";

export type IntakeAmbiguity = {
  field: "service" | "location" | "date" | "time";
  options: string[];
};

export type IntakeExtraction = {
  intent: IntakeIntent;
  /** Approved service, or null when nothing in the catalogue matched. */
  service: IntakeService | null;
  /** Approved location, or null. */
  location: string | null;
  /** ISO date (yyyy-mm-dd) in the tenant timezone, when stated. */
  preferredDate: string | null;
  /** 24h HH:MM in the tenant timezone, or a part-of-day word the customer used. */
  preferredTime: string | null;
  name: string | null;
  mobile: string | null;
  email: string | null;
  vehicle: string | null;
  notes: string | null;
  ambiguities: IntakeAmbiguity[];
  /** Wording the customer used that could NOT be matched to approved data. */
  unmatched: { service: string | null; location: string | null };
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "and",
  "the",
  "for",
  "with",
  "a",
  "an",
  "of",
  "my",
  "in",
  "at",
  "to",
  "on",
  "please",
  "service",
  "package",
]);

function stem(token: string): string {
  let word = token.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const suffix of ["ing", "ers", "er", "ed", "es", "s"]) {
    if (word.length > 4 && word.endsWith(suffix)) {
      word = word.slice(0, word.length - suffix.length);
      break;
    }
  }
  return word;
}

function stems(text: string): Set<string> {
  return new Set(
    text
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map(stem)
      .filter((token) => token.length > 1),
  );
}

function serviceTokens(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
    .map(stem)
    .filter((token) => token.length > 1);
}

// ---------------------------------------------------------------------------
// Approved-service matching
// ---------------------------------------------------------------------------

type ServiceMatch =
  | { kind: "none" }
  | { kind: "one"; service: IntakeService }
  | { kind: "ambiguous"; services: IntakeService[] };

function normaliseServiceName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Service resolution precedence, strongest evidence first:
 * 1. exact normalised catalogue match,
 * 2. the catalogue name appearing verbatim in the message (longest wins),
 * 3. a service whose every word the customer used (full token coverage),
 * 4. partial token overlap — the only place a tie becomes a clarification.
 */
export function matchApprovedService(raw: string, services: IntakeService[]): ServiceMatch {
  const target = normaliseServiceName(raw);

  const exact = services.filter((service) => normaliseServiceName(service.name) === target);
  if (exact.length === 1) return { kind: "one", service: exact[0]! };

  if (target.length >= 3) {
    const phrase = services
      .filter((service) => {
        const name = normaliseServiceName(service.name);
        return name.length >= 3 && target.includes(name);
      })
      .sort((a, b) => normaliseServiceName(b.name).length - normaliseServiceName(a.name).length);
    if (phrase.length > 0) {
      const longest = normaliseServiceName(phrase[0]!.name).length;
      const tied = phrase.filter((service) => normaliseServiceName(service.name).length === longest);
      if (tied.length === 1) return { kind: "one", service: tied[0]! };
    }
  }

  const messageStems = stems(raw);
  const scored = services
    .map((service) => {
      const tokens = serviceTokens(service.name);
      if (tokens.length === 0) return { service, score: 0, hits: 0 };
      const hits = tokens.filter((token) => messageStems.has(token)).length;
      return { service, score: hits / tokens.length, hits };
    })
    .filter((entry) => entry.score > 0);

  if (scored.length === 0) return { kind: "none" };

  // Only reasonably complete matches count at all.
  const candidates = scored.filter((entry) => entry.score >= 0.5);
  if (candidates.length === 0) return { kind: "none" };

  // A service the customer named in full beats one they only partly named.
  const complete = candidates.filter((entry) => entry.score === 1);
  if (complete.length === 1) return { kind: "one", service: complete[0]!.service };
  const pool = complete.length > 1 ? complete : candidates;

  // Two approved services matching the same number of the customer's words
  // ("interior and exterior detail") is an ambiguity to ask about, never a guess.
  const bestHits = Math.max(...pool.map((entry) => entry.hits));
  const leaders = pool.filter((entry) => entry.hits === bestHits);
  if (leaders.length > 1) return { kind: "ambiguous", services: leaders.map((entry) => entry.service) };
  return { kind: "one", service: leaders[0]!.service };
}

/**
 * A service the customer already confirmed (a button press, or an earlier
 * resolved answer) is never re-resolved from later narrative text: the later
 * mention is dropped, so no clarification is asked and no value is overwritten.
 * An explicit correction is handled by the correction path, not here.
 */
export function preserveConfirmedService(
  extraction: IntakeExtraction,
  collected: WebChatCollected,
): IntakeExtraction {
  const confirmed = Boolean(collected.service_id) || Boolean((collected.typed_request ?? "").trim());
  if (!confirmed) return extraction;
  const ambiguities = extraction.ambiguities.filter((entry) => entry.field !== "service");
  const next: IntakeExtraction = {
    ...extraction,
    service: null,
    ambiguities,
    unmatched: { ...extraction.unmatched, service: null },
  };
  if (next.intent === "ambiguous" && ambiguities.length === 0) next.intent = "booking";
  return next;
}


// ---------------------------------------------------------------------------
// Approved-location matching
// ---------------------------------------------------------------------------

type LocationMatch =
  | { kind: "none" }
  | { kind: "one"; location: string }
  | { kind: "ambiguous"; locations: string[] };

/** Tenant-configured approved locations, parsed from a comma/slash separated list. */
export function parseApprovedLocations(serviceArea: string | null | undefined): string[] {
  return (serviceArea ?? "")
    .split(/[,/|;\n]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 2 && !/^\d+\s*km/i.test(entry));
}

/**
 * The suburb the customer actually stated, when it is not in the tenant's
 * approved-location list. Read verbatim from their own words — the approved list
 * is used to detect ambiguity, never to discard a suburb the customer gave.
 */
/** Openers that look like a capitalised suburb but never are. */
const DISCOURSE_WORDS = [
  "actually",
  "sorry",
  "hi",
  "hey",
  "hello",
  "thanks",
  "thank you",
  "yes",
  "yeah",
  "no",
  "nope",
  "please",
  "also",
  "ok",
  "okay",
  "change",
  "book",
  "booking",
  "morning",
  "afternoon",
  "evening",
  "today",
  "tomorrow",
];

export function statedSuburb(raw: string, excluded: string[] = []): string | null {
  const banned = new Set([
    ...DISCOURSE_WORDS,
    ...excluded.map((entry) => entry.toLowerCase()),
    ...VEHICLE_MAKES,
    ...VEHICLE_TYPES,
  ]);
  const patterns = [
    /\bsuburb\s*(?:is|=|:)\s*([A-Za-z][A-Za-z'\-]+(?:\s+[A-Za-z][A-Za-z'\-]+)?)/i,
    /\b(?:in|at|around|near|based\s+in|located\s+in)\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)?)/,
    /^([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)?)\s*[,.]/,
  ];
  for (const pattern of patterns) {
    const value = pattern.exec(raw)?.[1]?.trim();
    if (!value) continue;
    const lower = value.toLowerCase();
    if (banned.has(lower)) continue;
    if (value.length < 3) continue;
    return value;
  }
  return null;
}

export function matchApprovedLocation(raw: string, locations: string[]): LocationMatch {
  const lower = raw.toLowerCase();
  const hits = locations.filter((location) =>
    new RegExp(`\\b${location.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower),
  );
  if (hits.length === 0) return { kind: "none" };
  if (hits.length > 1) return { kind: "ambiguous", locations: hits };
  return { kind: "one", location: hits[0]! };
}

// ---------------------------------------------------------------------------
// Date / time in the tenant timezone
// ---------------------------------------------------------------------------

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function tenantParts(now: Date, timezone: string): { date: string; weekday: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayName = get("weekday").toLowerCase();
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS.indexOf(weekdayName as (typeof WEEKDAYS)[number]),
  };
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number) as [number, number, number];
  const base = Date.UTC(year, month - 1, day) + days * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

export function resolvePreferredDate(
  raw: string,
  now: Date,
  timezone: string,
): { kind: "none" } | { kind: "one"; date: string } | { kind: "ambiguous"; options: string[] } {
  const lower = raw.toLowerCase();
  const today = tenantParts(now, timezone);

  const named = WEEKDAYS.filter((day) => new RegExp(`\\b${day}\\b`, "i").test(lower));
  if (named.length > 1) return { kind: "ambiguous", options: named.map(titleCase) };

  if (/\btoday\b/i.test(lower) && /\btomorrow\b/i.test(lower))
    return { kind: "ambiguous", options: ["Today", "Tomorrow"] };
  if (/\btomorrow\b/i.test(lower)) return { kind: "one", date: addDays(today.date, 1) };
  if (/\btoday\b/i.test(lower)) return { kind: "one", date: today.date };

  if (named.length === 1) {
    const target = WEEKDAYS.indexOf(named[0]!);
    let delta = (target - today.weekday + 7) % 7;
    // "next Tuesday" in everyday Australian use means the upcoming Tuesday.
    if (delta === 0) delta = 7;
    return { kind: "one", date: addDays(today.date, delta) };
  }

  const numeric = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/.exec(lower);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    const yearRaw = numeric[3] ? Number(numeric[3]) : Number(today.date.slice(0, 4));
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return {
        kind: "one",
        date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      };
    }
  }
  return { kind: "none" };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function resolvePreferredTime(
  raw: string,
): { kind: "none" } | { kind: "one"; time: string } | { kind: "ambiguous"; options: string[] } {
  const matches = [...raw.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)].map((match) => {
    let hour = Number(match[1]);
    const minute = match[2] ? Number(match[2]) : 0;
    const meridiem = match[3]!.toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  });
  const unique = [...new Set(matches)];
  if (unique.length > 1) return { kind: "ambiguous", options: unique };
  if (unique.length === 1) return { kind: "one", time: unique[0]! };

  const partOfDay = /\b(morning|afternoon|evening)\b/i.exec(raw);
  if (partOfDay) return { kind: "one", time: partOfDay[1]!.toLowerCase() };
  return { kind: "none" };
}

// ---------------------------------------------------------------------------
// Customer / vehicle details the customer literally supplied
// ---------------------------------------------------------------------------

/** Vehicle-make vocabulary used only to READ the customer's words. */
const VEHICLE_MAKES = [
  "toyota",
  "mazda",
  "hyundai",
  "kia",
  "ford",
  "holden",
  "nissan",
  "mitsubishi",
  "subaru",
  "honda",
  "volkswagen",
  "vw",
  "audi",
  "bmw",
  "mercedes",
  "mercedes-benz",
  "lexus",
  "tesla",
  "isuzu",
  "jeep",
  "land rover",
  "landrover",
  "range rover",
  "porsche",
  "volvo",
  "skoda",
  "suzuki",
  "renault",
  "peugeot",
  "ram",
  "gwm",
  "mg",
  "byd",
];

const VEHICLE_TYPES = ["sedan", "suv", "ute", "van", "wagon", "hatch", "hatchback", "truck", "4wd", "coupe"];

export function extractName(raw: string): string | null {
  const patterns = [
    /\bmy\s+name\s+(?:is|'s)\s+([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,2})/i,
    /\b(?:i\s*am|i'?m|this\s+is|it'?s)\s+([A-Z][A-Za-z'\-]*(?:\s+[A-Z][A-Za-z'\-]*){0,2})\b/,
    /\b(?:booking\s+name|under\s+the\s+name|name)(?:\s+is|\s*[:\-])?\s+([A-Z][A-Za-z'\-]*(?:\s+[A-Z][A-Za-z'\-]*){0,2})\b/,
  ];
  for (const pattern of patterns) {
    const value = trimNameTail(pattern.exec(raw)?.[1]?.trim() ?? "");
    if (value && value.length >= 2) return value;
  }
  return null;
}

/**
 * A greedy capture can swallow the start of the NEXT clause ("abshir and my").
 * Only the leading name tokens are kept: the first connective / field word ends
 * the name, so another clause can never bleed into it.
 */
const NAME_TAIL_STOP = new Set([
  "and","my","the","is","im","i","a","an","number","mobile","phone","email","its","it",
  "please","also","plus","but","in","at","for","from","with","car","vehicle","name",
]);

export function trimNameTail(value: string): string {
  const kept: string[] = [];
  for (const token of value.split(/\s+/).filter(Boolean)) {
    if (NAME_TAIL_STOP.has(token.toLowerCase())) break;
    kept.push(token);
  }
  return titleCase(kept.join(" ").replace(/[\s.,;:]+$/, "").trim());
}

export function extractVehicle(raw: string): string | null {
  const lower = raw.toLowerCase();
  for (const make of [...VEHICLE_MAKES].sort((a, b) => b.length - a.length)) {
    const index = lower.indexOf(make);
    if (index === -1) continue;
    const tail = raw.slice(index + make.length);
    const model = /^\s+([A-Za-z0-9][A-Za-z0-9-]{1,14})/.exec(tail)?.[1] ?? "";
    const modelLower = model.toLowerCase();
    const keepModel =
      model.length > 0 &&
      !STOP_WORDS.has(modelLower) &&
      !["is", "and", "next", "this", "that", "please", "car"].includes(modelLower);
    const label = `${titleCase(raw.slice(index, index + make.length))}${keepModel ? ` ${model}` : ""}`;
    return label.trim();
  }
  const type = VEHICLE_TYPES.find((entry) => new RegExp(`\\b${entry}\\b`, "i").test(lower));
  if (type) {
    const phrase = new RegExp(`\\b(?:my|a|an|the)\\s+([A-Za-z0-9-]+\\s+)?${type}\\b`, "i").exec(raw);
    return (phrase ? `${phrase[1] ?? ""}${type}` : type).trim();
  }
  return null;
}

export function extractEmail(raw: string): string | null {
  const match = /\b[^@\s]+@[^@\s]+\.[A-Za-z]{2,}\b/.exec(raw);
  return match ? match[0] : null;
}

export function extractMobile(raw: string): string | null {
  for (const candidate of raw.match(/(?:\+?61|0)[\d\s()-]{8,14}/g) ?? []) {
    const normalised = normaliseAuMobile(candidate);
    if (normalised) return normalised;
  }
  return null;
}

/** Trims trailing clauses that belong to another field (mobile, email, name). */
function stripOtherFieldClauses(raw: string): string {
  return raw
    .replace(/,?\s*(?:and\s+)?(?:my|the)?\s*(?:mobile|phone|number|cell)\b[^.;!?]*/i, "")
    .replace(/,?\s*(?:and\s+)?(?:my|the)?\s*e-?mail\b[^.;!?]*/i, "")
    .replace(/,?\s*(?:and\s+)?my\s+name\s+is\b[^.;!?]*/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[,;\s]+$/, "")
    .trim();
}

/** Condition words customers use; the clause around one is their concern. */
const CONCERN_WORDS = [
  "pet hair",
  "dog hair",
  "cat hair",
  "swirl",
  "swirls",
  "scratch",
  "scratches",
  "water spot",
  "water spots",
  "stain",
  "stains",
  "odour",
  "odor",
  "smell",
  "mould",
  "mold",
  "tree sap",
  "bird dropping",
  "oxidation",
  "fade",
  "faded",
  "mud",
  "sand",
  "spill",
  "crumbs",
];

export function extractNotes(raw: string): string | null {
  const patterns = [
    /\b(?:please\s+)?(?:add|note)\s+that\s+([^.;!?]{4,200})/i,
    /\bnote[:\s]+([^.;!?]{4,200})/i,
    /\b(?:there\s+(?:is|are)|it\s+has|has)\s+((?:some\s+)?(?:existing\s+)?[^.;!?]{4,200})/i,
  ];
  for (const pattern of patterns) {
    const captured = pattern.exec(raw)?.[1]?.trim();
    const value = captured ? stripOtherFieldClauses(captured) : "";
    if (value.length >= 4) return value;
  }
  // A clause that names a condition word is the customer's own description.
  for (const clause of raw.split(/[,;.!?]/)) {
    const trimmed = stripOtherFieldClauses(clause.trim());
    const lower = trimmed.toLowerCase();
    if (trimmed.length >= 4 && CONCERN_WORDS.some((word) => lower.includes(word))) return trimmed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Intent
// ---------------------------------------------------------------------------

const BOOKING_CUE =
  /\b(book|booking|appointment|schedule|slot|quote|detail|detailing|coating|coat|polish|wash|protection|available|availability|come\s+in|get\s+my|need|want|looking\s+for)\b/i;

const CHANGE_CUE = /\b(actually|instead|change|correct|update|not\s+the|rather|make\s+it)\b/i;

const UNSUPPORTED_CUE =
  /\b(refund|complain(t|ing)?|invoice|job\s+application|apply\s+for\s+a\s+job|employment|franchise|wholesale|partnership|sponsor|press|media)\b/i;

/**
 * Multi-field extraction pass.
 *
 * Every value present in the message is read BEFORE anything is asked, so the
 * conversation never re-asks for something the customer already supplied.
 */
export function extractIntake(raw: string, tenant: IntakeTenant, now: Date): IntakeExtraction {
  const text = raw.trim().slice(0, 500);
  const ambiguities: IntakeAmbiguity[] = [];

  const serviceMatch = matchApprovedService(text, tenant.services);
  if (serviceMatch.kind === "ambiguous")
    ambiguities.push({ field: "service", options: serviceMatch.services.map((service) => service.name) });

  const locationMatch = matchApprovedLocation(text, tenant.locations);
  if (locationMatch.kind === "ambiguous")
    ambiguities.push({ field: "location", options: locationMatch.locations });

  const dateMatch = resolvePreferredDate(text, now, tenant.timezone);
  if (dateMatch.kind === "ambiguous") ambiguities.push({ field: "date", options: dateMatch.options });

  const timeMatch = resolvePreferredTime(text);
  if (timeMatch.kind === "ambiguous") ambiguities.push({ field: "time", options: timeMatch.options });

  const service = serviceMatch.kind === "one" ? serviceMatch.service : null;
  const name = extractName(text);
  const vehicle = extractVehicle(text);
  // Approved match first; otherwise the suburb the customer stated themselves.
  const location =
    locationMatch.kind === "one"
      ? locationMatch.location
      : locationMatch.kind === "none"
        ? statedSuburb(text, [name ?? "", vehicle ?? ""].filter(Boolean))
        : null;

  const extraction: IntakeExtraction = {
    intent: "unclear",
    service,
    location,
    preferredDate: dateMatch.kind === "one" ? dateMatch.date : null,
    preferredTime: timeMatch.kind === "one" ? timeMatch.time : null,
    name,
    mobile: extractMobile(text),
    email: extractEmail(text),
    vehicle,
    notes: extractNotes(text),
    ambiguities,
    unmatched: {
      // Unmatched wording is preserved verbatim, never replaced by a guess.
      service: serviceMatch.kind === "none" && BOOKING_CUE.test(text) && !service ? text : null,
      location: null,
    },
  };

  const anyField =
    Boolean(service) ||
    Boolean(location) ||
    Boolean(extraction.preferredDate) ||
    Boolean(extraction.preferredTime) ||
    Boolean(extraction.name) ||
    Boolean(extraction.mobile) ||
    Boolean(extraction.email) ||
    Boolean(extraction.vehicle) ||
    Boolean(extraction.notes);

  if (UNSUPPORTED_CUE.test(text) && !anyField) extraction.intent = "unsupported";
  else if (ambiguities.length > 0) extraction.intent = "ambiguous";
  else if (CHANGE_CUE.test(text) && anyField) extraction.intent = "change";
  else if (anyField || BOOKING_CUE.test(text)) extraction.intent = "booking";

  return extraction;
}

// ---------------------------------------------------------------------------
// Grouped missing-field collection
// ---------------------------------------------------------------------------

export type IntakeField = "service" | "vehicle" | "location" | "concerns" | "name" | "mobile";

export const INTAKE_FIELD_QUESTIONS: Record<IntakeField, string> = {
  service: "Which of our services would you like?",
  vehicle: "What make and model is the vehicle?",
  location: "Which suburb should we come to?",
  concerns: "Is there anything we should know about the vehicle's condition?",
  name: "What name should the booking be under?",
  mobile: "Which mobile number should we use for the confirmation?",
};

/**
 * All fields still genuinely missing — asked together, never one at a time.
 * A field already supplied and validated is never listed again.
 */
export function groupedMissingMessage(fields: IntakeField[]): string | null {
  if (fields.length === 0) return null;
  return [
    "I can help with that booking. I still need:",
    ...fields.map((field) => `- ${INTAKE_FIELD_QUESTIONS[field]}`),
  ].join("\n");
}

export function ambiguityMessage(ambiguity: IntakeAmbiguity): string {
  const options = ambiguity.options;
  const list = options.length > 1 ? `${options.slice(0, -1).join(", ")} or ${options[options.length - 1]}` : options[0];
  switch (ambiguity.field) {
    case "service":
      return `Just to be sure I book the right thing — did you mean ${list}?`;
    case "location":
      return `Which location did you mean — ${list}?`;
    case "date":
      return `Which day suits you — ${list}?`;
    case "time":
      return `Which time did you mean — ${list}?`;
  }
}

export function unmatchedServiceMessage(businessName: string): string {
  return `I couldn't match that to one of ${businessName}'s bookable services, so I don't want to guess. Which of our listed services is closest to what you need?`;
}

export const UNSUPPORTED_REQUEST_MESSAGE =
  "I can only help with bookings here. If you'd like to book a service, tell me what you need and where the vehicle is and I'll take it from there.";

// ---------------------------------------------------------------------------
// Applying an extraction to the collected state
// ---------------------------------------------------------------------------

/**
 * Applies every extracted value through the SAME validation the step-by-step
 * questions use. A value that fails validation is simply not stored — it is
 * never coerced, and the field stays open so the customer can supply it.
 */
export function applyIntake(
  collected: WebChatCollected,
  extraction: IntakeExtraction,
  tenant: WebChatTenant,
  /**
   * "extracted" means the values were already separated per field by the
   * structured extraction pass, so the raw-message shape heuristic does not
   * apply to them. Every other guard (contact markers, field markers, length)
   * still applies exactly as before.
   */
  options?: { origin?: "customer" | "extracted" },
): { collected: WebChatCollected; applied: IntakeField[] } {
  let next: WebChatCollected = { ...collected };
  const applied: IntakeField[] = [];

  const put = (step: WebChatStep, value: string, field: IntakeField | null) => {
    const result = applyAnswer(next, step, value, tenant, { origin: options?.origin ?? "customer" });
    if (!result.ok) return;
    next = result.collected;
    if (field && !applied.includes(field)) applied.push(field);
  };

  // A service already chosen or already stated is never re-decided by a later
  // answer to a different question ("pet hair in the back seats" is a condition,
  // not a new service).
  if (extraction.service && !next.service_id && !(next.typed_request ?? "").trim())
    put("service", extraction.service.id, "service");
  if (extraction.vehicle && !(next.vehicle_type ?? "").trim()) put("vehicle", extraction.vehicle, "vehicle");
  if (extraction.location && !(next.suburb ?? "").trim()) put("suburb", extraction.location, "location");
  if (extraction.name && !(next.name ?? "").trim()) put("name", extraction.name, "name");
  if (extraction.mobile && !next.mobile_number) put("mobile", extraction.mobile, "mobile");
  if (extraction.email && next.email === undefined) put("email", extraction.email, null);

  const preference = [
    extraction.preferredDate ? `preferred day ${extraction.preferredDate}` : null,
    extraction.preferredTime ? `preferred time ${extraction.preferredTime}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const noteParts = [extraction.notes, preference].filter((part): part is string => Boolean(part));
  if (noteParts.length > 0 && !(next.concerns ?? "").trim())
    put("concerns", noteParts.join(" — "), "concerns");

  return { collected: next, applied };
}

/** Fields still outstanding, in the order the conversation should ask them. */
export function outstandingFields(collected: WebChatCollected): IntakeField[] {
  const fields: IntakeField[] = [];
  if (!collected.service_id && !(collected.typed_request ?? "").trim()) fields.push("service");
  if (!(collected.vehicle_type ?? "").trim()) fields.push("vehicle");
  if (!(collected.suburb ?? "").trim()) fields.push("location");
  if (!(collected.concerns ?? "").trim()) fields.push("concerns");
  if (!(collected.name ?? "").trim()) fields.push("name");
  if (!collected.mobile_number) fields.push("mobile");
  return fields;
}

// ---------------------------------------------------------------------------
// Multi-field change directives
// ---------------------------------------------------------------------------

export type FieldUpdate = { field: CorrectableStep; value: string; echo: string };

/**
 * "change the vehicle to a Mazda CX-5 and the suburb to Bankstown".
 *
 * The message is split into clauses so each named field gets ONLY its own value
 * — the value of one field can never bleed into another. Every value still goes
 * through that field's own validation; a clause that fails validation is
 * reported, not stored.
 */
export function applyFieldDirectives(
  raw: string,
  collected: WebChatCollected,
  tenant: WebChatTenant,
): { collected: WebChatCollected; updates: FieldUpdate[]; invalid: { field: CorrectableStep; error: string }[] } {
  const clauses = raw
    .split(/\s*(?:,|;|\.|\band\b|\balso\b|\bplus\b)\s*/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);

  let next: WebChatCollected = { ...collected };
  const updates: FieldUpdate[] = [];
  const invalid: { field: CorrectableStep; error: string }[] = [];

  for (const clause of clauses) {
    const fields = (Object.keys(FIELD_WORDS) as CorrectableStep[]).filter((field) =>
      FIELD_WORDS[field].test(clause),
    );
    // A clause naming two fields is not split further — ambiguous clauses are skipped.
    if (fields.length !== 1) continue;
    const field = fields[0]!;
    if (updates.some((update) => update.field === field)) continue;
    const value = extractCorrectionValue(clause, field) ?? extractCorrectionValue(`actually ${clause}`, field);
    if (!value) continue;
    const applied = applyAnswer({ ...next, reviewed: false }, field, value, tenant);
    if (!applied.ok) {
      invalid.push({ field, error: applied.error });
      continue;
    }
    next = applied.collected;
    updates.push({ field, value, echo: applied.echo });
  }

  return { collected: next, updates, invalid };
}

export function fieldUpdateMessage(updates: FieldUpdate[]): string {
  const parts = updates.map((update) => `your ${FIELD_LABELS[update.field]} to ${update.echo}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Got it — I've updated ${list}.`;
}
