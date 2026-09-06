/**
 * Customer-facing text boundary sanitizer (pure, no I/O).
 *
 * Every string that is rendered in the customer quote chat, persisted as a
 * customer-facing transcript line, or sent as customer-facing SMS copy passes
 * through `sanitiseCustomerText` first. It removes em dashes, en dashes used as
 * punctuation and double hyphens, and replaces them with ordinary punctuation.
 *
 * It never touches URLs, email addresses, phone numbers, booking or database
 * ids, idempotency keys, structured keys or ordinary hyphenated words such as
 * follow-up, customer-facing or Sydney-based. It is a presentation boundary
 * only: it never changes deterministic booking logic, and it is not applied to
 * internal logs, audit metadata or owner templates.
 */

export const CUSTOMER_PUNCTUATION_INSTRUCTION =
  "Use natural punctuation. Never use em dashes, en dashes used as punctuation, or double hyphens in customer-facing responses. Use full stops, commas, colons, semicolons, or parentheses instead.";

/** Substrings that must survive byte-for-byte. */
const PROTECTED = new RegExp(
  [
    "https?://\\S+", // URLs
    "www\\.\\S+",
    "\\S+@\\S+\\.\\S+", // email addresses
    "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", // uuids
    "\\+?\\d[\\d()\\s.-]{5,}\\d", // phone numbers
    "\\S*[:{}]\\S*", // idempotency keys, structured keys, code-ish tokens
  ].join("|"),
  "g",
);

const SENTINEL = "\u0000";

/** True when the text still contains punctuation dashes we do not allow. */
export function containsDisallowedDash(text: string): boolean {
  const stripped = text.replace(PROTECTED, "");
  return /[\u2014\u2013]/.test(stripped) || /--/.test(stripped);
}

function replaceDashes(segment: string): string {
  let out = segment;

  // Numeric ranges keep their meaning with a plain hyphen.
  out = out.replace(/(\d)\s*[\u2014\u2013]\s*(\d)/g, "$1-$2");

  // Any remaining dash used as punctuation becomes a sentence break.
  out = out.replace(/\s*(?:[\u2014\u2013]|--)\s*/g, SENTINEL);

  // A trailing dash simply ends the sentence.
  out = out.replace(new RegExp(`${SENTINEL}+$`, "g"), ".");

  // A dash straight after existing punctuation adds nothing.
  out = out.replace(new RegExp(`([.,;:!?])${SENTINEL}+`, "g"), "$1 ");

  // Otherwise: full stop, then a new sentence.
  out = out.replace(new RegExp(`${SENTINEL}+(.?)`, "g"), (_match, next: string) =>
    next ? `. ${next.toUpperCase()}` : ".",
  );

  return out.replace(/\.\s*\./g, ".").replace(/[ \t]{2,}/g, " ");
}

/** Sanitises one customer-facing string. Safe to call repeatedly. */
export function sanitiseCustomerText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return text;
  // A standalone dash is an "empty value" placeholder, not punctuation.
  if (/^[\s\u2014\u2013-]+$/.test(text)) return text;

  const protectedTokens: string[] = [];
  const masked = text.replace(PROTECTED, (match) => {
    protectedTokens.push(match);
    return `\u0001${protectedTokens.length - 1}\u0001`;
  });

  const cleaned = masked
    .split("\n")
    .map((line) => replaceDashes(line))
    .join("\n");

  return cleaned.replace(/\u0001(\d+)\u0001/g, (_match, index: string) => {
    const token = protectedTokens[Number(index)];
    return token === undefined ? "" : token;
  });
}

/** Sanitises a list of customer-facing lines. */
export function sanitiseCustomerLines(lines: readonly string[]): string[] {
  return lines.map((line) => sanitiseCustomerText(line));
}

/** Sanitises the `text` of an object, leaving every other field untouched. */
export function sanitiseCustomerTextField<T extends { text: string }>(value: T): T {
  return { ...value, text: sanitiseCustomerText(value.text) };
}
