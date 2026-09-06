// Reactivation of dormant/imported leads.
//
// Pure, deterministic and tenant-neutral: classification of "old" leads, the
// proposed offer built from tenant data, the customer-facing message render and
// the content guard. No I/O, no provider calls, no tenant identifiers in code.

import { sanitiseCustomerText } from "@/lib/customer-text";

/** Everything the classifier may look at. All server-observed facts. */
export type ReactivationFacts = {
  /** Any customer-facing SMS in either direction. */
  hasMessages: boolean;
  /** A public quote/AI chat conversation exists for this lead. */
  hasQuoteChat: boolean;
  /** booking_status other than "none", or a job row. */
  hasBooking: boolean;
  /** Verified enquiry context (service, vehicle, suburb or concern). */
  hasVerifiedContext: boolean;
  optedOut: boolean;
  suppressed: boolean;
  deleted: boolean;
  /** A real mobile number is required before anything can be drafted. */
  hasMobileNumber: boolean;
};

export type ReactivationDecision =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * An "old lead" is a contact with no evidence of a live enquiry: no SMS in
 * either direction, no quote-chat history, no booking and no verified enquiry
 * details. Opted-out, suppressed and deleted records are never eligible.
 */
export function classifyReactivationCandidate(facts: ReactivationFacts): ReactivationDecision {
  if (facts.deleted) return { eligible: false, reason: "Lead is deleted." };
  if (!facts.hasMobileNumber) return { eligible: false, reason: "No mobile number on record." };
  if (facts.optedOut) return { eligible: false, reason: "Lead has opted out." };
  if (facts.suppressed) return { eligible: false, reason: "Number is suppressed after delivery failures." };
  if (facts.hasMessages) return { eligible: false, reason: "Conversation already exists." };
  if (facts.hasQuoteChat) return { eligible: false, reason: "Quote conversation already exists." };
  if (facts.hasBooking) return { eligible: false, reason: "Lead already has a booking or job." };
  if (facts.hasVerifiedContext) return { eligible: false, reason: "Lead has an active enquiry on record." };
  return { eligible: true };
}

export const DEFAULT_REACTIVATION_PERCENT = 15;

/**
 * Proposed offer wording, built from this tenant's own active services. The
 * owner always edits and approves it before anything is sent.
 */
export function proposeOffer(input: {
  serviceNames?: string[] | null;
  percent?: number;
}): string {
  const percent = Number.isFinite(input.percent) ? Number(input.percent) : DEFAULT_REACTIVATION_PERCENT;
  const first = (input.serviceNames ?? []).map((n) => n.trim()).filter(Boolean)[0];
  return first ? `${percent}% off your next ${first}` : `${percent}% off your next service`;
}

export const OFFER_MAX_LENGTH = 120;
export const REACTIVATION_MAX_LENGTH = 320;

export function normaliseOffer(offer: string): string {
  return sanitiseCustomerText(offer.trim()).slice(0, OFFER_MAX_LENGTH).trim();
}

function firstName(name: string | null | undefined): string | null {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return null;
  const part = trimmed.split(/\s+/)[0] ?? "";
  return part.length > 1 ? part : trimmed;
}

/**
 * The customer-facing reactivation message. Neutral about history: it never
 * claims a previous job, quote or conversation.
 */
export function renderReactivationMessage(input: {
  businessName: string;
  leadName?: string | null;
  offerText: string;
  signature?: string | null;
}): string {
  const name = firstName(input.leadName);
  const offer = normaliseOffer(input.offerText).replace(/[.!]+$/, "");
  const signature = typeof input.signature === "string" ? input.signature.trim() : "";
  const parts = [
    name ? `Hi ${name}, it's ${input.businessName}.` : `Hi, it's ${input.businessName}.`,
    `We're offering ${offer}.`,
    "Reply YES if you'd like us to get you sorted, or STOP to opt out.",
  ];
  if (signature) parts.push(signature);
  return sanitiseCustomerText(parts.join(" ")).slice(0, REACTIVATION_MAX_LENGTH).trim();
}

// Never allowed in a reactivation message, regardless of the approved offer.
const BANNED_PATTERNS = [
  /\b(?:tomorrow|today|tonight|this (?:morning|afternoon|evening|weekend)|next week|this week)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i,
  /\bbooked in\b|\byou are booked\b|\bbooking is confirmed\b|\bconfirmed your booking\b/i,
  /\bappointment\b|\bslot\b|\bschedul/i,
  /\bavailab/i,
  /\bguarantee/i,
  /\bfee\b|\bfees\b|\bsurcharge\b|\bdeposit\b|\bgst\b|\btax\b/i,
];

const MONEY_PATTERN = /\$\s?\d|\b\d+\s?(?:dollars|aud)\b/i;
const PERCENT_PATTERN = /\d+\s?%|\b\d+\s?per\s?cent\b/i;

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[,.;:!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type GuardResult = { text: string; flagged: string[] };

/**
 * Strips any sentence that promises timing or a booking, quotes money, or
 * states a discount other than the tenant-approved offer verbatim.
 */
export function guardReactivationMessage(text: string, approvedOffer: string): GuardResult {
  const offer = normalise(normaliseOffer(approvedOffer));
  const flagged: string[] = [];
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      let bad = BANNED_PATTERNS.some((pattern) => pattern.test(sentence));
      if (!bad && MONEY_PATTERN.test(sentence)) bad = true;
      if (!bad && PERCENT_PATTERN.test(sentence)) {
        const normalised = normalise(sentence);
        const index = offer.length > 0 ? normalised.indexOf(offer) : -1;
        if (index < 0) bad = true;
        else {
          const residual = normalised.slice(0, index) + " " + normalised.slice(index + offer.length);
          bad = PERCENT_PATTERN.test(residual) || MONEY_PATTERN.test(residual);
        }
      }
      if (bad) flagged.push(sentence.trim());
      return !bad;
    })
    .join(" ")
    .trim();
  return { text: sanitiseCustomerText(kept), flagged };
}

export type ApprovalRequest = {
  attested: boolean;
  campaignStatus: string;
  approvedDraftCount: number;
};

/**
 * Approval policy. The owner must attest they have permission to contact these
 * customers, the campaign must still be a draft, and at least one message must
 * be selected.
 */
export function checkApproval(request: ApprovalRequest): { ok: true } | { ok: false; reason: string } {
  if (request.campaignStatus !== "draft")
    return { ok: false, reason: "This campaign has already been actioned." };
  if (!request.attested)
    return { ok: false, reason: "Confirm you have permission to contact these customers." };
  if (request.approvedDraftCount < 1)
    return { ok: false, reason: "Select at least one message to send." };
  return { ok: true };
}
