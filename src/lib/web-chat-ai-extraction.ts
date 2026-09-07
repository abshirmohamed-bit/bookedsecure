/**
 * Structured AI extraction for the public quote conversation.
 *
 * PURE module: schema, prompt construction, candidate normalisation and
 * correction application. No network, no database, no model call — the call
 * itself lives in `web-chat-ai-extraction.server.ts`.
 *
 * Governing principle: the model only READS the customer's message and proposes
 * candidate field values. Every candidate is then:
 * - matched against this tenant's approved services / locations, and
 * - written through the same `applyAnswer` validation (and the containment
 *   guard) a typed answer goes through.
 *
 * The model can never create a booking, offer availability, grant consent, set
 * a price, send a message or resolve a field the customer did not state.
 */

import { z } from "zod";
import { normaliseAuMobile } from "@/lib/domain";
import { CUSTOMER_PUNCTUATION_INSTRUCTION } from "@/lib/customer-text";
import { applyAnswer, type WebChatCollected, type WebChatStep, type WebChatTenant } from "@/lib/web-chat";
import {
  QUESTION_TOPICS,
  classifyQuestionTopic,
  guardConversationalReply,
  looksLikeQuestion,
  looksUncertain,
  type QuestionTopic,
} from "@/lib/web-chat-conversation";
import {
  applyIntake,
  extractIntake,
  matchApprovedLocation,
  matchApprovedService,
  outstandingFields,
  preserveConfirmedService,
  trimNameTail,
  type IntakeExtraction,
  type IntakeField,
  type IntakeTenant,
} from "@/lib/web-chat-intake";


export const AI_EXTRACTION_FIELDS = [
  "service",
  "vehicle",
  "suburb",
  "address",
  "concerns",
  "name",
  "mobile",
] as const;
export type AiExtractionField = (typeof AI_EXTRACTION_FIELDS)[number];

/**
 * Strict, flat, constraint-free schema. No length bounds, formats or long
 * enums, so the gateway accepts it and a valid response never fails post-hoc
 * validation.
 */
export const WebChatAiExtractionSchema = z.object({
  service: z.string().nullable(),
  vehicle: z.string().nullable(),
  suburb: z.string().nullable(),
  /** Full street address (number and street), separate from the suburb. */
  address: z.string().nullable(),
  condition: z.string().nullable(),
  concerns: z.string().nullable(),
  name: z.string().nullable(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  corrections: z.array(z.object({ field: z.enum(AI_EXTRACTION_FIELDS), value: z.string() })),
  ambiguous_fields: z.array(z.enum(AI_EXTRACTION_FIELDS)),
  still_missing: z.array(z.enum(AI_EXTRACTION_FIELDS)),
  /** The customer asked something: which supported topic, or null. */
  question_topic: z.enum(QUESTION_TOPICS).nullable(),
  /** The customer is stuck choosing rather than supplying a value. */
  uncertain: z.boolean(),
  /** The request is outside what this chat handles. */
  unsupported: z.boolean(),
  /**
   * The model's natural wording for this turn: acknowledge what landed, answer
   * what was asked, and ask for at most the one thing still needed. It is
   * PHRASING ONLY — every claim in it is filtered by the server before the
   * customer reads it, and it can never change state.
   */
  reply: z.string().nullable(),
});


export type WebChatAiExtraction = z.infer<typeof WebChatAiExtractionSchema>;

/**
 * Parsing schema. The wire schema above stays strict, but a response (or a test
 * fixture) that omits the newer classification fields is still usable: they
 * default to "nothing detected" rather than discarding the whole extraction.
 */
export const WebChatAiExtractionParseSchema = WebChatAiExtractionSchema.extend({
  // Tolerated as absent so an older response shape still parses.
  address: z.string().nullable().catch(null).default(null),
  question_topic: z.enum(QUESTION_TOPICS).nullable().catch(null).default(null),
  uncertain: z.boolean().catch(false).default(false),
  unsupported: z.boolean().catch(false).default(false),
  reply: z.string().nullable().catch(null).default(null),
});


/** Maps a conversation step to the intake field it fills. */
export function stepToIntakeField(step: string): IntakeField | null {
  switch (step) {
    case "service":
      return "service";
    case "vehicle":
      return "vehicle";
    case "suburb":
      return "location";
    case "address":
      return "address";
    case "concerns":
      return "concerns";
    case "name":
      return "name";
    case "mobile":
      return "mobile";
    default:
      return null;
  }
}

function fieldToStep(field: AiExtractionField): WebChatStep {
  return field === "suburb" ? "suburb" : (field as WebChatStep);
}

function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text.length > 0 ? text : null;
}

// ---------------------------------------------------------------------------
// Prompt / context
// ---------------------------------------------------------------------------

export type AiExtractionContext = {
  businessName: string;
  services: string[];
  locations: string[];
  collected: WebChatCollected;
  outstanding: IntakeField[];
  openStep: string;
  turns: { role: string; body: string }[];
  message: string;
};

export const AI_EXTRACTION_TURNS = 6;

export function buildAiExtractionSystem(context: AiExtractionContext): string {
  return [
    `You read customer messages for ${context.businessName}, an Australian mobile car detailing business.`,
    "You interpret language only. The server decides everything: approved services, service area, availability, prices, consent, bookings, messages.",
    "Rules you must never break:",
    "- Read the ENTIRE customer message and extract every field it supplies, regardless of which question was last asked.",
    "- Return only information the customer actually stated. Never guess, infer or invent a value.",
    "- Never invent or state a price, availability, date, time, appointment, booking confirmation, consent or vehicle detail.",
    "- Never approve or substitute a service. Only name a service that appears in the approved list below, otherwise leave service null.",
    "- Only name a suburb the customer stated. Prefer an entry from the approved locations list when it matches.",
    "- Capture the full street address (unit/number and street name) in `address` when the customer states it, and keep the suburb in `suburb`. Never invent an address.",
    "- If the customer changes a value they gave earlier, list it in corrections with the new value.",
    "- If a value is genuinely ambiguous, list the field in ambiguous_fields and leave its value null.",
    "- Never ask for a field that is already present and valid in the current state.",
    "A message is not automatically an answer to the open question. Classify it as well as extracting from it:",
    "- Set question_topic when the customer asked something, using the closest topic. Otherwise null.",
    "- Set uncertain true when the customer is stuck choosing (\"something else\", \"not sure\", \"you tell me\", \"what do you recommend\") rather than supplying a value.",
    "- Set unsupported true only when the request is outside detailing enquiries entirely.",
    "- Uncertainty, a question or a refusal NEVER satisfies a field. Leave that field null, and still extract every other valid value in the message.",
    "- Extract valid values even when the message also contains a question or uncertainty. Never discard them.",
    "You also write the wording of the reply, in the `reply` field. Voice and rules for it:",
    "- Sound like a friendly, competent human on the other end of a text message. Warm, plain Australian English, no corporate tone, no emojis, no exclamation marks stacked up.",
    "- Keep it to one or two short sentences, under 240 characters total.",
    "- Shape: briefly acknowledge what they just told you, answer what they asked, then ask for at most ONE thing that is still missing. Never ask for two things at once.",
    "- Never re-ask anything already present in the current state. Reference it naturally instead (\"Got the Hilux in Auburn\").",
    "- When they change their mind about something they already gave, acknowledge the change naturally (\"No worries, changed it to Cabramatta\") and carry on.",
    "- When they say they want something not on the list, be welcoming about it: acknowledge, then ask what they need done, in their words.",
    "- When they are unsure which service, name the approved services from the list below and offer to help them pick.",
    "- Never state or imply a price, a cost, a date, a time, availability, an appointment, a booking or a confirmation, even if asked directly. Say the team confirms that, then move the conversation on.",
    "- Never name a service that is not in the approved list, and never invent any detail about the customer or the business.",
    `- ${CUSTOMER_PUNCTUATION_INSTRUCTION}`,
    "The server still decides everything: it validates every value, chooses the next question, and filters your reply. Write phrasing, not decisions.",
    "Reply with the JSON object only, using null for anything the customer did not state.",

    `Approved services: ${context.services.length > 0 ? context.services.join(", ") : "(none configured)"}`,
    `Approved locations: ${context.locations.length > 0 ? context.locations.join(", ") : "(none configured)"}`,
  ].join("\n");
}


export function buildAiExtractionPrompt(context: AiExtractionContext): string {
  const state = {
    service: context.collected.service_name ?? context.collected.typed_request ?? null,
    vehicle: context.collected.vehicle_type ?? null,
    suburb: context.collected.suburb ?? null,
    address: context.collected.service_address ?? null,
    concerns: context.collected.concerns ?? null,
    name: context.collected.name ?? null,
    mobile: context.collected.mobile_number ?? null,
  };
  const recent = context.turns
    .slice(-AI_EXTRACTION_TURNS)
    .map((turn) => `${turn.role === "customer" ? "Customer" : "Assistant"}: ${turn.body}`)
    .join("\n");
  return [
    "Current confirmed state (already collected and validated):",
    JSON.stringify(state, null, 2),
    "",
    `Question currently open: ${context.openStep}`,
    `Fields still missing: ${context.outstanding.length > 0 ? context.outstanding.join(", ") : "(none)"}`,
    "",
    "Recent conversation:",
    recent || "(no earlier turns)",
    "",
    "Latest customer message:",
    context.message,
    "",
    "Extract every field this message supplies, list any corrections to previously collected values, and list the fields still missing afterwards.",
    "Then write `reply`: your natural wording for this turn, following the voice rules.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Candidate normalisation
// ---------------------------------------------------------------------------

/**
 * Folds validated AI candidates into the deterministic regex extraction.
 *
 * The AI result is the STRONGER signal: where both produced a value, the AI
 * value wins; where the AI produced nothing, the regex value survives. Nothing
 * here writes to state — that is still `applyIntake`, which validates every
 * value and preserves fields already collected.
 */
export function mergeAiExtraction(
  base: IntakeExtraction,
  ai: WebChatAiExtraction,
  tenant: IntakeTenant,
): IntakeExtraction {
  const ambiguous = new Set<AiExtractionField>(ai.ambiguous_fields);
  const next: IntakeExtraction = { ...base, ambiguities: [...base.ambiguities], unmatched: { ...base.unmatched } };

  // A field the model flagged as ambiguous stays UNRESOLVED: the weaker regex
  // guess for it is dropped rather than silently stored.
  if (ambiguous.has("service")) next.service = null;
  if (ambiguous.has("suburb")) next.location = null;
  if (ambiguous.has("address")) next.address = null;
  if (ambiguous.has("vehicle")) next.vehicle = null;
  if (ambiguous.has("name")) next.name = null;
  if (ambiguous.has("mobile")) next.mobile = null;
  if (ambiguous.has("concerns")) next.notes = null;

  // Service: only ever an entry in this tenant's approved catalogue.
  const serviceText = ambiguous.has("service") ? null : trimmed(ai.service);
  if (serviceText) {
    const match = matchApprovedService(serviceText, tenant.services);
    if (match.kind === "one") {
      next.service = match.service;
      next.unmatched.service = null;
    } else if (match.kind === "ambiguous") {
      if (!next.ambiguities.some((entry) => entry.field === "service"))
        next.ambiguities.push({ field: "service", options: match.services.map((service) => service.name) });
    }
  }

  // Suburb: approved location when it matches, otherwise the customer's own word.
  const suburbText = ambiguous.has("suburb") ? null : trimmed(ai.suburb);
  if (suburbText) {
    const match = matchApprovedLocation(suburbText, tenant.locations);
    if (match.kind === "one") next.location = match.location;
    else if (match.kind === "ambiguous") {
      if (!next.ambiguities.some((entry) => entry.field === "location"))
        next.ambiguities.push({ field: "location", options: match.locations });
    } else next.location = suburbText;
  }

  const address = ambiguous.has("address") ? null : trimmed(ai.address);
  if (address) next.address = address;

  const vehicle = ambiguous.has("vehicle") ? null : trimmed(ai.vehicle);
  if (vehicle) next.vehicle = vehicle;

  const name = ambiguous.has("name") ? null : trimmed(ai.name);
  // Stored the way a person writes their name, never as raw lower case.
  if (name) next.name = trimNameTail(name) || name;

  const mobile = ambiguous.has("mobile") ? null : normaliseAuMobile(trimmed(ai.mobile) ?? "");
  if (mobile) next.mobile = mobile;

  const email = trimmed(ai.email);
  if (email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) next.email = email;

  // Condition and concerns are one canonical field.
  if (!ambiguous.has("concerns")) {
    const notes = [trimmed(ai.condition), trimmed(ai.concerns)].filter((part): part is string => Boolean(part));
    const combined = notes.length > 0 ? dedupeNotes(notes) : null;
    if (combined) next.notes = combined;
  }

  if (next.ambiguities.length > 0) next.intent = "ambiguous";
  else if (next.intent === "unclear") next.intent = "booking";

  return next;
}

function dedupeNotes(parts: string[]): string {
  const kept: string[] = [];
  for (const part of parts) {
    if (kept.some((entry) => entry.toLowerCase().includes(part.toLowerCase()))) continue;
    kept.push(part);
  }
  return kept.join(", ");
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type AiCorrection = { field: AiExtractionField; from: string | null; to: string };

function currentValue(collected: WebChatCollected, field: AiExtractionField): string | null {
  switch (field) {
    case "service":
      return collected.service_name ?? collected.typed_request ?? null;
    case "vehicle":
      return collected.vehicle_type ?? null;
    case "suburb":
      return collected.suburb ?? null;
    case "address":
      return collected.service_address ?? null;
    case "concerns":
      return collected.concerns ?? null;
    case "name":
      return collected.name ?? null;
    case "mobile":
      return collected.mobile_number ?? null;
  }
}

/**
 * Applies only corrections that are SUPPORTED (the field already holds a
 * different value) and VALID (the new value passes that field's validation).
 * Anything else is left unresolved.
 */
export function applyAiCorrections(
  collected: WebChatCollected,
  corrections: WebChatAiExtraction["corrections"],
  tenant: WebChatTenant,
  ambiguousFields: AiExtractionField[] = [],
): { collected: WebChatCollected; applied: AiCorrection[] } {
  const ambiguous = new Set(ambiguousFields);
  let next: WebChatCollected = { ...collected };
  const applied: AiCorrection[] = [];

  for (const correction of corrections) {
    if (ambiguous.has(correction.field)) continue;
    const value = trimmed(correction.value);
    if (!value) continue;
    const existing = currentValue(next, correction.field);
    // Not a correction when nothing was stored yet, or the value is unchanged:
    // the ordinary merge path handles those.
    if (!existing || existing.trim().toLowerCase() === value.toLowerCase()) continue;
    const result = applyAnswer({ ...next, reviewed: false }, fieldToStep(correction.field), value, tenant);
    if (!result.ok) continue;
    next = result.collected;
    if (!applied.some((entry) => entry.field === correction.field))
      applied.push({ field: correction.field, from: existing, to: result.echo });
  }

  return { collected: next, applied };
}

export function aiCorrectionMessage(applied: AiCorrection[]): string {
  const labels: Record<AiExtractionField, string> = {
    service: "service",
    vehicle: "vehicle",
    suburb: "suburb",
    address: "address",
    concerns: "condition notes",
    name: "name",
    mobile: "mobile number",
  };
  const parts = applied.map((entry) => `your ${labels[entry.field]} to ${entry.to}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Got it, I've updated ${list}.`;
}

// ---------------------------------------------------------------------------
// Orchestration (pure: no database, no network of its own)
// ---------------------------------------------------------------------------

/**
 * Cheap gate before the single model call: a one-word answer to the open
 * question cannot carry another field, so it stays on the deterministic path.
 */
export function mayCarryMultipleFields(raw: string): boolean {
  if (/[,;]/.test(raw)) return true;
  if (/\b(?:my|the)\s+(?:name|number|mobile|phone|email)\b/i.test(raw)) return true;
  if (/(?:\+?61[\s-]?4|\b0[\s-]?4)[\d\s-]{7,}/.test(raw)) return true;
  if (/[^@\s]+@[^@\s]+\.[a-z]{2,}/i.test(raw)) return true;
  return raw.split(/\s+/).filter(Boolean).length >= 4;
}

/**
 * Routing decision, by message SHAPE rather than word count: a short message
 * can still be a question ("prices?") or uncertainty ("something else"), and
 * discarding those is exactly the fault this layer exists to remove.
 */
export function shouldInterpret(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return false;
  // Every real typed message is interpreted now: the model reads it and writes
  // the wording, and a one-word answer is exactly where the old shape gates
  // dropped both the understanding and the natural reply.
  return true;
}

export type ResolvedIntake = {
  extraction: IntakeExtraction;
  collected: WebChatCollected;
  applied: IntakeField[];
  corrections: AiCorrection[];
  aiUsed: boolean;
  /** True when a validated value reached beyond the currently open question. */
  beyondOpenStep: boolean;
  /** Number of model calls made for this message. Always 0 or 1. */
  calls: number;
  /** Supported question the customer asked, or null. */
  question: QuestionTopic | null;
  /** The customer is stuck choosing rather than answering. */
  uncertain: boolean;
  /** Outside what this chat handles. */
  unsupported: boolean;
  /** Model-written wording for this turn, already guarded. Null when unusable. */
  reply: string | null;
};


/**
 * Understanding then control, in that order:
 * 1. deterministic regex pass (fallback / supplementary signal),
 * 2. at most ONE structured AI extraction call, folded over it,
 * 3. supported corrections applied through field validation,
 * 4. remaining candidates merged by `applyIntake`, which preserves fields
 *    already collected and revalidates every value.
 *
 * A failed, missing or unusable AI result changes nothing: the regex result is
 * used exactly as before.
 */
export async function resolveIntake(args: {
  raw: string;
  collected: WebChatCollected;
  chatTenant: WebChatTenant;
  intakeTenant: IntakeTenant;
  step: string;
  turns: { role: string; body: string }[];
  businessName: string;
  extract: (context: AiExtractionContext) => Promise<WebChatAiExtraction | null>;
  now?: Date;
}): Promise<ResolvedIntake> {
  const regexExtraction = extractIntake(args.raw, args.intakeTenant, args.now ?? new Date());

  let extraction = regexExtraction;
  let working = args.collected;
  let corrections: AiCorrection[] = [];
  let aiUsed = false;
  let calls = 0;
  // Deterministic fallback signals, used whenever the model is unavailable or
  // its output is unusable. They never write state.
  let question: QuestionTopic | null = null;
  let uncertain = looksUncertain(args.raw);
  let unsupported = false;
  let reply: string | null = null;

  if (shouldInterpret(args.raw)) {
    calls = 1;
    let ai: WebChatAiExtraction | null = null;
    try {
      ai = await args.extract({
        businessName: args.businessName,
        services: args.intakeTenant.services.map((service) => service.name),
        locations: args.intakeTenant.locations,
        collected: args.collected,
        outstanding: outstandingFields(args.collected),
        openStep: args.step,
        turns: args.turns,
        message: args.raw,
      });
    } catch {
      ai = null;
    }
    const parsed = ai ? WebChatAiExtractionParseSchema.safeParse(ai) : null;
    if (parsed?.success) {
      aiUsed = true;
      extraction = mergeAiExtraction(regexExtraction, parsed.data, args.intakeTenant);
      const corrected = applyAiCorrections(
        args.collected,
        parsed.data.corrections,
        args.chatTenant,
        parsed.data.ambiguous_fields,
      );
      working = corrected.collected;
      corrections = corrected.applied;
      question = parsed.data.question_topic;
      uncertain = uncertain || parsed.data.uncertain;
      unsupported = parsed.data.unsupported;
      // Phrasing only: every claim in it is filtered before the customer reads it.
      reply = guardConversationalReply(parsed.data.reply);
    }
  }

  // No usable interpretation: classify deterministically rather than silently
  // treating a question as an answer.
  if (!question && (looksLikeQuestion(args.raw) || uncertain)) {
    question = classifyQuestionTopic(args.raw);
  }

  // Uncertainty NEVER satisfies the service field: the phrase is not a service.
  if (uncertain && !args.collected.service_id) {
    extraction = { ...extraction, service: null };
  }

  // Precedence: a confirmed service is trusted, never re-resolved from later text.
  const serviceCorrected = corrections.some((entry) => entry.field === "service");
  if (!serviceCorrected) extraction = preserveConfirmedService(extraction, args.collected);

  const merged = applyIntake(working, extraction, args.chatTenant, {
    origin: aiUsed ? "extracted" : "customer",
  });
  const openField = stepToIntakeField(args.step);
  const beyondOpenStep =
    merged.applied.some((field) => field !== openField) || corrections.length > 0;

  return {
    extraction,
    collected: merged.collected,
    applied: merged.applied,
    corrections,
    aiUsed,
    beyondOpenStep,
    calls,
    question,
    uncertain,
    unsupported: unsupported || extraction.intent === "unsupported",
    reply,
  };
}

