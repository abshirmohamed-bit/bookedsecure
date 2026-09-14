// Reactivation of dormant/imported leads.
//
// Pure, deterministic and tenant-neutral: classification of "old" leads, the
// proposed offer built from tenant data, the customer-facing message render and
// the content guard. No I/O, no provider calls, no tenant identifiers in code.

import { sanitiseCustomerText } from "@/lib/customer-text";

/**
 * Personal campaign link: the contact's private token lets the quote page
 * recognise them, so they are never re-asked for details we already have.
 * Without a token the plain link is returned unchanged.
 */
export function campaignQuoteUrl(
  quoteUrl: string | null | undefined,
  publicToken: string | null | undefined,
): string | null {
  const base = typeof quoteUrl === "string" ? quoteUrl.trim() : "";
  if (!base) return null;
  const token = typeof publicToken === "string" ? publicToken.trim() : "";
  if (!token) return base;
  return `${base}${base.includes("?") ? "&" : "?"}c=${encodeURIComponent(token)}`;
}

/**
 * Short personal campaign link for SMS: a compact /b/<token> address that
 * redirects to the contact's own tenant quote page with their token attached.
 * Keeps customer texts short and readable; universal across tenants.
 */
export function campaignShortLink(
  origin: string | null | undefined,
  publicToken: string | null | undefined,
): string | null {
  const base = typeof origin === "string" ? origin.trim().replace(/\/+$/, "") : "";
  const token = typeof publicToken === "string" ? publicToken.trim() : "";
  if (!base || !token) return null;
  return `${base}/b/${encodeURIComponent(token)}`;
}

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
 * Proposed offer wording. Deliberately generic: for a dormant contact we do not
 * know which service they had or want, so the offer never names one. The owner
 * always edits and approves it before anything is sent.
 */
export function proposeOffer(input?: { percent?: number }): string {
  const percent = Number.isFinite(input?.percent)
    ? Number(input?.percent)
    : DEFAULT_REACTIVATION_PERCENT;
  return `${percent}% off your next enquiry`;
}

export const OFFER_MAX_LENGTH = 120;
export const REACTIVATION_MAX_LENGTH = 320;
export const REACTIVATION_CAMPAIGN_COPY_MAX_LENGTH = 180;

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
 * claims a previous job, quote or conversation, and never names a service the
 * contact has not asked for. When the tenant has a public quote page, the
 * message carries that tenant's own link.
 */
export function renderReactivationMessage(input: {
  businessName: string;
  leadName?: string | null;
  offerText: string;
  quoteUrl?: string | null;
  signature?: string | null;
}): string {
  const name = firstName(input.leadName);
  const offer = normaliseOffer(input.offerText).replace(/[.!]+$/, "");
  const signature = typeof input.signature === "string" ? input.signature.trim() : "";
  const quoteUrl = typeof input.quoteUrl === "string" ? input.quoteUrl.trim() : "";
  const parts = [
    name ? `Hi ${name}, it's ${input.businessName}.` : `Hi, it's ${input.businessName}.`,
    `We're offering ${offer}.`,
    quoteUrl
      ? `Book now: ${quoteUrl}`
      : "Reply YES if you'd like us to get you sorted, or STOP to opt out.",
  ];
  if (signature) parts.push(signature);
  if (quoteUrl) parts.push("Reply STOP to opt out.");
  return sanitiseCustomerText(parts.join(" ")).slice(0, REACTIVATION_MAX_LENGTH).trim();
}

/**
 * Builds a personalised draft from owner-written campaign copy. Recipient
 * identity, private link, tenant signature and opt-out wording are supplied by
 * trusted tenant data rather than accepted from the bulk editor.
 */
export function renderBulkReactivationMessage(input: {
  leadName?: string | null;
  campaignCopy: string;
  quoteUrl?: string | null;
  signature?: string | null;
}): string {
  const name = firstName(input.leadName);
  const campaignCopy = sanitiseCustomerText(input.campaignCopy.trim())
    .slice(0, REACTIVATION_CAMPAIGN_COPY_MAX_LENGTH)
    .trim();
  const quoteUrl = typeof input.quoteUrl === "string" ? input.quoteUrl.trim() : "";
  const signature = typeof input.signature === "string" ? input.signature.trim() : "";
  const parts = [name ? `Hi ${name},` : "Hi,", campaignCopy];
  if (quoteUrl) parts.push(`Book now: ${quoteUrl}`);
  if (signature) parts.push(signature);
  parts.push("Reply STOP to opt out.");
  return sanitiseCustomerText(parts.filter(Boolean).join(" ")).trim();
}

/**
 * One reminder only, three days after the first win-back message. Anything that
 * counts as engagement (a reply, a quote chat, a booking, an opt-out or a
 * suppressed number) cancels it permanently.
 */
export const REACTIVATION_REMINDER_DELAY_DAYS = 3;

export type ReminderFacts = {
  /** When the first win-back message went out. */
  sentAt: Date | null;
  now: Date;
  /** A reminder has already gone out for this contact. */
  reminderAlreadySent: boolean;
  hasInboundReply: boolean;
  hasQuoteChat: boolean;
  hasBooking: boolean;
  optedOut: boolean;
  suppressed: boolean;
  deleted: boolean;
};

export function shouldSendReactivationReminder(
  facts: ReminderFacts,
): { send: true } | { send: false; reason: string } {
  if (!facts.sentAt) return { send: false, reason: "First message was never sent." };
  if (facts.reminderAlreadySent) return { send: false, reason: "Reminder already sent." };
  if (facts.deleted) return { send: false, reason: "Lead is deleted." };
  if (facts.optedOut) return { send: false, reason: "Lead has opted out." };
  if (facts.suppressed) return { send: false, reason: "Number is suppressed." };
  if (facts.hasInboundReply) return { send: false, reason: "Customer already replied." };
  if (facts.hasQuoteChat) return { send: false, reason: "Customer started an enquiry." };
  if (facts.hasBooking) return { send: false, reason: "Lead already has a booking." };
  const dueAt = facts.sentAt.getTime() + REACTIVATION_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000;
  if (facts.now.getTime() < dueAt) return { send: false, reason: "Not due yet." };
  return { send: true };
}

/**
 * The single reminder. Shorter than the first message, makes no new promise and
 * repeats the same tenant-approved offer verbatim.
 */
export function renderReactivationReminder(input: {
  businessName: string;
  leadName?: string | null;
  offerText: string;
  quoteUrl?: string | null;
  signature?: string | null;
}): string {
  const name = firstName(input.leadName);
  const offer = normaliseOffer(input.offerText).replace(/[.!]+$/, "");
  const signature = typeof input.signature === "string" ? input.signature.trim() : "";
  const quoteUrl = typeof input.quoteUrl === "string" ? input.quoteUrl.trim() : "";
  const parts = [
    name ? `Hi ${name}, ${input.businessName} again.` : `Hi, ${input.businessName} again.`,
    `Just checking you saw our ${offer}.`,
    quoteUrl ? `Book now: ${quoteUrl}` : "Reply YES if you'd like a hand.",
    "Reply STOP to opt out.",
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
