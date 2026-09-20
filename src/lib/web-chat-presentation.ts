import { sanitiseCustomerText } from "@/lib/customer-text";

/**
 * Presentation-only helpers for the public AI quote conversation.
 *
 * These functions NEVER change stored tenant data or invent service facts: they
 * only tidy whitespace/bullet syntax and split the server-built option `detail`
 * string into compact display fields so a card can be scanned quickly. The full
 * approved text is always still reachable through the "Read more" control.
 */

/** Collapse whitespace and strip raw checklist/bullet syntax for display. */
export function cleanDisplayText(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  // Display safety net for the punctuation policy: dashes used as punctuation
  // never reach the customer, hyphenated words and links are untouched.
  return sanitiseCustomerText(raw)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•–]|\[\s*[xX ]?\s*\]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length > 0)
    .join(" · ")
    .replace(/\s*·\s*(?=·)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])\s*(?=[,;:])/g, "")
    .trim();
}

export type ServiceCardContent = {
  /** Short scannable line, cleaned for display. */
  summary: string;
  /** Named sections derived from the approved detail text. */
  facts: { label: string; value: string }[];
  /** True when the card holds more than the summary shows. */
  hasMore: boolean;
};

const SECTION_LABELS: { prefix: string; label: string }[] = [
  { prefix: "Includes:", label: "Includes" },
  { prefix: "Not included:", label: "Not included" },
  { prefix: "Duration:", label: "Duration" },
];

const SUMMARY_LIMIT = 110;

/**
 * Split the approved `detail` string (built server-side from description,
 * inclusions, exclusions and the qualification note) into a compact summary
 * plus labelled sections. Nothing is added, reworded or removed.
 */
export function serviceCardContent(detail: string | null | undefined): ServiceCardContent {
  const parts = (detail ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const facts: { label: string; value: string }[] = [];
  const plain: string[] = [];

  for (const part of parts) {
    const section = SECTION_LABELS.find((entry) =>
      part.toLowerCase().startsWith(entry.prefix.toLowerCase()),
    );
    if (section) {
      const value = cleanDisplayText(part.slice(section.prefix.length));
      if (value) facts.push({ label: section.label, value });
      continue;
    }
    const cleaned = cleanDisplayText(part);
    if (cleaned) plain.push(cleaned);
  }

  const full = plain.join(" ");
  const truncated = full.length > SUMMARY_LIMIT;
  const summary = truncated ? `${full.slice(0, SUMMARY_LIMIT).trimEnd()}…` : full;

  return { summary, facts, hasMore: truncated || facts.length > 0 };
}

/** Full approved text for the expanded card, kept verbatim per section. */
export function serviceFullText(detail: string | null | undefined): string {
  return (detail ?? "")
    .split(" · ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

/**
 * Display-only filter for the stored long introduction turn. The message stays
 * persisted server-side (nothing is deleted); the opening conversation simply
 * leads with the short instruction instead of the legal/technical preamble.
 */
export function isVerboseIntro(body: string): boolean {
  const text = body.toLowerCase();
  return text.includes("online quote assistant") && text.includes("can't confirm prices");
}

/**
 * Display-only filter for the stored opening turns (assistant introduction and
 * the service-step instruction). Both stay persisted server-side; the opening
 * conversation shows a single concise message with the service list instead.
 */
export function isSuppressedOpeningTurn(body: string): boolean {
  const text = body.toLowerCase();
  if (text.includes("online quote assistant")) return true;
  return text.includes("in your own words") && text.includes("pick a service below");
}

/** Tenant service area trimmed for the opening line, e.g. "Sydney metro". */
export function shortServiceArea(area: string | null | undefined): string {
  const raw = (area ?? "").trim();
  if (!raw) return "";
  const head = raw.split(/\s*[(–-:]/)[0] ?? raw;
  return head.replace(/[,;]\s*$/, "").trim();
}


/** Short, de-emphasised secondary line for a service row in the initial list. */
export function serviceShortDescription(detail: string | null | undefined, limit = 80): string {
  const { summary } = serviceCardContent(detail);
  if (!summary) return "";
  const flat = summary.replace(/…$/, "").trim();
  return flat.length > limit ? `${flat.slice(0, limit).trimEnd()}…` : flat;
}

/**
 * True when the customer explicitly asks to see the service list again.
 * Once they type their own request the list stays hidden, so an off-list
 * request is not answered with the very list they just stepped outside of.
 */
export function asksForServiceList(text: string): boolean {
  const t = text.toLowerCase();
  if (!/\b(service|services|option|options|list|offer|offers|do you do|provide)\b/.test(t)) {
    return false;
  }
  return /\b(what|which|show|see|list|any|got|have|available|options)\b/.test(t);
}
