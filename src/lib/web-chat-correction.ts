/**
 * Mid-conversation correction handling for the public AI quote conversation.
 *
 * Pure functions only — no database, no network, no model call. A correction is
 * detected from the customer's own words, validated through the SAME
 * `applyAnswer` rules as a normal answer, and applied to the collected fields.
 * Nothing here invents data, and the original customer message is never
 * rewritten: only the stored field value changes (latest value wins).
 */

import { applyAnswer, type WebChatCollected, type WebChatStep, type WebChatTenant } from "@/lib/web-chat";

/** Fields the customer may correct at any time before final consent. */
export const CORRECTABLE_STEPS = [
  "service",
  "vehicle",
  "suburb",
  "concerns",
  "name",
  "mobile",
  "email",
] as const;
export type CorrectableStep = (typeof CORRECTABLE_STEPS)[number];

export const FIELD_LABELS: Record<CorrectableStep, string> = {
  service: "service",
  vehicle: "vehicle",
  suburb: "suburb",
  concerns: "condition or concerns",
  name: "name",
  mobile: "mobile number",
  email: "email",
};

/** Words that signal the customer is fixing something already given. */
const CUE =
  /\b(actually|instead|change|changed|correct|correction|update|updated|i\s+meant|i\s+mean|sorry|wrong|incorrect|rather|scratch\s+that|go\s+back|previous\s+answer|put\s+it|put\s+my|make\s+it|use\s+this|use\s+my|should\s+be|not\s+that)\b/i;

const FIELD_WORDS: Record<CorrectableStep, RegExp> = {
  name: /\b(names?)\b/i,
  mobile: /\b(mobile|phone|number|numbers|cell|digits)\b/i,
  email: /\b(e-?mails?|email\s+address)\b/i,
  suburb: /\b(suburb|postcode|area|location|address)\b/i,
  vehicle: /\b(vehicle|car|ute|van|truck|make|model)\b/i,
  concerns: /\b(condition|concerns?|issues?|damage)\b/i,
  service: /\b(service|services|package)\b/i,
};

const FIELD_WORD_SOURCE: Record<CorrectableStep, string> = {
  name: "names?",
  mobile: "mobile(?:\\s+number)?|phone(?:\\s+number)?|numbers?|cell|digits",
  email: "e-?mails?(?:\\s+address)?",
  suburb: "suburb|postcode|area|location|address",
  vehicle: "vehicle|car|ute|van|truck|make|model",
  concerns: "condition|concerns?|issues?|damage",
  service: "service|services|package",
};

export function hasCorrectionCue(raw: string): boolean {
  return CUE.test(raw);
}

function namedFields(raw: string): CorrectableStep[] {
  return CORRECTABLE_STEPS.filter((step) => FIELD_WORDS[step].test(raw));
}

/** Filler that describes the problem rather than naming a replacement value. */
const NON_VALUE = /^(wrong|incorrect|not\s+right|not\s+correct|bad|different|another|it|that|this|new|changed?|updated?)$/i;

function tidy(value: string): string {
  return value
    .split(/\.\s+/)[0]!
    .replace(/\s+(?:for|as|to)\s+(?:my|the)\s+[\w-]+.*$/i, "")
    .replace(/\s+\b(?:instead|please|thanks|thank\s+you|now|ok(?:ay)?)\b[.!]?$/i, "")
    .replace(/^(?:my|the|a|an|it'?s|its|is|be)\s+/i, "")
    .replace(/["'“”]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[.,;!?]+$/, "")
    .trim();
}

/** Pulls the replacement value out of a correction sentence, if one is present. */
export function extractCorrectionValue(raw: string, field: CorrectableStep): string | null {
  const words = FIELD_WORD_SOURCE[field];
  const patterns: RegExp[] = [
    new RegExp(`(?:${words})\\s*(?:was|is|are)?\\s*(?:instead)?\\s*(?:should\\s+be|to|as|=|:)\\s*([^,;!?]+)`, "i"),
    new RegExp(`(?:${words})\\s+(?:is|are)\\s+([^,;!?]+)`, "i"),
    /(?:put|change|set|make|use|update)\s+(?:it|that|this)?\s*(?:my\s+[\w-]+)?\s*(?:as|to)\s+([^,;!?]+)/i,
    /\b(?:actually|instead|i\s+meant|i\s+mean|it'?s|its)\b[,:]?\s*([^,;!?]+)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    const candidate = match?.[1] ? tidy(match[1]) : "";
    if (candidate.length >= 2 && !NON_VALUE.test(candidate) && !FIELD_WORDS[field].test(candidate))
      return candidate;
  }
  return null;
}

function filledSteps(collected: WebChatCollected): CorrectableStep[] {
  const out: CorrectableStep[] = [];
  if (collected.service_id || (collected.typed_request ?? "").trim()) out.push("service");
  if ((collected.vehicle_type ?? "").trim()) out.push("vehicle");
  if ((collected.suburb ?? "").trim()) out.push("suburb");
  if ((collected.concerns ?? "").trim()) out.push("concerns");
  if ((collected.name ?? "").trim()) out.push("name");
  if (collected.mobile_number) out.push("mobile");
  if (collected.email !== undefined) out.push("email");
  return out;
}

function clearField(collected: WebChatCollected, field: CorrectableStep): WebChatCollected {
  const next: WebChatCollected = { ...collected };
  // Any change re-opens the final review so the customer always confirms the
  // latest values before consent.
  next.reviewed = false;
  switch (field) {
    case "service":
      next.service_id = null;
      next.service_name = null;
      next.typed_request = null;
      break;
    case "vehicle":
      next.vehicle_type = null;
      break;
    case "suburb":
      next.suburb = null;
      break;
    case "concerns":
      next.concerns = null;
      break;
    case "name":
      next.name = null;
      break;
    case "mobile":
      next.mobile_number = null;
      break;
    case "email":
      delete next.email;
      break;
  }
  return next;
}

/**
 * Explicit, unambiguous "change this field" directive sent by the review-step
 * buttons (`change:name`). Deterministic — it can never start a clarify loop.
 */
export const CHANGE_DIRECTIVE_PREFIX = "change:";

export function parseChangeDirective(raw: string): CorrectableStep | null {
  const match = /^change:([a-z]+)$/i.exec(raw.trim());
  const field = match?.[1]?.toLowerCase();
  return field && (CORRECTABLE_STEPS as readonly string[]).includes(field) ? (field as CorrectableStep) : null;
}

export type CorrectionResult =
  | { kind: "none" }
  /** A field was corrected in place; `collected` holds the latest values. */
  | { kind: "applied"; field: CorrectableStep; collected: WebChatCollected; message: string }
  /** The customer wants to redo a field but gave no new value — ask it again. */
  | { kind: "reask"; field: CorrectableStep; collected: WebChatCollected; message: string }
  /** Correction intent is clear but the target field isn't. */
  | { kind: "clarify"; message: string }
  /** A replacement value was given but failed the field's own validation. */
  | { kind: "invalid"; field: CorrectableStep; message: string };

export const AMBIGUOUS_CORRECTION_MESSAGE =
  "Sorry — I want to get this right. Which detail should I update: your name, vehicle, suburb, condition, mobile number or email? For example “change my suburb to Parramatta”.";

export function clarifyMessage(fields: CorrectableStep[]): string {
  const labels = (fields.length >= 2 ? fields : filledFallback()).map((field) => FIELD_LABELS[field]);
  return `Sorry — I want to get this right. Do you want me to update your ${labels
    .slice(0, -1)
    .join(", ")} or your ${labels[labels.length - 1]}?`;
}

function filledFallback(): CorrectableStep[] {
  return ["name", "mobile"];
}

/**
 * Detects and applies a correction to an already-collected field.
 *
 * `activeStep` is the question the assistant just asked. When a correction names
 * a different field, the answer is applied there and the active question is NOT
 * validated against it — that is the bug this fixes (a name correction was being
 * validated as an Australian mobile number).
 */
export function detectCorrection(
  collected: WebChatCollected,
  activeStep: WebChatStep,
  raw: string,
  tenant: WebChatTenant,
): CorrectionResult {
  const text = raw.trim();
  if (text.length === 0) return { kind: "none" };

  // Deterministic review-step directive: change exactly this field, no guessing.
  const directive = parseChangeDirective(text);
  if (directive) {
    return {
      kind: "reask",
      field: directive,
      collected: clearField(collected, directive),
      message: `No problem — let's update your ${FIELD_LABELS[directive]}.`,
    };
  }

  if (!hasCorrectionCue(text)) return { kind: "none" };

  const already = filledSteps(collected);
  const named = namedFields(text).filter((field) => field !== activeStep || already.includes(field));

  // "Go back" with no named field: redo the most recent answered field.
  if (named.length === 0) {
    if (/\b(go\s+back|previous\s+answer|scratch\s+that)\b/i.test(text) && already.length > 0) {
      const field = already[already.length - 1]!;
      return {
        kind: "reask",
        field,
        collected: clearField(collected, field),
        message: `No problem — let's redo your ${FIELD_LABELS[field]}.`,
      };
    }
    return { kind: "none" };
  }

  const candidates = named.filter((field) => already.includes(field));
  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length > 1) return { kind: "clarify", message: clarifyMessage(candidates) };

  const field = candidates[0]!;
  const value = extractCorrectionValue(text, field);
  if (!value) {
    return {
      kind: "reask",
      field,
      collected: clearField(collected, field),
      message: `No problem — let's fix your ${FIELD_LABELS[field]}.`,
    };
  }

  const applied = applyAnswer(clearField(collected, field), field, value, tenant);
  if (!applied.ok) return { kind: "invalid", field, message: applied.error };

  return {
    kind: "applied",
    field,
    collected: applied.collected,
    message: `Got it — I've updated your ${FIELD_LABELS[field]} to ${applied.echo}.`,
  };
}
