/**
 * Conversational layer for the public quote chat.
 *
 * PURE module: no database, no network, no model call.
 *
 * Governing principle unchanged: the model may INTERPRET language, the server
 * decides everything. Nothing here can invent a service, a price, an
 * availability claim, consent or a booking. every answer is composed from
 * facts the tenant already configured, and anything not on file becomes an
 * honest deflection rather than a guess.
 */

import { sanitiseCustomerText } from "@/lib/customer-text";
import type { IntakeField } from "@/lib/web-chat-intake";

// ---------------------------------------------------------------------------
// Availability (all tenants)
// ---------------------------------------------------------------------------

/**
 * Conversational intake is now the behaviour of the public chat for EVERY
 * tenant: questions are answered from that tenant's own configured facts, and
 * uncertainty is never stored as a value. There is no per-tenant flag, because
 * nothing here is tenant-specific. every sentence is composed from the facts
 * passed in for the tenant being served.
 */
export function isConversationalIntakeTenant(_businessId: string): boolean {
  return true;
}


// ---------------------------------------------------------------------------
// Question topics
// ---------------------------------------------------------------------------

export const QUESTION_TOPICS = [
  "services",
  "service_detail",
  "service_area",
  "outstanding",
  "next_step",
  "times",
  "time_selection",
  "consent",
  "confirmation",
  "price",
  "other",
] as const;
export type QuestionTopic = (typeof QUESTION_TOPICS)[number];

// ---------------------------------------------------------------------------
// Uncertainty ("I need something else", "not sure", ...)
// ---------------------------------------------------------------------------

const UNCERTAINTY_PATTERNS: RegExp[] = [
  /\bsomething (?:else|different|other)\b/i,
  /\bneed something (?:else|different)\b/i,
  /\bnot (?:really )?sure\b/i,
  /\b(?:i )?(?:dont|don't|do not) know\b/i,
  /\byou tell me\b/i,
  /\bwhat do you recommend\b/i,
  /\bwhat would you (?:recommend|suggest)\b/i,
  /\b(?:can you )?help me choose\b/i,
  /\bwhatever (?:is|s) best\b/i,
  /\bwhichever is best\b/i,
  /\bi need help\b/i,
  /\bno idea\b/i,
];

/** True when the message expresses uncertainty rather than supplying a value. */
export function looksUncertain(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return false;
  return UNCERTAINTY_PATTERNS.some((pattern) => pattern.test(text));
}

/** Deterministic question detection, used when the model returns no topic. */
export function looksLikeQuestion(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return false;
  if (text.includes("?")) return true;
  return /\b(?:what|which|when|where|how much|how long|how do|do you|can you|are you|is it|will you)\b/i.test(text);
}

/** Best-effort topic from the customer's own words. Never guesses a fact. */
export function classifyQuestionTopic(raw: string): QuestionTopic | null {
  const text = raw.toLowerCase();
  if (!looksLikeQuestion(raw) && !looksUncertain(raw)) return null;
  if (/\b(?:price|cost|how much|quote|charge|fee)\b/.test(text)) return "price";
  if (/\b(?:service|services|packages?|options?|recommend|detail(?:ing)?)\b/.test(text)) return "services";
  if (/\b(?:come to|service area|travel|do you cover|area|suburb)\b/.test(text)) return "service_area";
  if (/\b(?:times?|slots?|availab|when can|book me in)\b/.test(text)) return "times";
  if (/\b(?:consent|opt out|stop|privacy|spam)\b/.test(text)) return "consent";
  if (/\b(?:what(?:'s| is)? next|what happens|after this)\b/.test(text)) return "next_step";
  if (/\b(?:what else|anything else|still need|need from me)\b/.test(text)) return "outstanding";
  return "other";
}

// ---------------------------------------------------------------------------
// Deterministic answerer (Phase 2)
// ---------------------------------------------------------------------------

export type AnswerFacts = {
  businessName: string;
  /** Approved services, with their configured description when one exists. */
  services: { name: string; description: string | null }[];
  /** Approved service area entries, tenant-configured. */
  locations: string[];
  /** Fields still genuinely missing from canonical state. */
  outstanding: IntakeField[];
  bookingEnabled: boolean;
  /** Suburb already captured, used for a service-area answer. */
  suburb?: string | null;
};

const FIELD_WORD: Record<IntakeField, string> = {
  service: "the service",
  vehicle: "the vehicle",
  location: "the suburb",
  address: "the street address",
  concerns: "the condition",
  name: "your name",
  mobile: "your mobile number",
};

function serviceList(facts: AnswerFacts): string | null {
  const names = facts.services.map((service) => service.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

const CANNOT_CONFIRM = "I can't confirm that here, but the team can review it.";

/**
 * Answers ONLY from facts already on file. Returns null when there is nothing
 * approved to say, so the caller falls back to the open question rather than
 * letting anything be invented.
 */
export function answerQuestion(topic: QuestionTopic, facts: AnswerFacts): string | null {
  switch (topic) {
    case "services":
    case "service_detail": {
      const list = serviceList(facts);
      return list ? `We do ${list}. Pick one below, or tell me what needs attention.` : null;
    }
    case "service_area": {
      if (facts.locations.length === 0) return null;
      const suburb = (facts.suburb ?? "").trim();
      if (suburb.length > 0) {
        const covered = facts.locations.some(
          (entry) => entry.toLowerCase() === suburb.toLowerCase(),
        );
        if (covered) return `Yes, we cover ${suburb}.`;
      }
      return `We cover ${facts.locations.slice(0, 6).join(", ")}.`;
    }
    case "outstanding": {
      if (facts.outstanding.length === 0) return "Nothing else, I have what I need.";
      const words = facts.outstanding.map((field) => FIELD_WORD[field]);
      const list = words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : words[0];
      return `Still need ${list}.`;
    }
    case "next_step":
      return facts.bookingEnabled
        ? `Once I have your details I'll show the times ${facts.businessName} has open.`
        : `I pass everything to ${facts.businessName} and they reply to you directly.`;
    case "times":
      return facts.bookingEnabled
        ? "I'll show the open times once I have your details. Nothing is held until you pick one."
        : null;
    case "time_selection":
      return "Just name one of the times listed and I'll show it back before anything is locked in.";
    case "consent":
      return `It's permission for ${facts.businessName} to reply about this enquiry. Reply STOP any time to opt out.`;
    case "confirmation":
      return "Yes confirms that time. Nothing is booked until you do.";
    case "price":
      return `I can't quote a price here, ${facts.businessName} confirms pricing with you directly.`;
    case "other":
      return null;
  }
}

/** Shown when the customer is stuck choosing a service. */
export function uncertainServiceMessage(facts: AnswerFacts): string {
  const list = serviceList(facts);
  return list
    ? `Sure. We do ${list}. Pick one below, or tell me what needs attention.`
    : "Sure. Tell me what needs attention and I'll show you the closest options.";
}

// ---------------------------------------------------------------------------
// Reply assembly (Phase 3)
// ---------------------------------------------------------------------------

export type ReplyParts = {
  /** Short acknowledgement of what landed this turn. */
  acknowledgement?: string | null;
  /** Answer to a supported question, already composed from tenant facts. */
  answer?: string | null;
  /** The single next thing genuinely needed. */
  ask?: string | null;
};

/**
 * One reply per turn, in a fixed order: acknowledge, answer, ask. Duplicate and
 * empty parts are dropped so the customer never reads the same sentence twice.
 */
export function assembleReply(parts: ReplyParts): string[] {
  const ordered = [parts.acknowledgement, parts.answer, parts.ask];
  const kept: string[] = [];
  for (const part of ordered) {
    const text = (part ?? "").trim();
    if (text.length === 0) continue;
    if (kept.some((entry) => entry.toLowerCase() === text.toLowerCase())) continue;
    kept.push(text);
  }
  return kept;
}

/** "Got it, Toyota HiAce in Auburn.". only ever echoes validated values. */
export function acknowledgeFields(values: { label: IntakeField; value: string }[]): string | null {
  const parts = values
    .filter((entry) => entry.label !== "service" && (entry.value ?? "").trim().length > 0)
    .map((entry) => entry.value.trim());
  if (parts.length === 0) return null;
  if (parts.length === 1) return `Got it, ${parts[0]}.`;
  return `Got it, ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}.`;
}

/** Deflection used when a question has no supporting tenant fact. */
export function unsupportedAnswer(facts: AnswerFacts): string {
  const list = serviceList(facts);
  return list && facts.outstanding.includes("service")
    ? `${CANNOT_CONFIRM} Which service would you like?`
    : CANNOT_CONFIRM;
}


// ---------------------------------------------------------------------------
// Model-written reply text (guarded)
// ---------------------------------------------------------------------------

/**
 * Sentences a model-written reply may never contain. A reply that promises a
 * price, a time, availability or a booking is not phrasing, it is a business
 * decision, and only the server makes those.
 */
const REPLY_BANNED_PATTERNS: RegExp[] = [
  /\$\s?\d/,
  /\b\d+\s?(?:dollars|aud)\b/i,
  /\b(?:price|cost|costs|quote|charge|fee|fees|deposit|discount)\b/i,
  /\b(?:today|tonight|tomorrow|this (?:morning|afternoon|evening|weekend)|next week|this week)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\bavailab/i,
  /\bbooked\b|\bbooking is confirmed\b|\bconfirmed your booking\b|\bslot\b|\bappointment\b/i,
  /\bguarantee/i,
];

/** Longest model-written reply the customer ever reads. */
const REPLY_MAX_CHARS = 240;

/**
 * Keeps the model's phrasing, drops its claims.
 *
 * Sentence-by-sentence: anything touching price, time, availability or a
 * booking is removed rather than trusted, the rest is punctuation-sanitised and
 * length-capped. Returns null when nothing safe survives, so the caller falls
 * back to the deterministic sentences.
 */
export function guardConversationalReply(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return null;
  const safe = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !REPLY_BANNED_PATTERNS.some((pattern) => pattern.test(sentence)))
    .join(" ")
    .trim();
  if (safe.length === 0) return null;
  const capped = safe.length > REPLY_MAX_CHARS ? `${safe.slice(0, REPLY_MAX_CHARS).trimEnd()}` : safe;
  const cleaned = sanitiseCustomerText(capped).trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** True when the reply already asks the customer something. */
export function replyAsksSomething(reply: string): boolean {
  return reply.includes("?");
}
