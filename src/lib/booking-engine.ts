/**
 * Booking engine: pure layer shared by the website booking API (and, over time,
 * the quote page and assistants). Tenant-neutral: every price, size and length
 * comes from the business's own catalogue; nothing is invented.
 *
 * - Price: a size's own price when the owner set one, otherwise the first dollar
 *   figure in the service's price text ("$229", "from $149"). Wording such as
 *   "from", "starting" or "per" makes it a starting price; no figure at all
 *   ("On enquiry") means the price is confirmed by the business.
 * - Length: the size's own length, otherwise the service's, plus each add-on's.
 *   A service without a length can't be booked online.
 */
import { z } from "zod";
import { jobValueFromPrice } from "@/lib/job-autocomplete";

export type SizeOption = {
  key: string;
  label: string;
  price: number | null;
  duration_minutes: number | null;
};

export type CatalogService = {
  id: string;
  name: string;
  price_guidance: string | null;
  duration_minutes: number | null;
  size_options: SizeOption[];
};

export type CatalogAddon = {
  id: string;
  name: string;
  price_guidance: string | null;
  duration_minutes: number | null;
  serviceIds: string[];
};

export type PriceKind = "exact" | "from" | "on_request";

export type QuoteLine = {
  kind: "service" | "addon";
  id: string;
  name: string;
  price: number | null;
  price_kind: PriceKind;
  duration_minutes: number;
};

export type Quote = {
  service: { id: string; name: string };
  size: { key: string; label: string } | null;
  addons: Array<{ id: string; name: string }>;
  lines: QuoteLine[];
  duration_minutes: number;
  price: { amount: number | null; kind: PriceKind; currency: "AUD"; label: string };
};

export type QuoteError =
  | "service_not_found"
  | "size_required"
  | "size_not_found"
  | "addon_not_available"
  | "duration_missing";

const SIZE_KEY = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Turns a size label into a stable key ("Large SUV" → "large-suv"). */
export function sizeKeyFor(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Validates stored size options. Bad entries are dropped, never guessed. */
export function parseSizeOptions(value: unknown): SizeOption[] {
  if (!Array.isArray(value)) return [];
  const out: SizeOption[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    const label = typeof raw["label"] === "string" ? raw["label"].trim().slice(0, 60) : "";
    if (!label) continue;
    const key = typeof raw["key"] === "string" && SIZE_KEY.test(raw["key"]) ? raw["key"] : sizeKeyFor(label);
    if (!key || seen.has(key)) continue;
    const price = Number(raw["price"]);
    const minutes = Number(raw["duration_minutes"]);
    seen.add(key);
    out.push({
      key,
      label,
      price: raw["price"] != null && Number.isFinite(price) && price >= 0 ? Math.round(price * 100) / 100 : null,
      duration_minutes:
        raw["duration_minutes"] != null && Number.isInteger(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null,
    });
  }
  return out;
}

/** How firm a price text is. */
export function priceKindOf(priceGuidance: string | null | undefined): PriceKind {
  const amount = jobValueFromPrice(priceGuidance);
  if (amount === null) return "on_request";
  return /\b(from|starting|start|varies|per|approx|around|up to)\b|\+|–|-\s*\$/i.test(priceGuidance ?? "") ? "from" : "exact";
}

function money(amount: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function minutesOf(value: number | null | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Price and length for one package, size and set of add-ons. */
export function quoteBooking(input: {
  service: CatalogService | null;
  sizeKey?: string | null;
  addonIds?: readonly string[];
  addons: readonly CatalogAddon[];
}): { ok: true; quote: Quote } | { ok: false; error: QuoteError; detail?: string } {
  const service = input.service;
  if (!service) return { ok: false, error: "service_not_found" };

  let size: SizeOption | null = null;
  if (service.size_options.length > 0) {
    if (!input.sizeKey) return { ok: false, error: "size_required" };
    size = service.size_options.find((option) => option.key === input.sizeKey) ?? null;
    if (!size) return { ok: false, error: "size_not_found" };
  } else if (input.sizeKey) {
    return { ok: false, error: "size_not_found", detail: "This package has one price for every size." };
  }

  const baseMinutes = size?.duration_minutes ?? minutesOf(service.duration_minutes);
  if (!baseMinutes) return { ok: false, error: "duration_missing" };
  const basePrice = size?.price ?? jobValueFromPrice(service.price_guidance);
  const baseKind: PriceKind = size?.price != null ? "exact" : priceKindOf(service.price_guidance);

  const lines: QuoteLine[] = [
    {
      kind: "service",
      id: service.id,
      name: size ? `${service.name} (${size.label})` : service.name,
      price: basePrice,
      price_kind: baseKind,
      duration_minutes: baseMinutes,
    },
  ];

  const chosen: CatalogAddon[] = [];
  for (const id of new Set(input.addonIds ?? [])) {
    const addon = input.addons.find((item) => item.id === id && item.serviceIds.includes(service.id));
    if (!addon) return { ok: false, error: "addon_not_available", detail: id };
    chosen.push(addon);
    lines.push({
      kind: "addon",
      id: addon.id,
      name: addon.name,
      price: jobValueFromPrice(addon.price_guidance),
      price_kind: priceKindOf(addon.price_guidance),
      duration_minutes: minutesOf(addon.duration_minutes) ?? 0,
    });
  }

  const duration = lines.reduce((sum, line) => sum + line.duration_minutes, 0);
  let kind: PriceKind = "exact";
  if (lines.some((line) => line.price_kind === "from")) kind = "from";
  if (basePrice === null) kind = "on_request";
  const known = lines.filter((line) => line.price !== null).reduce((sum, line) => sum + (line.price ?? 0), 0);
  // An add-on without a figure still lets us show a starting total for the rest.
  if (kind === "exact" && lines.some((line) => line.price === null)) kind = "from";
  const amount = kind === "on_request" ? null : Math.round(known * 100) / 100;
  const label =
    amount === null ? "Price confirmed by the business" : kind === "from" ? `From ${money(amount)}` : money(amount);

  return {
    ok: true,
    quote: {
      service: { id: service.id, name: service.name },
      size: size ? { key: size.key, label: size.label } : null,
      addons: chosen.map((addon) => ({ id: addon.id, name: addon.name })),
      lines,
      duration_minutes: duration,
      price: { amount, kind, currency: "AUD", label },
    },
  };
}

export const QUOTE_ERROR_MESSAGES: Record<QuoteError, string> = {
  service_not_found: "That package isn't offered. Use an id from GET /booking/options.",
  size_required: "This package is priced by size. Send one of its size keys.",
  size_not_found: "That size isn't offered for this package.",
  addon_not_available: "One of the add-ons isn't offered with this package.",
  duration_missing: "This package has no set length yet, so it can't be booked online.",
};

const id = z.string().uuid();
export const bookingSelectionSchema = z.object({
  service_id: id,
  size: z.string().trim().max(40).optional().nullable(),
  addon_ids: z.array(id).max(20).optional().default([]),
});
export type BookingSelection = z.infer<typeof bookingSelectionSchema>;

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

export const bookingRequestSchema = bookingSelectionSchema.extend({
  starts_at: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "Use an ISO 8601 time from /booking/availability."),
  customer: z.object({
    name: z.string().trim().min(1).max(80),
    mobile: z.string().trim().min(8).max(20),
    email: z.string().trim().email().max(120).optional().nullable().or(z.literal("")),
    address: optionalText(200),
    suburb: optionalText(80),
    vehicle: optionalText(80),
    notes: optionalText(1000),
  }),
  sms_consent: z.boolean().optional().default(false),
  /** Shown back in the owner's records ("Glocast website"). */
  source: optionalText(60),
});
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

/** Idempotency keys must be long enough not to collide by accident. */
export function readIdempotencyKey(headers: Headers): string | null {
  const key = headers.get("idempotency-key")?.trim() ?? "";
  return /^[A-Za-z0-9._:-]{8,120}$/.test(key) ? key : null;
}
