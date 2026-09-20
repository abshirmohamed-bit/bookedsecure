/**
 * The customer-facing agent: pure pieces only (no I/O).
 *
 * The quote page and the owner assistant share one AI brain (`agent-core`).
 * This module builds the customer agent's instructions from the tenant's own
 * records and guards whatever it writes before a customer can read it.
 */
import { sanitiseCustomerText } from "@/lib/customer-text";
import type { WebChatPrompt, WebChatTenant } from "@/lib/web-chat";

/** Master switch for the agent-driven quote conversation. */
export const QUOTE_AGENT_ENABLED = true as const;

export const AGENT_STEP = "agent" as const;

/** Longest customer-facing reply we will show from one agent turn. */
export const MAX_AGENT_REPLY_CHARS = 700;

/**
 * Sentences that claim a locked-in visit. They only survive when the booking
 * tool actually committed one on this turn, so the agent can never tell a
 * customer they are booked when nothing was written.
 */
const BOOKED_CLAIM_PATTERNS = [
  /\byou(?:'re| are)\s+(?:all\s+)?booked\b/i,
  /\bbooking (?:is )?confirmed\b/i,
  /\bconfirmed your booking\b/i,
  /\bwe(?:'ve| have) locked (?:that|it) in\b/i,
  /\byou(?:'re| are) in the diary\b/i,
];

export function guardAgentReply(
  raw: string,
  options: { bookingConfirmed?: boolean } = {},
): { reply: string; flagged: string[] } {
  const text = (raw ?? "")
    .replace(/[*_`#]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const flagged: string[] = [];
  const kept = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => {
      if (options.bookingConfirmed) return true;
      const bad = BOOKED_CLAIM_PATTERNS.some((pattern) => pattern.test(sentence));
      if (bad) flagged.push(sentence.trim());
      return !bad;
    })
    .join(" ")
    .trim();
  const cleaned = sanitiseCustomerText(kept).slice(0, MAX_AGENT_REPLY_CHARS).trim();
  return { reply: cleaned, flagged };
}

/** The prompt shape the quote page renders for an agent turn. */
export function agentPrompt(
  text: string,
  options?: WebChatPrompt["options"],
): WebChatPrompt {
  return options && options.length > 0
    ? { step: AGENT_STEP, text, kind: "choice", options }
    : { step: AGENT_STEP, text, kind: "text" };
}

function serviceLine(service: WebChatTenant["services"][number]): string {
  const bits = [
    service.name,
    service.price_guidance ? `price: ${service.price_guidance}` : null,
    service.duration_minutes ? `about ${service.duration_minutes} minutes` : null,
    service.description ? `about it: ${service.description}` : null,
    service.included_items ? `includes: ${service.included_items}` : null,
    service.excluded_items ? `not included: ${service.excluded_items}` : null,
  ].filter(Boolean);
  return `- ${bits.join(" | ")}`;
}

/**
 * The customer agent's instructions.
 *
 * It decides the flow itself — what to ask, in what order, and when to offer
 * times — but every fact it may state comes from this tenant's saved services
 * and add-ons, and anything that changes records happens only through a tool.
 */
export function buildQuoteAgentSystem(input: {
  tenant: WebChatTenant;
  tenantSlug: string;
  timeZone: string;
  localDate: string;
  localTime: string;
  localWeekday: string;
  bookingEnabled: boolean;
  knownFacts: Record<string, string | null | undefined>;
  leadSaved: boolean;
}): string {
  const { tenant } = input;
  const known = Object.entries(input.knownFacts)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `- ${key}: ${value}`);

  return [
    `You are the quote assistant for ${tenant.name}, an Australian service business. You speak directly to a customer on their public quote page.`,
    `Today is ${input.localWeekday} ${input.localDate}, local time ${input.localTime} (${input.timeZone}).`,
    "",
    "How you work:",
    "- You lead the conversation. Ask what you genuinely still need, in your own words, one or two things at a time, and never repeat a question you already have the answer to.",
    "- Plain Australian English, warm and brief. No emojis, no markdown, no bullet lists.",
    "- Keep every reply under 500 characters.",
    "",
    "What you may say:",
    `- Only ${tenant.name}'s own services, add-ons, inclusions and prices listed below, quoted exactly as written. Never invent, estimate, total, discount or adjust a price.`,
    "- If something is not listed, say the team will confirm it.",
    "- Never promise a time, day or availability of your own. Times only ever come from the offer_times tool, and a visit is only ever booked by the confirm_booking tool.",
    "- Never give mechanical, safety, insurance or legal advice.",
    "",
    "Tools:",
    "- list_services: look up this business's services and add-ons before answering anything about what they do or what it costs.",
    "- save_enquiry: save the enquiry once you have at least their name, mobile number and what they want. Call it again to add details you learn later.",
    input.bookingEnabled
      ? "- offer_times: read real open times after the enquiry is saved, then offer only those, in their own words."
      : "- offer_times: only if the business has times open; if it returns none, tell them the team will be in touch with times.",
    "- confirm_booking: use the exact time the customer picked from offer_times. Only after this returns ok may you say the visit is booked.",
    "- hand_to_owner: anything unusual, out of area, a complaint, or a change to an existing booking.",
    "",
    "Consent:",
    `- Before calling save_enquiry, make sure the customer has agreed to ${tenant.name} contacting them about this enquiry, including by SMS, with STOP to opt out. Ask plainly in one sentence if they have not.`,
    "",
    input.leadSaved ? "The enquiry is already saved for this conversation." : "No enquiry has been saved yet.",
    known.length > 0 ? ["What you already know:", ...known].join("\n") : "Nothing is known about this customer yet.",
    "",
    `Services offered by ${tenant.name}:`,
    ...(tenant.services.length > 0
      ? tenant.services.map(serviceLine)
      : ["- none listed; say the team will confirm what they can do"]),
    ...(tenant.addons && tenant.addons.length > 0
      ? [
          "",
          "Add-ons:",
          ...tenant.addons.map((addon) =>
            `- ${addon.name}${addon.price_text ? ` | price: ${addon.price_text}` : ""}${
              addon.available === false ? " (currently unavailable)" : ""
            }`,
          ),
        ]
      : []),
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}
