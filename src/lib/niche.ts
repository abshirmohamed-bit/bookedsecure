/**
 * Niche kit: how BookedSecure talks to a business's own customers, matched to
 * what the business does. A detailer asks about the vehicle and its condition
 * and comes to an address; a pool service asks about the pool; a software
 * company that sells plans asks about the company and its needs and never
 * asks for a street address. Pure and tenant-neutral: it is chosen from the
 * business's own trade and website profile, and the owner's own wording (the
 * quote subject they set) always wins.
 */
import type { BusinessModel } from "@/lib/business-profile";
import { VEHICLE_TYPES } from "@/lib/domain";

export type NicheKit = {
  /** Example request shown in the first question. */
  serviceExample: string;
  /** What the enquiry is about, when the owner hasn't set their own label. */
  subjectLabel: string;
  subjectOptions: string[];
  /** Question for the subject in the quote form. */
  subjectQuestion: string;
  /** Short help when an answer doesn't look right. */
  subjectHint: string;
  /** True when the business comes to the customer, so a street address is needed. */
  onSite: boolean;
  /** Where the customer is (with street address when onSite). */
  locationQuestion: string;
  locationLabel: string;
  addressQuestion: string;
  /** The "anything else" step. */
  concernsLabel: string;
  concernsQuestion: string;
  concernsHint: string;
  /** "When was it last serviced?" when that matters, otherwise null. */
  lastServicedQuestion: string | null;
  /** Counting units on the service cards ("2 vehicles"), or null when counting makes no sense. */
  quantityLabel: string | null;
  /** What the business calls what it sells. */
  offeringWord: "service" | "plan" | "product";
};

const BASE: NicheKit = {
  serviceExample: "a regular service at my place in Parramatta next week",
  subjectLabel: "Job",
  subjectOptions: ["Home", "Business", "Strata or body corporate", "Other"],
  subjectQuestion: "What kind of place is it?",
  subjectHint: "A word or two is fine, for example Home.",
  onSite: true,
  locationQuestion: "Which suburb are we coming to, and the street address?",
  locationLabel: "Suburb",
  addressQuestion: "And the street address? (number and street)",
  concernsLabel: "What matters most",
  concernsQuestion: "Anything we should focus on? Tell us what matters most for this job.",
  concernsHint: "A short description is all I need here, I'll take your details next.",
  lastServicedQuestion: "When was it last serviced?",
  quantityLabel: null,
  offeringWord: "service",
};

/** Business-type starting points, by trade id (see lib/trades). */
const BY_TRADE: Record<string, Partial<NicheKit>> = {
  auto_marine_detailing: {
    serviceExample: "ceramic coating for my Mazda in Punchbowl next Tuesday",
    subjectLabel: "Vehicle",
    subjectOptions: VEHICLE_TYPES,
    subjectQuestion: "What type of vehicle is it?",
    subjectHint: "Just the vehicle is fine, for example Mazda 3.",
    concernsLabel: "Condition or concerns",
    concernsHint: "A short description of the condition is all I need here, I'll take your details next.",
    lastServicedQuestion: "When was it last professionally detailed?",
    quantityLabel: "Vehicle",
  },
  lawn_garden: {
    serviceExample: "a mow and edge for my front and back lawn in Ryde this week",
    subjectLabel: "Property",
    subjectOptions: ["House", "Townhouse or unit", "Strata or common area", "Business", "Other"],
    subjectQuestion: "What kind of property is it?",
    subjectHint: "A word or two is fine, for example House.",
    concernsLabel: "Garden notes",
    concernsQuestion: "Anything we should know about the yard? Size, access, pets or what you'd like done.",
    lastServicedQuestion: "When was it last mowed or tidied?",
    quantityLabel: null,
  },
  mobile_pet_grooming: {
    serviceExample: "a full groom for my cavoodle in Castle Hill on Saturday",
    subjectLabel: "Pet",
    subjectOptions: ["Small dog", "Medium dog", "Large dog", "Giant breed", "Cat", "Other"],
    subjectQuestion: "What kind of pet is it?",
    subjectHint: "Just the breed or size is fine, for example Cavoodle.",
    concernsLabel: "Coat and temperament",
    concernsQuestion: "Anything we should know? Coat condition, matting, nerves or health notes.",
    lastServicedQuestion: "When was their last groom?",
    quantityLabel: "Pet",
  },
  pool_servicing: {
    serviceExample: "a regular pool clean and chemical check in Penrith",
    subjectLabel: "Pool",
    subjectOptions: ["Inground chlorine", "Inground saltwater", "Above ground", "Spa", "Other"],
    subjectQuestion: "What kind of pool is it?",
    subjectHint: "A word or two is fine, for example Saltwater.",
    concernsLabel: "Pool condition",
    concernsQuestion: "How is the pool looking? Green, cloudy, equipment problems or just regular care.",
    lastServicedQuestion: "When was it last serviced?",
    quantityLabel: null,
  },
  window_cleaning: {
    serviceExample: "inside and outside windows for a two-storey house in Mosman",
    subjectLabel: "Property",
    subjectOptions: ["House (single storey)", "House (two storey)", "Unit", "Shopfront", "Office", "Other"],
    subjectQuestion: "What kind of property is it?",
    subjectHint: "A word or two is fine, for example Two storey house.",
    concernsLabel: "Access and notes",
    concernsQuestion: "Anything we should know? Number of windows, access, height or tracks and screens.",
    lastServicedQuestion: "When were the windows last cleaned?",
  },
  commercial_cleaning: {
    serviceExample: "a weekly office clean for 20 staff in North Sydney",
    subjectLabel: "Site",
    subjectOptions: ["Office", "Medical or clinic", "Retail", "Gym", "Warehouse", "Other"],
    subjectQuestion: "What kind of site is it?",
    subjectHint: "A word or two is fine, for example Office.",
    concernsLabel: "Site details",
    concernsQuestion: "Tell us about the site: size, how often you need cleaning and any special areas.",
    lastServicedQuestion: null,
  },
  test_and_tag: {
    serviceExample: "test and tag for about 80 items at our office in Parramatta",
    subjectLabel: "Site",
    subjectOptions: ["Office", "Construction site", "Warehouse", "Retail", "School", "Other"],
    subjectQuestion: "What kind of site is it?",
    subjectHint: "A word or two is fine, for example Office.",
    concernsLabel: "Items and timing",
    concernsQuestion: "Roughly how many items, and is there a compliance deadline?",
    lastServicedQuestion: "When was the last test and tag?",
  },
};

/**
 * Kinds of business that have no trade preset, recognised from the industry
 * on the saved website profile (for example "Mechanic and car servicing").
 * Customers come to a workshop, venue or lesson, so no street address is asked.
 */
export const INDUSTRY_NICHES = ["workshop", "removals", "venue_events", "lessons"] as const;
export type IndustryNiche = (typeof INDUSTRY_NICHES)[number];

const BY_INDUSTRY: Record<IndustryNiche, Partial<NicheKit>> = {
  workshop: {
    serviceExample: "a logbook service for my Corolla this Friday",
    subjectLabel: "Vehicle",
    subjectOptions: VEHICLE_TYPES,
    subjectQuestion: "What's the vehicle? Make and model is perfect.",
    subjectHint: "Just the vehicle is fine, for example Toyota Corolla.",
    onSite: false,
    locationQuestion: "Which suburb are you in?",
    locationLabel: "Suburb",
    addressQuestion: "",
    concernsLabel: "What it needs",
    concernsQuestion: "What's it doing, or what does it need? Any warning lights, noises or damage?",
    concernsHint: "A short description is all I need here, I'll take your details next.",
    lastServicedQuestion: "When was it last serviced?",
    quantityLabel: "Vehicle",
  },
  removals: {
    serviceExample: "a 2-bedroom move from Auburn to Parramatta on Saturday",
    subjectLabel: "Move size",
    subjectOptions: ["A few items", "Studio or 1 bedroom", "2 bedrooms", "3 bedrooms", "4+ bedrooms", "Office"],
    subjectQuestion: "How big is the move?",
    subjectHint: "A rough size is fine, for example 2 bedrooms.",
    onSite: true,
    locationQuestion: "Which suburb are you moving from, and the street address?",
    addressQuestion: "And the street address you're moving from? (number and street)",
    concernsLabel: "Moving to and when",
    concernsQuestion: "Where are you moving to, and on what date? Any stairs, lifts, or big or fragile items?",
    concernsHint: "The suburb you're moving to and the date are all I need here.",
    lastServicedQuestion: null,
    quantityLabel: null,
  },
  venue_events: {
    serviceExample: "a wedding reception for 250 guests next March",
    subjectLabel: "Event",
    subjectOptions: ["Wedding", "Engagement", "Birthday", "Corporate", "Religious or cultural", "Other"],
    subjectQuestion: "What's the occasion?",
    subjectHint: "A word or two is fine, for example Wedding.",
    onSite: false,
    locationQuestion: "Which suburb are you in?",
    locationLabel: "Suburb",
    addressQuestion: "",
    concernsLabel: "Date and guests",
    concernsQuestion: "What date are you thinking, and roughly how many guests?",
    concernsHint: "A date (or month) and a rough guest number are all I need here.",
    lastServicedQuestion: null,
    quantityLabel: null,
  },
  lessons: {
    serviceExample: "weekly lessons for my son, after school",
    subjectLabel: "Level",
    subjectOptions: ["Beginner", "Some experience", "Advanced", "Getting test ready"],
    subjectQuestion: "Where are you at right now?",
    subjectHint: "A word or two is fine, for example Beginner.",
    onSite: false,
    locationQuestion: "Which suburb are you in?",
    locationLabel: "Suburb",
    addressQuestion: "",
    concernsLabel: "Goals and times",
    concernsQuestion: "What would you like to work on, and which days and times suit you?",
    concernsHint: "A goal and a couple of times that suit are all I need here.",
    lastServicedQuestion: null,
    quantityLabel: null,
  },
};

/** Recognises one of the industry niches from free text, or null. Detailing and cleaning keep their own trades. */
export function industryNicheFor(industry: string | null | undefined): IndustryNiche | null {
  const t = (industry ?? "").toLowerCase();
  if (!t || /detail|car wash|clean/.test(t)) return null;
  if (/mechanic|auto ?repair|car servic|logbook|panel beat|smash repair|tyre|tire|auto ?electric|brake|4x4|automotive|workshop/.test(t)) return "workshop";
  if (/removal|\bmovers?\b|moving|relocation/.test(t)) return "removals";
  if (/function (centre|center|venue|hall)|wedding|reception venue|event venue|banquet|event hire|catering|caterer|\bdj\b|decorat|event (planner|styl)/.test(t)) return "venue_events";
  if (/driving (school|instructor|lessons)|tutor|coaching|lessons|music school|swim school|academy|classes/.test(t)) return "lessons";
  return null;
}

/**
 * A business that sells plans or products isn't visited at an address: the
 * customer says where they're based and what they're looking for.
 */
const REMOTE: Partial<NicheKit> = {
  serviceExample: "the right plan for our team of 25",
  subjectLabel: "Company size",
  subjectOptions: ["Just me", "2–10 people", "11–50 people", "51–200 people", "200+ people"],
  subjectQuestion: "How big is your team?",
  subjectHint: "A rough size is fine, for example 11–50 people.",
  onSite: false,
  locationQuestion: "Where is your business based?",
  locationLabel: "Based in",
  addressQuestion: "",
  concernsLabel: "What you're looking for",
  concernsQuestion: "What are you hoping to get from us? Any must-haves or questions?",
  concernsHint: "A sentence or two is all I need here, I'll take your details next.",
  lastServicedQuestion: null,
  quantityLabel: null,
};

/**
 * The kit for one business. Order of precedence: plans/products businesses
 * are remote; then the trade's starting point; then the suggested enquiry
 * subject from its website. The owner's own quote subject is applied by the
 * caller and always wins.
 */
export function nicheKitFor(input: {
  trade?: string | null;
  model?: BusinessModel | null;
  suggestedSubject?: { label: string; options: string[] } | null;
  /** Industry from the saved website profile; used when the trade has no preset. */
  industry?: string | null;
}): NicheKit {
  const remote = input.model === "subscription" || input.model === "products";
  const tradeKit = input.trade ? BY_TRADE[input.trade] : undefined;
  const industryNiche = tradeKit ? null : industryNicheFor(input.industry);
  const kit: NicheKit = {
    ...BASE,
    ...(tradeKit ?? (industryNiche ? BY_INDUSTRY[industryNiche] : {})),
    ...(remote ? REMOTE : {}),
    ...(input.model === "subscription" ? { offeringWord: "plan" as const } : input.model === "products" ? { offeringWord: "product" as const } : {}),
  };
  if (input.suggestedSubject?.label) {
    kit.subjectLabel = input.suggestedSubject.label;
    if (input.suggestedSubject.options.length > 0) kit.subjectOptions = input.suggestedSubject.options;
    kit.subjectQuestion = remote ? `Which best describes your ${input.suggestedSubject.label.toLowerCase()}?` : `What's the ${input.suggestedSubject.label.toLowerCase()}?`;
  }
  return kit;
}
