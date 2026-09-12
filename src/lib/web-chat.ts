// Pure state machine for the public AI quote conversation.
// No database, no network, no model call — every prompt is derived from the
// tenant's own approved data, so nothing here can invent a service or a price.

import { normaliseAuMobile } from "@/lib/domain";
import { sanitiseCustomerText } from "@/lib/customer-text";
import { looksUncertain, uncertainServiceMessage } from "@/lib/web-chat-conversation";
import { usableName } from "@/lib/returning-lead";
import { servicePriceLine } from "@/lib/service-pricing";
import { formatMinutes } from "@/lib/service-groups";
import {
  NO_ADDONS_CHOICE,
  addonDetail,
  addonsForService,
  addonsPromptText,
  declinesAddons,
  matchAddons,
  type ServiceAddon,
} from "@/lib/service-addons";

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
  "addons",
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
  /** The tenant's own grouping heading, or null. Display only. */
  category?: string | null;
  /** Appointment length in minutes, when the tenant has set one. */
  duration_minutes?: number | null;
  description: string | null;
  included_items: string | null;
  excluded_items: string | null;
  qualification_note: string | null;
  /** Tenant-entered price guidance, shown verbatim. Null hides any price. */
  price_guidance?: string | null;
  /** False excludes this service from campaign discount highlighting. */
  campaign_eligible?: boolean | null;
};

export type WebChatTenant = {
  name: string;
  flexibleRequestsEnabled: boolean;
  /** True when this tenant takes real bookings in the conversation. */
  bookingEnabled?: boolean;
  services: WebChatService[];
  /** The tenant's own add-on extras, each linked to their approved services. */
  addons?: ServiceAddon[];
  /** Campaign discount percentage for this visitor, when recognised. */
  offerPercent?: number | null;
};

export type WebChatCollected = {
  service_id?: string | null;
  service_name?: string | null;
  /** Further approved services chosen alongside the first one. Never invented. */
  extra_service_ids?: string[] | null;
  extra_service_names?: string[] | null;
  /**
   * How many vehicles each chosen service is for, by service id. Only present
   * when the customer asked for more than one; a missing entry means one.
   */
  service_quantities?: Record<string, number> | null;
  typed_request?: string | null;

  /** Extras chosen with the service. Only the tenant's own linked add-ons. */
  addon_ids?: string[] | null;
  addon_names?: string[] | null;
  /** True when the chosen service actually has extras to offer. */
  addons_offered?: boolean | null;
  /** Set when the customer asked to add or change their email address. */
  email_requested?: boolean | null;
  /** True once the customer has finished choosing (or declined) extras. */
  addons_done?: boolean | null;
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

/** One optional extra offered with a service: the tenant's own wording only. */
export type WebChatCardExtra = {
  id: string;
  name: string;
  price: string | null;
  duration: string | null;
};



export type WebChatPrompt = {
  step: WebChatStep;
  text: string;
  kind: "choice" | "text" | "consent" | "review";
  optional?: boolean;
  options?: {
    value: string;
    label: string;
    detail: string | null;
    /** Display-only card fields, so a choice can be shown as a service card. */
    card?: {
      group: string | null;
      price: string | null;
      duration: string | null;
      description: string | null;
      includes: string | null;
      excludes: string | null;
      note: string | null;
      extras: WebChatCardExtra[];
    } | null;
  }[];
  /** Present on the review step: every captured field, each individually changeable. */
  fields?: WebChatReviewField[];
};

/**
 * Name and mobile are one question, never two turns: the customer answers both
 * in a single reply and the server accepts either or both from that answer.
 */
export const CONTACT_ASK_TEXT =
  "Almost done. What's your name, and the best mobile to reach you on?";


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

/** Sanitises optional display text, keeping null as null. */
function clean(value: string | null): string | null {
  return value === null ? null : sanitiseCustomerText(value);
}

export function serviceDetail(
  service: WebChatService,
  offerPercent?: number | null,
): string | null {
  const parts = [
    servicePriceLine(service, offerPercent),
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
/**
 * Display-only card for one approved service: the tenant's own wording, price
 * text and appointment length, plus the names of the extras they offer with it.
 * Nothing is computed and no price is invented.
 */
export function serviceCard(
  service: WebChatService,
  tenant: WebChatTenant,
): NonNullable<NonNullable<WebChatPrompt["options"]>[number]["card"]> {
  const extras: WebChatCardExtra[] = addonsForService(tenant.addons ?? [], service.id).map(
    (addon) => ({
      id: addon.id,
      name: addon.name,
      price: addon.price_guidance?.trim() || null,
      duration: formatMinutes(addon.duration_minutes ?? null),
    }),
  );

  return {
    group: service.category?.trim() || null,
    price: servicePriceLine(service, tenant.offerPercent ?? null),
    duration: formatMinutes(service.duration_minutes ?? null),
    description: service.description?.trim() || null,
    includes: service.included_items?.trim() || null,
    excludes: service.excluded_items?.trim() || null,
    note: service.qualification_note?.trim() || null,
    extras,
  };
}

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
  // Extras are offered once the job itself is understood, and only when this
  // tenant actually has add-ons linked to the chosen service.
  if (collected.addons_offered === true && collected.addons_done !== true) return "addons";
  if (!(collected.name ?? "").trim()) return "name";
  if (!collected.mobile_number) return "mobile";
  // Email is not a step of its own: it is captured when the customer offers it,
  // and stays editable in the final check. Asking to change it reopens the step.
  if (collected.email === undefined && collected.email_requested === true) return "email";
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


/**
 * The tenant's own price text for every chosen service and extra, plus a
 * combined figure when — and only when — every one of those prices is a single
 * dollar amount the tenant entered. Nothing is invented or discounted here: a
 * missing or ranged price simply means no combined figure is shown.
 */
export function chosenPricing(
  collected: WebChatCollected,
  tenant: WebChatTenant,
): { lines: string[]; combined: string | null } {
  const ids = [
    ...(collected.service_id ? [collected.service_id] : []),
    ...((collected.extra_service_ids ?? []).filter(Boolean) as string[]),
  ];
  const services = ids
    .map((id) => tenant.services.find((entry) => entry.id === id))
    .filter((entry): entry is WebChatService => Boolean(entry));
  const addons = (collected.addon_ids ?? [])
    .map((id) => (tenant.addons ?? []).find((addon) => addon.id === id))
    .filter((addon): addon is ServiceAddon => Boolean(addon));

  const parts: { name: string; price: string | null; quantity: number }[] = [
    ...services.map((service) => ({
      name: service.name,
      price: servicePriceLine(service, tenant.offerPercent ?? null),
      quantity: serviceQuantity(collected, service.id),
    })),
    ...addons.map((addon) => ({
      name: addon.name,
      price: addon.price_guidance?.trim() || null,
      quantity: 1,
    })),
  ];

  const lines = parts.map((part) => {
    const name = part.quantity > 1 ? `${part.name} ×${part.quantity}` : part.name;
    if (!part.price) return `${name} (price on enquiry)`;
    return part.quantity > 1 ? `${name} (${part.price} each)` : `${name} (${part.price})`;
  });

  let total = 0;
  let from = false;
  let computable = parts.length > 0;
  for (const part of parts) {
    const text = part.price ?? "";
    const amounts = text.match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
    if (amounts.length !== 1) {
      computable = false;
      break;
    }
    const value = Number(amounts[0]!.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(value)) {
      computable = false;
      break;
    }
    if (/\bfrom\b/i.test(text)) from = true;
    total += value * part.quantity;
  }

  const combined =
    computable && total > 0
      ? `${from ? "from " : ""}$${total.toLocaleString("en-AU", { maximumFractionDigits: 2 })} together`
      : null;
  return { lines, combined };
}

/**
 * What the customer has chosen so far with the tenant's own prices, plus the
 * combined figure when every price is a single dollar amount. Shown right after
 * extras are picked, before the final check, so the customer sees the service
 * and add-on prices together. Nothing is invented, discounted or rounded.
 */
export function selectionTotalMessage(
  collected: WebChatCollected,
  tenant: WebChatTenant,
): string | null {
  const pricing = chosenPricing(collected, tenant);
  if (pricing.lines.length === 0) return null;
  const listed = pricing.lines.join(" + ");
  return pricing.combined
    ? `So far: ${listed}. That comes to ${pricing.combined}.`
    : `So far: ${listed}. ${tenant.name} confirms the final price with you.`;
}

/** Labelled summary of everything captured, for the final review step. */
export function reviewSummary(
  collected: WebChatCollected,
  tenant?: WebChatTenant,
): WebChatReviewField[] {
  const pricing = tenant ? chosenPricing(collected, tenant) : null;
  const serviceValue =
    pricing && pricing.lines.length > 0
      ? pricing.lines.join(" + ")
      : chosenServicesText(collected) ?? collected.typed_request ?? "Not sure yet";
  return [
    { step: "service", label: "Service", value: serviceValue },
    ...(pricing?.combined
      ? [{ step: "service" as WebChatStep, label: "Prices together", value: pricing.combined }]
      : []),
    ...((collected.addon_names ?? []).length > 0 && !pricing
      ? [
          {
            step: "addons" as WebChatStep,
            label: "Extras",
            value: (collected.addon_names ?? []).join(", "),
          },
        ]
      : []),
    { step: "vehicle", label: "Vehicle", value: collected.vehicle_type ?? "—" },
    { step: "suburb", label: "Suburb", value: collected.suburb ?? "—" },
    { step: "address", label: "Address", value: collected.service_address ?? "—" },
    { step: "concerns", label: "Condition or concerns", value: collected.concerns ?? "—" },
    { step: "name", label: "Name", value: collected.name ?? "—" },
    { step: "mobile", label: "Mobile", value: collected.mobile_number ?? "—" },
    { step: "email", label: "Email", value: collected.email ?? "Not provided" },
  ];
}

export function reviewMessage(collected: WebChatCollected, tenant?: WebChatTenant): string {
  const lines = reviewSummary(collected, tenant).map((row) => `${row.label}: ${row.value}`);
  return [
    "Quick check:",
    ...lines,
    tenant ? `${tenant.name} confirms the final price with you.` : null,
    "All right? Or tell me what to change, for example “suburb to Parramatta”.",
  ]
    .filter(Boolean)
    .join("\n");
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
            ...(option.card
              ? {
                  card: {
                    ...option.card,
                    group: clean(option.card.group),
                    price: clean(option.card.price),
                    duration: clean(option.card.duration),
                    description: clean(option.card.description),
                    includes: clean(option.card.includes),
                    excludes: clean(option.card.excludes),
                    note: clean(option.card.note),
                    extras: option.card.extras.map((extra) => ({
                      ...extra,
                      name: sanitiseCustomerText(extra.name),
                      price: clean(extra.price),
                      duration: clean(extra.duration),
                    })),

                  },
                }
              : {}),
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
            detail: serviceDetail(service, tenant.offerPercent ?? null),
            card: serviceCard(service, tenant),
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
    case "addons": {
      const offered = addonsForService(tenant.addons ?? [], collected.service_id ?? null).filter(
        (addon) => !(collected.addon_ids ?? []).includes(addon.id),
      );
      return {
        step,
        kind: "choice",
        text: addonsPromptText(offered, collected.addon_names ?? []),
        options: [
          ...offered.map((addon) => ({
            value: addon.id,
            label: addon.name,
            detail: addonDetail(addon),
          })),
          { value: NO_ADDONS_CHOICE, label: "No extras, thanks", detail: null },
        ],
      };
    }
    case "vehicle":
      return { step, kind: "text", text: "What's the vehicle? (make and model)" };
    case "suburb":
      return { step, kind: "text", text: "Which suburb are we coming to?" };
    case "address":
      return {
        step,
        kind: "text",
        text: "And the street address? (number and street)",
      };
    case "concerns": {
      const extras = addonsForService(tenant.addons ?? [], collected.service_id ?? null).filter(
        (addon) => !(collected.addon_ids ?? []).includes(addon.id),
      );
      return {
        step,
        kind: "text",
        text:
          extras.length > 0
            ? "Anything we should focus on, like stains or pet hair? I can also show you a few add-ons after this."
            : "Anything we should focus on, like stains, pet hair or paint marks?",
      };
    }
    case "name":
      return { step, kind: "text", text: CONTACT_ASK_TEXT };

    case "mobile":
      return { step, kind: "text", text: "Thanks. What's the best mobile number to reach you on?" };
    case "email":
      return { step, kind: "text", optional: true, text: "Email? Optional, say skip if you'd rather not." };
    case "review":
      return {
        step,
        kind: "review",
        text: reviewMessage(collected, tenant),
        fields: reviewSummary(collected, tenant),
      };
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
          serviceName: chosenServicesText(collected) ?? collected.typed_request ?? null,
          suburb: collected.suburb ?? null,
          vehicle: collected.vehicle_type ?? null,
          slotLabel: held?.label ?? "the time you picked",
          addons: collected.addon_names ?? [],
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


/**
 * Short acknowledgement after a service is chosen. Includes the tenant's own
 * price guidance (and campaign discount, when it applies) so the customer sees
 * the price alongside the next question.
 */
export function serviceAcknowledgement(
  tenant: WebChatTenant,
  collected: WebChatCollected,
): string | null {
  const summary = chosenServicesText(collected);
  if (!summary) return null;
  const many = (collected.extra_service_ids ?? []).length > 0 || (collected.addon_ids ?? []).length > 0;
  const pricing = chosenPricing(collected, tenant);
  if (many) {
    const priced = pricing.lines.join("; ");
    return pricing.combined
      ? `Got it: ${priced}. That's ${pricing.combined}.`
      : `Got it: ${priced}.`;
  }
  const service = tenant.services.find((entry) => entry.id === collected.service_id) ?? null;
  const price = service ? servicePriceLine(service, tenant.offerPercent ?? null) : null;
  return price ? `${summary}, ${price}.` : `${summary}, got it.`;
}

/**
 * Records whether the chosen service actually has extras, and clears any extras
 * picked for a previously chosen service. Only the tenant's own linked add-ons
 * can ever be offered.
 */
function applyServiceAddons(
  next: WebChatCollected,
  tenant: WebChatTenant,
  serviceId: string | null,
): void {
  const offered = addonsForService(tenant.addons ?? [], serviceId);
  next.addon_ids = [];
  next.addon_names = [];
  next.extra_service_ids = [];
  next.extra_service_names = [];
  next.service_quantities = null;
  next.addons_offered = offered.length > 0;
  next.addons_done = offered.length === 0;
}

/** Largest vehicle count a customer can pick per service on the cards. */
export const MAX_SERVICE_QUANTITY = 10;

/** How many vehicles a chosen service is for (one unless the customer said more). */
export function serviceQuantity(collected: WebChatCollected, serviceId: string): number {
  const raw = collected.service_quantities?.[serviceId];
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.min(MAX_SERVICE_QUANTITY, Math.max(1, Math.round(raw)));
}

function withQuantity(name: string, quantity: number): string {
  return quantity > 1 ? `${name} ×${quantity}` : name;
}

/**
 * The service selection made on the cards, encoded as one answer value so the
 * existing single-answer transport is untouched. Only ids the tenant owns are
 * ever accepted on the way back in. A service id may carry a vehicle count as
 * `id*3`; a bare id means one vehicle, so older clients still parse.
 */
export const SERVICE_SELECTION_PREFIX = "sel:";

export function encodeServiceSelection(
  serviceIds: string[],
  addonIds: string[],
  quantities: Record<string, number> = {},
): string {
  const services = serviceIds.map((id) => {
    const count = quantities[id] ?? 1;
    return count > 1 ? `${id}*${Math.min(MAX_SERVICE_QUANTITY, Math.round(count))}` : id;
  });
  return `${SERVICE_SELECTION_PREFIX}${services.join(",")}|${addonIds.join(",")}`;
}

function parseServiceSelection(
  value: string,
): { serviceIds: string[]; addonIds: string[]; quantities: Record<string, number> } | null {
  if (!value.startsWith(SERVICE_SELECTION_PREFIX)) return null;
  const [rawServices = "", rawAddons = ""] = value.slice(SERVICE_SELECTION_PREFIX.length).split("|");
  const split = (input: string) =>
    input
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  const quantities: Record<string, number> = {};
  const serviceIds = split(rawServices).map((entry) => {
    const [id = "", count = ""] = entry.split("*");
    const parsed = Number.parseInt(count, 10);
    if (Number.isFinite(parsed) && parsed > 1) {
      quantities[id] = Math.min(MAX_SERVICE_QUANTITY, parsed);
    }
    return id;
  }).filter(Boolean);
  if (serviceIds.length === 0) return null;
  return { serviceIds, addonIds: split(rawAddons), quantities };
}

/** Every chosen service in one line: the tenant's own names, nothing invented. */
export function chosenServicesText(collected: WebChatCollected): string | null {
  const entries = [
    ...(collected.service_name ? [{ id: collected.service_id ?? "", name: collected.service_name }] : []),
    ...(collected.extra_service_names ?? []).map((name, index) => ({
      id: collected.extra_service_ids?.[index] ?? "",
      name,
    })),
  ].filter((entry) => Boolean(entry.name));
  if (entries.length === 0) return null;
  return entries
    .map((entry) => withQuantity(entry.name, entry.id ? serviceQuantity(collected, entry.id) : 1))
    .join(" + ");
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
      // Card selection: one or more of the tenant's own services, plus any of
      // their linked extras the customer ticked. Unknown ids are dropped.
      const selection = parseServiceSelection(value);
      if (selection) {
        const chosen = selection.serviceIds
          .map((id) => tenant.services.find((entry) => entry.id === id))
          .filter((entry): entry is WebChatService => Boolean(entry));
        if (chosen.length === 0) {
          return { ok: false, error: "Please choose one of the listed services." };
        }
        const primary = chosen[0]!;
        const rest = chosen.slice(1);
        const allowed = chosen.flatMap((entry) => addonsForService(tenant.addons ?? [], entry.id));
        const extras = selection.addonIds
          .map((id) => allowed.find((addon) => addon.id === id))
          .filter((addon): addon is ServiceAddon => Boolean(addon));
        // Vehicle counts: only for services actually chosen, only above one.
        const quantities: Record<string, number> = {};
        for (const entry of chosen) {
          const count = selection.quantities[entry.id] ?? 1;
          if (count > 1) quantities[entry.id] = count;
        }
        next.service_id = primary.id;
        next.service_name = primary.name;
        next.typed_request = null;
        next.extra_service_ids = rest.map((entry) => entry.id);
        next.extra_service_names = rest.map((entry) => entry.name);
        next.service_quantities = Object.keys(quantities).length > 0 ? quantities : null;
        next.addon_ids = extras.map((addon) => addon.id);
        next.addon_names = extras.map((addon) => addon.name);
        next.addons_offered = allowed.length > 0;
        // Extras were offered and answered on the cards, so the extras step is done.
        next.addons_done = true;
        const echo = [
          chosen
            .map((entry) => withQuantity(entry.name, quantities[entry.id] ?? 1))
            .join(" + "),
          extras.length > 0 ? `with ${extras.map((addon) => addon.name).join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        return { ok: true, collected: next, echo };
      }

      if (value === FLEXIBLE_CHOICE) {
        if (!tenant.flexibleRequestsEnabled) return { ok: false, error: "Please choose one of the listed services." };
        next.service_id = null;
        next.service_name = null;
        next.typed_request = "Not sure yet — described below";
        applyServiceAddons(next, tenant, null);
        return { ok: true, collected: next, echo: "Something else or not sure" };
      }
      const service = tenant.services.find((entry) => entry.id === value);
      if (service) {
        next.service_id = service.id;
        next.service_name = service.name;
        next.typed_request = null;
        applyServiceAddons(next, tenant, service.id);
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
        applyServiceAddons(next, tenant, named.service.id);
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
      applyServiceAddons(next, tenant, null);
      return { ok: true, collected: next, echo: value };

    }
    case "addons": {
      const all = addonsForService(tenant.addons ?? [], collected.service_id ?? null);
      const chosenIds = [...(collected.addon_ids ?? [])];
      const chosenNames = [...(collected.addon_names ?? [])];
      const remaining = all.filter((addon) => !chosenIds.includes(addon.id));

      if (value === NO_ADDONS_CHOICE || declinesAddons(value)) {
        next.addons_done = true;
        return { ok: true, collected: next, echo: chosenIds.length > 0 ? "That's all" : "No extras, thanks" };
      }

      const matched = matchAddons(value, remaining);
      if (matched.length === 0) {
        return {
          ok: false,
          error: `I can add ${remaining.map((addon) => addon.name).join(", ")} — which one would you like, or say no extras?`,
        };
      }
      for (const addon of matched) {
        chosenIds.push(addon.id);
        chosenNames.push(addon.name);
      }
      next.addon_ids = chosenIds;
      next.addon_names = chosenNames;
      // Nothing left to offer, so the step closes itself.
      next.addons_done = chosenIds.length >= all.length;
      return { ok: true, collected: next, echo: matched.map((addon) => addon.name).join(", ") };
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
      // Name and mobile are asked in one question, so one answer may carry both.
      const phone = value.match(/(?:\+?61|0)[\s\-().]*4[\d\s\-().]{7,}/);
      let namePart = value;
      let mobile: string | null = null;
      if (phone) {
        mobile = normaliseAuMobile(phone[0]);
        if (mobile) {
          namePart = value
            .replace(phone[0], " ")
            .replace(/\b(?:and|my|the|best|mobile|number|numbers|phone|is|are|it'?s)\b/gi, " ")
            .replace(/[,.;:]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        }
      }
      if (namePart.length < 2) {
        return {
          ok: false,
          error: mobile ? "Thanks, got the number. And your name?" : "Please tell me your name.",
        };
      }
      const rejection = shapeRejection("name", namePart);
      if (rejection) return { ok: false, error: rejection };
      next.name = namePart;
      if (mobile) next.mobile_number = mobile;
      return { ok: true, collected: next, echo: mobile ? `${namePart}, ${mobile}` : namePart };
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
