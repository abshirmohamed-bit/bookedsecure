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
  return raw
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
