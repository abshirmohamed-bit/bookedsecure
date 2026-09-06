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
import { applyAnswer, type WebChatCollected, type WebChatStep, type WebChatTenant } from "@/lib/web-chat";
import {
  applyIntake,
  extractIntake,
  matchApprovedLocation,
  matchApprovedService,
  outstandingFields,
  type IntakeExtraction,
  type IntakeField,
  type IntakeTenant,
} from "@/lib/web-chat-intake";

export const AI_EXTRACTION_FIELDS = [
  "service",
  "vehicle",
  "suburb",
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
  condition: z.string().nullable(),
  concerns: z.string().nullable(),
  name: z.string().nullable(),
  mobile: z.string().nullable(),
  email: z.string().nullable(),
  corrections: z.array(z.object({ field: z.enum(AI_EXTRACTION_FIELDS), value: z.string() })),
  ambiguous_fields: z.array(z.enum(AI_EXTRACTION_FIELDS)),
  still_missing: z.array(z.enum(AI_EXTRACTION_FIELDS)),
});

export type WebChatAiExtraction = z.infer<typeof WebChatAiExtractionSchema>;

/** Maps a conversation step to the intake field it fills. */
export function stepToIntakeField(step: string): IntakeField | null {
  switch (step) {
    case "service":
      return "service";
    case "vehicle":
      return "vehicle";
    case "suburb":
      return "location";
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
    "You are an extraction assistant, not the decision maker. The server controls every business action.",
    "Rules you must never break:",
    "- Read the ENTIRE customer message and extract every field it supplies, regardless of which question was last asked.",
    "- Return only information the customer actually stated. Never guess, infer or invent a value.",
    "- Never invent or state a price, availability, date, time, appointment, booking confirmation, consent or vehicle detail.",
    "- Never approve or substitute a service. Only name a service that appears in the approved list below, otherwise leave service null.",
    "- Only name a suburb the customer stated. Prefer an entry from the approved locations list when it matches.",
    "- If the customer changes a value they gave earlier, list it in corrections with the new value.",
    "- If a value is genuinely ambiguous, list the field in ambiguous_fields and leave its value null.",
    "- Never ask for a field that is already present and valid in the current state.",
    "- Reply with the JSON object only, using null for anything the customer did not state.",
    `Approved services: ${context.services.length > 0 ? context.services.join(", ") : "(none configured)"}`,
    `Approved locations: ${context.locations.length > 0 ? context.locations.join(", ") : "(none configured)"}`,
  ].join("\n");
}

export function buildAiExtractionPrompt(context: AiExtractionContext): string {
  const state = {
    service: context.collected.service_name ?? context.collected.typed_request ?? null,
    vehicle: context.collected.vehicle_type ?? null,
    suburb: context.collected.suburb ?? null,
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

  const vehicle = ambiguous.has("vehicle") ? null : trimmed(ai.vehicle);
  if (vehicle) next.vehicle = vehicle;

  const name = ambiguous.has("name") ? null : trimmed(ai.name);
  if (name) next.name = name;

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

  if (mayCarryMultipleFields(args.raw)) {
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
    const parsed = ai ? WebChatAiExtractionSchema.safeParse(ai) : null;
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
    }
  }

  const merged = applyIntake(working, extraction, args.chatTenant);
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
  };
}
