// The public quote page has exactly two modes. Manual is the product default and
// the safe fallback for anything unknown, missing or unparseable.

export const QUOTE_MODES = ["manual_sms", "ai_chat"] as const;
export type QuoteMode = (typeof QUOTE_MODES)[number];

export const QUOTE_MODE_LABELS: Record<QuoteMode, string> = {
  manual_sms: "Manual Quote Form with SMS",
  ai_chat: "AI Quote Conversation",
};

export const DEFAULT_QUOTE_MODE: QuoteMode = "manual_sms";

export function isQuoteMode(value: unknown): value is QuoteMode {
  return typeof value === "string" && (QUOTE_MODES as readonly string[]).includes(value);
}

/** Never fails open into AI mode: anything unrecognised resolves to Manual. */
export function resolveQuoteMode(value: unknown): QuoteMode {
  return isQuoteMode(value) ? value : DEFAULT_QUOTE_MODE;
}
