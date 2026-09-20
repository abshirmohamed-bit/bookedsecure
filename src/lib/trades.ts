/**
 * Trade presets. client-safe types and pure helpers.
 *
 * A trade is what the business actually does. It is never used to special-case
 * one tenant: it only supplies neutral starting points (service names,
 * re-service cycle, follow-up wording) that the owner reviews and can change.
 * Anything the owner already saved is never overwritten by a preset.
 */

export const TRADE_IDS = [
  "auto_marine_detailing",
  "lawn_garden",
  "mobile_pet_grooming",
  "pool_servicing",
  "window_cleaning",
  "commercial_cleaning",
  "test_and_tag",
] as const;

export type TradeId = (typeof TRADE_IDS)[number];

export type TradePreset = {
  id: TradeId;
  label: string;
  /** One plain line the owner reads when choosing. */
  description: string;
  /** Typical gap between jobs for the same customer, in days. */
  reserviceDays: { min: number; max: number };
  /** Warmer months can shorten the cycle; null when it does not change. */
  summerReserviceDays: { min: number; max: number } | null;
  /** Starting services, used only to fill an empty catalogue. */
  serviceSeeds: { name: string; durationMinutes: number }[];
  /** The word used for the thing being serviced in customer wording. */
  subjectNoun: string;
};

export const TRADE_PRESETS: Record<TradeId, TradePreset> = {
  auto_marine_detailing: {
    id: "auto_marine_detailing",
    label: "Auto & marine detailing",
    description: "Cars, boats and caravans detailed at the customer's place or your studio.",
    reserviceDays: { min: 28, max: 42 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Full interior & exterior detail", durationMinutes: 180 },
      { name: "Exterior wash & protect", durationMinutes: 90 },
      { name: "Interior deep clean", durationMinutes: 120 },
    ],
    subjectNoun: "vehicle",
  },
  lawn_garden: {
    id: "lawn_garden",
    label: "Lawn & garden maintenance",
    description: "Mowing, edging, hedges and green waste for homes and strata.",
    reserviceDays: { min: 42, max: 56 },
    summerReserviceDays: { min: 14, max: 28 },
    serviceSeeds: [
      { name: "Lawn mow & edge", durationMinutes: 60 },
      { name: "Hedge & shrub trim", durationMinutes: 90 },
      { name: "Full garden tidy-up", durationMinutes: 180 },
    ],
    subjectNoun: "property",
  },
  mobile_pet_grooming: {
    id: "mobile_pet_grooming",
    label: "Mobile pet grooming & hydrobathing",
    description: "Grooming and hydrobathing from a fitted van at the customer's door.",
    reserviceDays: { min: 28, max: 42 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Full groom & hydrobath", durationMinutes: 90 },
      { name: "Hydrobath & tidy", durationMinutes: 60 },
      { name: "Nails, ears & brush-out", durationMinutes: 30 },
    ],
    subjectNoun: "pet",
  },
  pool_servicing: {
    id: "pool_servicing",
    label: "Swimming pool servicing",
    description: "Water testing, chemicals, filters and pumps, year round.",
    reserviceDays: { min: 28, max: 28 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Regular pool service", durationMinutes: 60 },
      { name: "Green pool recovery", durationMinutes: 150 },
      { name: "Equipment check & repair", durationMinutes: 90 },
    ],
    subjectNoun: "pool",
  },
  window_cleaning: {
    id: "window_cleaning",
    label: "Commercial & high-end window cleaning",
    description: "Shopfronts, offices and large homes, inside and out.",
    reserviceDays: { min: 28, max: 56 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Windows inside & out", durationMinutes: 120 },
      { name: "Shopfront glass clean", durationMinutes: 45 },
      { name: "Tracks, frames & screens", durationMinutes: 90 },
    ],
    subjectNoun: "property",
  },
  commercial_cleaning: {
    id: "commercial_cleaning",
    label: "Commercial & office cleaning",
    description: "Offices, clinics and retail cleaned on a regular run.",
    reserviceDays: { min: 7, max: 14 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Office clean", durationMinutes: 120 },
      { name: "End of lease clean", durationMinutes: 240 },
      { name: "Carpet steam clean", durationMinutes: 120 },
    ],
    subjectNoun: "site",
  },
  test_and_tag: {
    id: "test_and_tag",
    label: "Test and tag",
    description: "Electrical testing and tagging for sites and offices.",
    reserviceDays: { min: 180, max: 365 },
    summerReserviceDays: null,
    serviceSeeds: [
      { name: "Test and tag. per site visit", durationMinutes: 120 },
      { name: "RCD safety switch testing", durationMinutes: 90 },
    ],
    subjectNoun: "site",
  },
};

/** The five headline trades, in the order they are offered. */
export const PRIMARY_TRADE_IDS: TradeId[] = [
  "auto_marine_detailing",
  "lawn_garden",
  "mobile_pet_grooming",
  "pool_servicing",
  "window_cleaning",
];

export function isTradeId(value: unknown): value is TradeId {
  return typeof value === "string" && (TRADE_IDS as readonly string[]).includes(value);
}

/** Never throws: an unknown or missing trade simply resolves to null. */
export function resolveTrade(value: unknown): TradePreset | null {
  return isTradeId(value) ? TRADE_PRESETS[value] : null;
}

export function tradeLabel(value: unknown): string | null {
  return resolveTrade(value)?.label ?? null;
}

/**
 * How long after a job this trade would normally be back, in days. Used to
 * decide when a past customer counts as due for a friendly follow-up.
 * Southern-hemisphere summer months use the shorter cycle where the trade has
 * one (lawn and garden being the obvious case).
 */
export function reserviceWindowDays(
  trade: TradeId | null | undefined,
  now: Date = new Date(),
): { min: number; max: number } | null {
  const preset = resolveTrade(trade);
  if (!preset) return null;
  const month = now.getUTCMonth(); // 0 = January
  const isSummer = month === 11 || month <= 1; // Dec, Jan, Feb
  if (isSummer && preset.summerReserviceDays) return preset.summerReserviceDays;
  return preset.reserviceDays;
}

/** Plain-language cycle line, e.g. "every 4–6 weeks". */
export function reserviceCycleLabel(trade: TradeId | null | undefined): string | null {
  const preset = resolveTrade(trade);
  if (!preset) return null;
  const weeks = (days: number) => Math.round(days / 7);
  const { min, max } = preset.reserviceDays;
  return min === max ? `every ${weeks(min)} weeks` : `every ${weeks(min)}–${weeks(max)} weeks`;
}
