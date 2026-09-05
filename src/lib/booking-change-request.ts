/**
 * Post-booking change requests for the public booking conversation.
 *
 * Pure functions only. Once a booking is committed the appointment is
 * historical: a later customer message can update their own contact/vehicle
 * details, but it can NEVER move, rebook or cancel the confirmed slot. Anything
 * that would affect the booking itself is handed to the owner for review and
 * clearly acknowledged to the customer.
 */

import { applyAnswer, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { FIELD_LABELS, hasCorrectionCue, type CorrectableStep } from "@/lib/web-chat-correction";
import { applyFieldDirectives, fieldUpdateMessage, type FieldUpdate } from "@/lib/web-chat-intake";

/** Fields whose new value changes what the crew turns up to, so the owner must see it. */
export const BOOKING_AFFECTING_FIELDS: CorrectableStep[] = ["service", "suburb", "vehicle"];

/** Words that mean "move/cancel the appointment" — never actioned automatically. */
const RESCHEDULE_CUE =
  /\b(reschedul\w*|re-?book\w*|cancel\w*|postpon\w*|move\s+(?:it|the|my)\b|different\s+(?:day|time|date)|another\s+(?:day|time|date)|earlier|later\s+(?:day|time|date))\b/i;

export const CHANGE_REQUEST_UNCLEAR =
  "Your booking is confirmed. If you'd like to change any details, tell me what to update — for example \u201Cchange my suburb to Burwood\u201D.";

export type ChangeRequestOutcome = {
  /** Nothing recognisable to act on. */
  kind: "unclear" | "detail_update" | "reschedule";
  collected: WebChatCollected;
  /** Fields updated on the canonical record (never the booking rows). */
  updates: FieldUpdate[];
  /** True when the owner must confirm before anything about the visit changes. */
  requiresOwnerReview: boolean;
  message: string;
};

function reviewSentence(tenantName: string): string {
  return `Your booking time stays as confirmed — ${tenantName} will confirm the change with you before anything about the visit changes.`;
}

/**
 * Interprets a message that arrives AFTER the booking was confirmed.
 *
 * Detail updates are applied to the collected values through the same
 * validation as a normal answer. Reschedule or cancellation wording is never
 * applied — it is escalated to the owner.
 */
export function evaluateBookingChangeRequest(input: {
  collected: WebChatCollected;
  raw: string;
  tenant: WebChatTenant;
  tenantName: string;
}): ChangeRequestOutcome {
  const raw = input.raw.trim();
  const base = { collected: input.collected, updates: [] as FieldUpdate[] };

  if (raw.length === 0)
    return { ...base, kind: "unclear", requiresOwnerReview: false, message: CHANGE_REQUEST_UNCLEAR };

  if (RESCHEDULE_CUE.test(raw)) {
    return {
      ...base,
      kind: "reschedule",
      requiresOwnerReview: true,
      message: `I can't move or cancel a confirmed booking myself. I've passed this to ${input.tenantName} to review, and they'll be in touch to confirm.`,
    };
  }

  // Same clause-by-clause directive parsing the live conversation uses, so one
  // message can carry several fields and no value bleeds across fields.
  const directives = applyFieldDirectives(raw, input.collected, input.tenant);
  let collected = directives.collected;
  const updates = [...directives.updates];

  // Single-field phrasing ("change the suburb to Burwood") that the multi-field
  // splitter left alone still has to land.
  if (updates.length === 0) {
    for (const field of ["service", "vehicle", "suburb", "concerns", "name", "mobile", "email"] as CorrectableStep[]) {
      const match = new RegExp(
        `\\b(?:${FIELD_LABELS[field].split(" ")[0]}|${field})\\b[^a-z0-9]{0,12}(?:to|is|=|:)\\s+([^,;.]+)`,
        "i",
      ).exec(raw);
      if (!match?.[1]) continue;
      const applied = applyAnswer(collected, field, match[1].trim(), input.tenant);
      if (!applied.ok) continue;
      collected = applied.collected;
      updates.push({ field, value: match[1].trim(), echo: match[1].trim() });
      break;
    }
  }

  if (updates.length === 0)
    return {
      ...base,
      kind: hasCorrectionCue(raw) ? "unclear" : "unclear",
      requiresOwnerReview: false,
      message: CHANGE_REQUEST_UNCLEAR,
    };

  const affectsBooking = updates.some((update) => BOOKING_AFFECTING_FIELDS.includes(update.field));
  const echo = fieldUpdateMessage(updates);
  return {
    kind: "detail_update",
    collected,
    updates,
    requiresOwnerReview: affectsBooking,
    message: affectsBooking
      ? `Thanks — I've updated ${echo}. ${reviewSentence(input.tenantName)}`
      : `Thanks — I've updated ${echo}. Your booking is unchanged.`,
  };
}
