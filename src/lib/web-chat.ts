// Pure state machine for the public AI quote conversation.
// No database, no network, no model call — every prompt is derived from the
// tenant's own approved data, so nothing here can invent a service or a price.

import { normaliseAuMobile } from "@/lib/domain";
import { sanitiseCustomerText } from "@/lib/customer-text";
import { looksUncertain, uncertainServiceMessage } from "@/lib/web-chat-conversation";
import { usableName } from "@/lib/returning-lead";

import {
  BOOKING_CHANGE_CHOICE,
  BOOKING_CONFIRM_CHOICE,
  BOOKING_PROMPT_TEXT,
  bookingConfirmMessage,
  matchOfferByText,
  NO_SLOT_CHOICE,
  type PilotOffer,
} from "@/lib/web-chat-booking";

export const WEB_CHAT_STEPS = [
  "service",
  "vehicle",
  "suburb",
  "address",
  "concerns",
  "name",
  "mobile",
  "email",
  "review",
  "consent",
  "booking",
  "booking_confirm",
] as const;
export type WebChatStep = (typeof WEB_CHAT_STEPS)[number];

export const FLEXIBLE_CHOICE = "__other__";

export type WebChatService = {
  id: string;
  name: string;
  description: string | null;
  included_items: string | null;
  excluded_items: string | null;
  qualification_note: string | null;
};

export type WebChatTenant = {
  name: string;
  flexibleRequestsEnabled: boolean;
  /** True when this tenant takes real bookings in the conversation. */
  bookingEnabled?: boolean;
  services: WebChatService[];
};

export type WebChatCollected = {
  service_id?: string | null;
  service_name?: string | null;
  typed_request?: string | null;
  vehicle_type?: string | null;
  suburb?: string | null;
  /** Full street address the service is performed at. */
  service_address?: string | null;
  concerns?: string | null;
  name?: string | null;
  mobile_number?: string | null;
  email?: string | null;
  consent?: "granted" | "declined" | null;
  /** Set once the customer has confirmed the final review summary. */
  reviewed?: boolean | null;
  /** Pilot booking step: server-generated offers, set only by the server. */
  pilot_offers?: PilotOffer[] | null;
  booking_offered?: boolean | null;
  booking_selected?: string | null;
  booking_declined?: boolean | null;
  /** Set only when the customer has explicitly confirmed the held slot. */
  booking_confirmed?: boolean | null;
};

export type WebChatReviewField = { step: WebChatStep; label: string; value: string };

export type WebChatPrompt = {
  step: WebChatStep;
  text: string;
  kind: "choice" | "text" | "consent" | "review";
  optional?: boolean;
  options?: { value: string; label: string; detail: string | null }[];
  /** Present on the review step: every captured field, each individually changeable. */
  fields?: WebChatReviewField[];
};


export function welcomeMessage(tenant: WebChatTenant): string {
  return [
    `Hi — you're chatting with ${tenant.name}'s online quote assistant.`,
    tenant.bookingEnabled === true
      ? "Tell me what you need and I'll take a few details, then show you the times we actually have open."
      : "I can explain the services we offer, take your vehicle details and pass everything to the team for review.",
    tenant.bookingEnabled === true
      ? "I can't quote a price here — the team confirms pricing with you directly."
      : "I can't confirm prices or bookings here — the owner reviews every enquiry and replies to you directly.",
  ].join(" ");
}

export function serviceDetail(service: WebChatService): string | null {
  const parts = [
    service.description?.trim() || null,
    service.included_items?.trim() ? `Includes: ${service.included_items.trim()}` : null,
    service.excluded_items?.trim() ? `Not included: ${service.excluded_items.trim()}` : null,
    service.qualification_note?.trim() || null,
  ].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Details already on file for a contact arriving via their own campaign link.
 * The campaign could only have been sent because name/number (and usually
 * email) already exist, so those steps are prefilled and never re-asked.
 * A placeholder name ("web visitor", "unknown", …) is NOT prefilled — the
 * name step still runs so a real name is captured.
 */
export function campaignPrefill(lead: {
  name?: string | null;
  mobile_number?: string | null;
  email?: string | null;
}): Pick<WebChatCollected, "name" | "mobile_number" | "email"> | null {
  const mobile = (lead.mobile_number ?? "").trim();
  if (!mobile) return null;
  return {
    name: usableName(lead.name) ? (lead.name as string).trim() : null,
    mobile_number: mobile,
    email: (lead.email ?? "").trim() || null,
  };
}

/** First step that still needs an answer, or null when the conversation is complete. */
export function nextStep(collected: WebChatCollected): WebChatStep | null {
  if (collected.consent === "declined") return null;
  if (!collected.service_id && !(collected.typed_request ?? "").trim()) return "service";
  if (!(collected.vehicle_type ?? "").trim()) return "vehicle";
  if (!(collected.suburb ?? "").trim()) return "suburb";
  if (!(collected.service_address ?? "").trim()) return "address";
  if (!(collected.concerns ?? "").trim()) return "concerns";
  if (!(collected.name ?? "").trim()) return "name";
  if (!collected.mobile_number) return "mobile";
  if (collected.email === undefined) return "email";
  if (!collected.reviewed) return "review";
  if (!collected.consent) return "consent";
  // Pilot booking step, only once the server has offered real slots.
  if (
    collected.booking_offered === true &&
    !collected.booking_selected &&
    collected.booking_declined !== true
  ) {
    return "booking";
  }
  // Explicit final confirmation: a selected slot is only a hold until the
  // customer confirms the summary back. No booking exists before this.
  if (
    collected.booking_selected &&
    collected.booking_confirmed !== true &&
    collected.booking_declined !== true
  ) {
    return "booking_confirm";
  }
  return null;
}


/** Labelled summary of everything captured, for the final review step. */
export function reviewSummary(collected: WebChatCollected): WebChatReviewField[] {
  return [
    { step: "service", label: "Service", value: collected.service_name ?? collected.typed_request ?? "Not sure yet" },
    { step: "vehicle", label: "Vehicle", value: collected.vehicle_type ?? "—" },
    { step: "suburb", label: "Suburb", value: collected.suburb ?? "—" },
    { step: "address", label: "Address", value: collected.service_address ?? "—" },
    { step: "concerns", label: "Condition or concerns", value: collected.concerns ?? "—" },
    { step: "name", label: "Name", value: collected.name ?? "—" },
    { step: "mobile", label: "Mobile", value: collected.mobile_number ?? "—" },
    { step: "email", label: "Email", value: collected.email ?? "Not provided" },
  ];
}

export function reviewMessage(collected: WebChatCollected): string {
  const lines = reviewSummary(collected).map((row) => `${row.label}: ${row.value}`);
  return [
    "Quick check:",
    ...lines,
    "All right? Or tell me what to change, for example “suburb to Parramatta”.",
  ].join("\n");
}


/**
 * Every customer-facing prompt leaves this module through `promptFor`, which
 * applies the shared punctuation sanitizer. Booking logic is unaffected: only
 * display text passes through it.
 */
export function promptFor(
  step: WebChatStep,
  tenant: WebChatTenant,
  collected: WebChatCollected = {},
): WebChatPrompt {
  const prompt = buildPrompt(step, tenant, collected);
  return {
    ...prompt,
    text: sanitiseCustomerText(prompt.text),
    ...(prompt.options
      ? {
          options: prompt.options.map((option) => ({
            ...option,
            label: sanitiseCustomerText(option.label),
            detail: option.detail === null ? null : sanitiseCustomerText(option.detail),
          })),
        }
      : {}),
    ...(prompt.fields
      ? {
          fields: prompt.fields.map((field) => ({
            ...field,
            label: sanitiseCustomerText(field.label),
            value: typeof field.value === "string" ? sanitiseCustomerText(field.value) : field.value,
          })),
        }
      : {}),
  };
}

function buildPrompt(
  step: WebChatStep,
  tenant: WebChatTenant,
  collected: WebChatCollected = {},
): WebChatPrompt {
  switch (step) {
    case "service":
      return {
        step,
        kind: "choice",
        text: "Tell me what you need in your own words — for example “ceramic coating for my Mazda in Punchbowl next Tuesday”. You can also pick a service below.",
        options: [
          ...tenant.services.map((service) => ({
            value: service.id,
            label: service.name,
            detail: serviceDetail(service),
          })),
          ...(tenant.flexibleRequestsEnabled
            ? [
                {
                  value: FLEXIBLE_CHOICE,
                  label: "Something else or not sure",
                  detail: "Describe it and the owner will review your request.",
                },
              ]
            : []),
        ],
      };
    case "vehicle":
      return { step, kind: "text", text: "What's the vehicle? (make and model)" };
    case "suburb":
      return { step, kind: "text", text: "Which suburb is it in?" };
    case "address":
      return {
        step,
        kind: "text",
        text: "What's the street address we should come to? (number and street)",
      };
    case "concerns":
      return {
        step,
        kind: "text",
        text: "Anything we should know about the condition? (swirls, pet hair, water spots)",
      };
    case "name":
      return { step, kind: "text", text: "And your name?" };
    case "mobile":
      return { step, kind: "text", text: "Best mobile number to reply on?" };
    case "email":
      return { step, kind: "text", optional: true, text: "Email? Optional, say skip if you'd rather not." };
    case "review":
      return { step, kind: "review", text: reviewMessage(collected), fields: reviewSummary(collected) };
    case "consent":
      return {
        step,
        kind: "consent",
        text: `Last thing: happy for ${tenant.name} to contact you about this, including by SMS? Reply STOP any time to opt out.`,
      };

    case "booking":
      return {
        step,
        kind: "choice",
        text: BOOKING_PROMPT_TEXT,
        options: [
          ...(collected.pilot_offers ?? []).map((offer) => ({
            value: offer.offer_id,
            label: offer.label,
            detail: null,
          })),
          { value: NO_SLOT_CHOICE, label: "None of these work", detail: null },
        ],
      };
    case "booking_confirm": {
      const held = (collected.pilot_offers ?? []).find(
        (offer) => offer.offer_id === collected.booking_selected,
      );
      return {
        step,
        kind: "choice",
        text: bookingConfirmMessage({
          businessName: tenant.name,
          serviceName: collected.service_name ?? collected.typed_request ?? null,
          suburb: collected.suburb ?? null,
          vehicle: collected.vehicle_type ?? null,
          slotLabel: held?.label ?? "the time you picked",
        }),
        options: [
          { value: BOOKING_CONFIRM_CHOICE, label: "Yes, confirm this booking", detail: null },
          { value: BOOKING_CHANGE_CHOICE, label: "Pick a different time", detail: null },
        ],
      };
    }
  }
}


/**
 * Names an approved service from the customer's own words.
 *
 * A corrected or restated service ("change the service to Full Interior
 * Detail") must land on the tenant's approved service, not on a free-text
 * request that would send a perfectly ordinary booking to owner review.
 * Deterministic name matching only — never a guess, never a new service.
 */
function serviceByName(
  value: string,
  services: WebChatTenant["services"],
): { kind: "one"; service: WebChatTenant["services"][number] } | { kind: "ambiguous"; services: WebChatTenant["services"] } | { kind: "none" } {
  const norm = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(value);
  if (target.length < 3) return { kind: "none" };
  const exact = services.filter((service) => norm(service.name) === target);
  if (exact.length === 1) return { kind: "one", service: exact[0]! };
  if (exact.length > 1) return { kind: "ambiguous", services: exact };
  const contained = services.filter((service) => {
    const name = norm(service.name);
    return name.length >= 3 && (target.includes(name) || name.includes(target));
  });
  if (contained.length === 1) return { kind: "one", service: contained[0]! };
  if (contained.length > 1) return { kind: "ambiguous", services: contained };
  return { kind: "none" };
}

/**
 * CONTAINMENT GUARD, data integrity rather than response quality.
 *
 * A raw multi-clause customer message must never be written directly into a
 * single canonical field. When the multi-field intake pass declines a message,
 * the whole sentence reaches `applyAnswer` for the one open step; without this
 * guard it would be stored verbatim as the suburb, vehicle, name or condition
 * and travel on into the CRM, the owner alert and the customer text.
 *
 * The guard is shape-only: no model, no network, no new dependency. It rejects
 * values that are clearly a whole message rather than a field value, and never
 * mutates state, so the raw text survives only in the conversation transcript.
 */
const NAME_MARKER = /\b(?:my|the)\s+name\s+(?:is|was)\b|\bmy name'?s\b|\bname\s+is\b/i;
const CONTACT_MARKER =
  /\b(?:my|the)?\s*(?:number|mobile|phone|email)\s+(?:is|are)\b|\b(?:call|ring|text|contact)\s+me\s+on\b/i;
const AU_PHONE_LIKE = /(?:\+?61[\s-]?4|\b0[\s-]?4)[\d\s-]{7,}/;
const EMAIL_LIKE = /[^@\s]+@[^@\s]+\.[a-z]{2,}/i;

function clauseParts(text: string): string[] {
  return text
    .split(/[,;]|\b(?:and then|and also)\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Evidence the value carries a field other than the one being answered. */
function carriesOtherFields(
  step: "suburb" | "vehicle" | "name" | "concerns" | "address",
  value: string,
): boolean {
  if (CONTACT_MARKER.test(value) || AU_PHONE_LIKE.test(value) || EMAIL_LIKE.test(value)) return true;
  // "my name is ..." is a perfectly good answer at the name step itself.
  return step !== "name" && NAME_MARKER.test(value);
}

const SHAPE_LIMITS: Record<"suburb" | "name" | "vehicle", number> = {
  suburb: 40,
  name: 40,
  vehicle: 60,
};

const FIELD_HINT: Record<"suburb" | "vehicle" | "name" | "concerns", string> = {
  suburb: "Just the suburb is fine, for example Auburn.",
  vehicle: "Just the vehicle is fine, for example Mazda 3.",
  name: "Just your first name is fine, for example Abshir.",
  concerns: "A short description of the condition is all I need here, I'll take your details next.",
};

function shapeRejection(
  step: "suburb" | "vehicle" | "name" | "concerns",
  value: string,
  origin: AnswerOrigin = "customer",
): string | null {
  if (carriesOtherFields(step, value)) return FIELD_HINT[step];
  const parts = clauseParts(value);
  if (step === "concerns") {
    // An extracted note has already been separated from the other fields, so
    // the "whole message stuffed into one field" heuristic does not apply.
    if (origin === "extracted") return null;
    // Descriptive prose is welcome. Only a list of unrelated fragments, the
    // shape of a whole message stuffed into one field, is refused.
    const average = parts.reduce((sum, part) => sum + part.length, 0) / Math.max(parts.length, 1);
    if (parts.length >= 3 && average < 25) return FIELD_HINT.concerns;
    return null;
  }
  if (value.length > SHAPE_LIMITS[step] || parts.length >= 3) return FIELD_HINT[step];
  return null;
}


export type ApplyResult =


  | { ok: true; collected: WebChatCollected; echo: string }
  | { ok: false; error: string };

/** Where a value came from: a customer keystroke, or structured extraction. */
export type AnswerOrigin = "customer" | "extracted";

export function applyAnswer(
  collected: WebChatCollected,
  step: WebChatStep,
  raw: string,
  tenant: WebChatTenant,
  options?: { origin?: AnswerOrigin },
): ApplyResult {
  const origin: AnswerOrigin = options?.origin ?? "customer";
  const value = raw.trim().slice(0, 500);
  const next: WebChatCollected = { ...collected };

  switch (step) {
    case "service": {
      if (value === FLEXIBLE_CHOICE) {
        if (!tenant.flexibleRequestsEnabled) return { ok: false, error: "Please choose one of the listed services." };
        next.service_id = null;
        next.service_name = null;
        next.typed_request = "Not sure yet — described below";
        return { ok: true, collected: next, echo: "Something else or not sure" };
      }
      const service = tenant.services.find((entry) => entry.id === value);
      if (service) {
        next.service_id = service.id;
        next.service_name = service.name;
        next.typed_request = null;
        return { ok: true, collected: next, echo: service.name };
      }
      if (value.length < 2) return { ok: false, error: "Please choose a service or describe what you need." };
      // A restated or corrected service that names one of the tenant's own
      // approved services is that service — it never becomes a free-text
      // request, so booking stays available.
      const named = serviceByName(value, tenant.services);
      if (named.kind === "one") {
        next.service_id = named.service.id;
        next.service_name = named.service.name;
        next.typed_request = null;
        return { ok: true, collected: next, echo: named.service.name };
      }
      if (named.kind === "ambiguous") {
        const names = named.services.map((service) => service.name);
        return {
          ok: false,
          error: `Which one did you mean: ${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}?`,
        };
      }
      if (!tenant.flexibleRequestsEnabled) return { ok: false, error: "Please choose one of the listed services." };
      // "I need something else", "not sure", "you tell me": uncertainty is not a
      // service request and is never stored as one.
      if (looksUncertain(value)) {
        return { ok: false, error: uncertainServiceMessage({
          businessName: tenant.name,
          services: tenant.services.map((service) => ({ name: service.name, description: service.description })),
          locations: [],
          outstanding: [],
          bookingEnabled: tenant.bookingEnabled === true,
        }) };
      }

      next.service_id = null;
      next.service_name = null;
      next.typed_request = value;
      return { ok: true, collected: next, echo: value };

    }
    case "vehicle": {
      if (value.length < 2) return { ok: false, error: "Please tell me the vehicle type." };
      const rejection = shapeRejection("vehicle", value);
      if (rejection) return { ok: false, error: rejection };
      next.vehicle_type = value;
      return { ok: true, collected: next, echo: value };
    }
    case "suburb": {
      // Trailing sentence punctuation is never part of a suburb name.
      const suburb = value.replace(/[\s.,;:]+$/, "");
      if (suburb.length < 2) return { ok: false, error: "Please tell me the suburb." };
      const rejection = shapeRejection("suburb", suburb);
      if (rejection) return { ok: false, error: rejection };
      next.suburb = suburb;
      return { ok: true, collected: next, echo: suburb };
    }
    case "address": {
      const address = value.replace(/[\s.,;:]+$/, "");
      if (address.length < 4 || address.split(/\s+/).filter(Boolean).length < 2) {
        return { ok: false, error: "Please give the street number and street name." };
      }
      // An address is naturally multi-word, so only foreign fields are refused.
      if (carriesOtherFields("address", address)) {
        return { ok: false, error: "Just the street address is fine, for example 12 Smith St." };
      }
      if (address.length > 160) return { ok: false, error: "Please give a shorter street address." };
      next.service_address = address;
      return { ok: true, collected: next, echo: address };
    }
    case "concerns": {
      if (value.length < 2) return { ok: false, error: "A short description of the condition helps the team." };
      const rejection = shapeRejection("concerns", value, origin);
      if (rejection) return { ok: false, error: rejection };
      next.concerns = value;
      return { ok: true, collected: next, echo: value };
    }
    case "name": {
      if (value.length < 2) return { ok: false, error: "Please tell me your name." };
      const rejection = shapeRejection("name", value);
      if (rejection) return { ok: false, error: rejection };
      next.name = value;
      return { ok: true, collected: next, echo: value };
    }

    case "mobile": {
      const mobile = normaliseAuMobile(value);
      if (!mobile) return { ok: false, error: "That doesn't look like an Australian mobile number." };
      next.mobile_number = mobile;
      return { ok: true, collected: next, echo: mobile };
    }
    case "email": {
      // The customer's own words for "I don't have one" are accepted as a skip —
      // they are never stored as an email address.
      if (value === "" || /^(skip|none|nope?|no|no email|n\/a|na|nil)$/i.test(value)) {
        next.email = null;
        return { ok: true, collected: next, echo: "No email" };
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) || value.length > 120) {
        return { ok: false, error: "That email doesn't look right — or say “skip”." };
      }
      next.email = value;
      return { ok: true, collected: next, echo: value };
    }
    case "review": {
      if (
        /^(yes|yep|yeah|confirm(ed)?|correct|ok(ay)?|good|send it|no changes|nothing)\b|\b(looks|sounds)\s+(good|right|correct)\b|\ball good\b|\bthat'?s (right|correct)\b/i.test(
          value,
        )
      ) {
        next.reviewed = true;
        return { ok: true, collected: next, echo: "That all looks right" };
      }
      return {
        ok: false,
        error:
          "No problem — which detail should I change? For example “change my suburb to Parramatta” or “my name is Abshiro”.",
      };
    }
    case "consent": {
      if (value === "granted" || /^(yes|yep|yeah|yup|sure|ok(ay)?|fine|of course|that'?s fine|no worries|all good|go ahead|agreed?|i (do|agree))\b/i.test(value)) {
        next.consent = "granted";
        return { ok: true, collected: next, echo: "Yes, that's fine" };
      }
      if (value === "declined" || /^(no|nope|nah|no thanks?|don'?t|do not|rather not|opt out|stop)\b/i.test(value)) {
        next.consent = "declined";
        return { ok: true, collected: next, echo: "No thanks" };
      }
      // Consent is never inferred from an unclear reply.
      return { ok: false, error: "Just so I'm sure: is it OK for us to contact you about this? Yes or no is fine." };
    }
    case "booking": {
      if (
        value === NO_SLOT_CHOICE ||
        /\b(none of (these|them)|none work|nothing works|no good|another day|different day)\b/i.test(value)
      ) {
        next.booking_declined = true;
        next.booking_selected = null;
        return { ok: true, collected: next, echo: "None of these work" };
      }
      // Only an offer the server itself generated for this conversation is valid:
      // a substituted, stale or cross-tenant id never reaches the commit path.
      const offers = collected.pilot_offers ?? [];
      const offer =
        offers.find((entry) => entry.offer_id === value) ?? matchOfferByText(value, offers);
      if (!offer)
        return {
          ok: false,
          error: `Which one suits: ${offers.map((entry) => entry.label).join(", ")}?`,
        };
      next.booking_selected = offer.offer_id;
      next.booking_declined = false;
      next.booking_confirmed = false;
      return { ok: true, collected: next, echo: offer.label };
    }

    case "booking_confirm": {
      if (
        value === BOOKING_CONFIRM_CHOICE ||
        /^(yes|yep|yeah|confirm(ed)?|ok(ay)?|book it|go ahead|please do)\b/i.test(value)
      ) {
        next.booking_confirmed = true;
        return { ok: true, collected: next, echo: "Yes, confirm this booking" };
      }
      if (
        value === BOOKING_CHANGE_CHOICE ||
        /\b(different|another|change|other)\s+(time|slot|day)\b|^(no|nope)\b/i.test(value)
      ) {
        next.booking_selected = null;
        next.booking_confirmed = false;
        return { ok: true, collected: next, echo: "Pick a different time" };
      }
      return {
        ok: false,
        error: "Just to be safe — should I confirm that time, or would you rather pick a different one?",
      };
    }
  }

}

export type WebChatOutcome = {
  requiresOwnerReview: boolean;
  unsupportedRequest: string | null;
};

/**
 * A typed / unmatched request is never treated as an approved service: it is
 * recorded verbatim and routed to the owner for review.
 */
export function resolveOutcome(collected: WebChatCollected): WebChatOutcome {
  const typed = (collected.typed_request ?? "").trim();
  if (collected.service_id) return { requiresOwnerReview: false, unsupportedRequest: null };
  return { requiresOwnerReview: true, unsupportedRequest: typed.length > 0 ? typed : null };
}

export function completionMessage(tenant: WebChatTenant, outcome: WebChatOutcome): string {
  if (outcome.requiresOwnerReview) {
    return [
      `Thanks, that's with ${tenant.name} now.`,
      "It isn't a straight match for a listed service, so the owner will look at it and get back to you. Nothing is booked yet.",
    ].join(" ");
  }
  return [
    `Thanks, ${tenant.name} has your details.`,
    "The team will reply to you directly. Nothing is booked yet.",
  ].join(" ");
}


export const DECLINED_MESSAGE =
  "No problem — without consent we can't contact you about this enquiry, so I haven't passed your details on. You're welcome to call the business directly instead.";

export const DUPLICATE_MESSAGE =
  "It looks like we already have a very recent enquiry from this mobile number, so I haven't created a second one. The team will be in touch about the first one.";
