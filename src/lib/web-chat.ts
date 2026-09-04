// Pure state machine for the public AI quote conversation.
// No database, no network, no model call — every prompt is derived from the
// tenant's own approved data, so nothing here can invent a service or a price.

import { normaliseAuMobile } from "@/lib/domain";
import {
  BOOKING_PROMPT_TEXT,
  NO_SLOT_CHOICE,
  type PilotOffer,
} from "@/lib/web-chat-booking";

export const WEB_CHAT_STEPS = [
  "service",
  "vehicle",
  "suburb",
  "concerns",
  "name",
  "mobile",
  "email",
  "review",
  "consent",
  "booking",
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
  services: WebChatService[];
};

export type WebChatCollected = {
  service_id?: string | null;
  service_name?: string | null;
  typed_request?: string | null;
  vehicle_type?: string | null;
  suburb?: string | null;
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
    "I can explain the services we offer, take your vehicle details and pass everything to the team for review.",
    "I can't confirm prices or bookings here — the owner reviews every enquiry and replies to you directly.",
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

/** First step that still needs an answer, or null when the conversation is complete. */
export function nextStep(collected: WebChatCollected): WebChatStep | null {
  if (collected.consent === "declined") return null;
  if (!collected.service_id && !(collected.typed_request ?? "").trim()) return "service";
  if (!(collected.vehicle_type ?? "").trim()) return "vehicle";
  if (!(collected.suburb ?? "").trim()) return "suburb";
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
  return null;
}


/** Labelled summary of everything captured, for the final review step. */
export function reviewSummary(collected: WebChatCollected): WebChatReviewField[] {
  return [
    { step: "service", label: "Service", value: collected.service_name ?? collected.typed_request ?? "Not sure yet" },
    { step: "vehicle", label: "Vehicle", value: collected.vehicle_type ?? "—" },
    { step: "suburb", label: "Suburb", value: collected.suburb ?? "—" },
    { step: "concerns", label: "Condition or concerns", value: collected.concerns ?? "—" },
    { step: "name", label: "Name", value: collected.name ?? "—" },
    { step: "mobile", label: "Mobile", value: collected.mobile_number ?? "—" },
    { step: "email", label: "Email", value: collected.email ?? "Not provided" },
  ];
}

export function reviewMessage(collected: WebChatCollected): string {
  const lines = reviewSummary(collected).map((row) => `${row.label}: ${row.value}`);
  return [
    "Here's what I have so far:",
    ...lines,
    "Want to change anything before we send this to the team? Just tell me what to update — for example “change my suburb to Parramatta”.",
  ].join("\n");
}

export function promptFor(
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
      return { step, kind: "text", text: "What type of vehicle is it? (make, model or body type)" };
    case "suburb":
      return { step, kind: "text", text: "Which suburb is the vehicle in?" };
    case "concerns":
      return {
        step,
        kind: "text",
        text: "How's the condition, and what's your main concern? (for example swirls, pet hair, water spots)",
      };
    case "name":
      return { step, kind: "text", text: "What's your name?" };
    case "mobile":
      return { step, kind: "text", text: "What's the best Australian mobile number for the team to reply on?" };
    case "email":
      return { step, kind: "text", optional: true, text: "Email address? This one's optional — you can skip it." };
    case "review":
      return { step, kind: "review", text: reviewMessage(collected), fields: reviewSummary(collected) };
    case "consent":
      return {
        step,
        kind: "consent",
        text: `Last step: do you agree to ${tenant.name} contacting you about this enquiry, including by SMS? Reply STOP at any time to opt out.`,
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
  }
}


export type ApplyResult =
  | { ok: true; collected: WebChatCollected; echo: string }
  | { ok: false; error: string };

export function applyAnswer(
  collected: WebChatCollected,
  step: WebChatStep,
  raw: string,
  tenant: WebChatTenant,
): ApplyResult {
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
      if (!tenant.flexibleRequestsEnabled) return { ok: false, error: "Please choose one of the listed services." };
      next.service_id = null;
      next.service_name = null;
      next.typed_request = value;
      return { ok: true, collected: next, echo: value };
    }
    case "vehicle":
      if (value.length < 2) return { ok: false, error: "Please tell me the vehicle type." };
      next.vehicle_type = value;
      return { ok: true, collected: next, echo: value };
    case "suburb":
      if (value.length < 2) return { ok: false, error: "Please tell me the suburb." };
      next.suburb = value;
      return { ok: true, collected: next, echo: value };
    case "concerns":
      if (value.length < 2) return { ok: false, error: "A short description of the condition helps the team." };
      next.concerns = value;
      return { ok: true, collected: next, echo: value };
    case "name":
      if (value.length < 2) return { ok: false, error: "Please tell me your name." };
      next.name = value;
      return { ok: true, collected: next, echo: value };
    case "mobile": {
      const mobile = normaliseAuMobile(value);
      if (!mobile) return { ok: false, error: "That doesn't look like an Australian mobile number." };
      next.mobile_number = mobile;
      return { ok: true, collected: next, echo: mobile };
    }
    case "email": {
      if (value === "" || value.toLowerCase() === "skip") {
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
      const granted = value === "granted" || value.toLowerCase() === "yes";
      next.consent = granted ? "granted" : "declined";
      return { ok: true, collected: next, echo: granted ? "Yes, that's fine" : "No thanks" };
    }
    case "booking": {
      if (value === NO_SLOT_CHOICE) {
        next.booking_declined = true;
        next.booking_selected = null;
        return { ok: true, collected: next, echo: "None of these work" };
      }
      // Only an offer the server itself generated for this conversation is valid:
      // a substituted, stale or cross-tenant id never reaches the commit path.
      const offer = (collected.pilot_offers ?? []).find((entry) => entry.offer_id === value);
      if (!offer) return { ok: false, error: "Please choose one of the times shown." };
      next.booking_selected = offer.offer_id;
      next.booking_declined = false;
      return { ok: true, collected: next, echo: offer.label };
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
      `Thanks — I've passed your request to ${tenant.name} for review.`,
      "Because what you've described isn't a straight match for one of our listed services, the owner will look at it personally and get back to you.",
      "Nothing is booked or confirmed yet.",
    ].join(" ");
  }
  return [
    `Thanks — ${tenant.name} has your enquiry with all the details.`,
    "The team will review it and reply to you directly.",
    "Nothing is booked or confirmed yet.",
  ].join(" ");
}

export const DECLINED_MESSAGE =
  "No problem — without consent we can't contact you about this enquiry, so I haven't passed your details on. You're welcome to call the business directly instead.";

export const DUPLICATE_MESSAGE =
  "It looks like we already have a very recent enquiry from this mobile number, so I haven't created a second one. The team will be in touch about the first one.";
