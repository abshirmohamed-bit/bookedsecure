export const QUOTE_SERVICE_LAYOUTS = [
  "focused_list",
  "compact_grid",
  "guided_conversation",
] as const;

export type QuoteServiceLayout = (typeof QUOTE_SERVICE_LAYOUTS)[number];

export const DEFAULT_QUOTE_SERVICE_LAYOUT: QuoteServiceLayout = "focused_list";

export const QUOTE_SERVICE_LAYOUT_LABELS: Record<QuoteServiceLayout, string> = {
  focused_list: "Focused list",
  compact_grid: "Compact grid",
  guided_conversation: "Guided conversation",
};

export const QUOTE_SERVICE_LAYOUT_DESCRIPTIONS: Record<QuoteServiceLayout, string> = {
  focused_list: "One readable service per row. Best for longer names and prices.",
  compact_grid: "Two services per row on phones, with more choices visible at once.",
  guided_conversation: "One service at a time, with simple previous and next controls.",
};

export function resolveQuoteServiceLayout(value: unknown): QuoteServiceLayout {
  return typeof value === "string" &&
    (QUOTE_SERVICE_LAYOUTS as readonly string[]).includes(value)
    ? (value as QuoteServiceLayout)
    : DEFAULT_QUOTE_SERVICE_LAYOUT;
}