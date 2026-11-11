/**
 * Booking engine: server layer for the website booking API.
 *
 * Every read and write is scoped to the calling key's business. Availability
 * returns times only, never who holds the other bookings. A booking is
 * re-checked against live availability and then saved by one database routine
 * (api_book_appointment) that locks the schedule, replays repeated requests and
 * refuses overlaps, so double bookings and duplicate submissions can't happen.
 * The confirmation goes through the existing confirmation path, once.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isSlotStillAvailable,
  resolveAvailableSlots,
  zonedWallClockToUtc,
  type AvailableSlot,
} from "@/lib/availability";
import { loadAvailabilityConfig, loadBookingRules, loadBusyIntervals } from "@/lib/availability.server";
import {
  parseSizeOptions,
  priceKindOf,
  quoteBooking,
  type BookingRequest,
  type BookingSelection,
  type CatalogAddon,
  type CatalogService,
  type Quote,
  type QuoteError,
} from "@/lib/booking-engine";
import { buildConsentPromotion } from "@/lib/consent-promotion";
import { normaliseAuMobile } from "@/lib/domain";
import { jobValueFromPrice } from "@/lib/job-autocomplete";

/** Most start times one availability request returns. */
export const MAX_API_SLOTS = 300;
/** Longest date range one availability request may cover. */
export const MAX_API_DAYS = 31;

export async function loadCatalog(businessId: string): Promise<{ services: CatalogService[]; addons: CatalogAddon[] }> {
  const [withSizes, addons] = await Promise.all([
    supabaseAdmin
      .from("services")
      .select("id, name, price_guidance, duration_minutes, size_options" as never)
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
    supabaseAdmin
      .from("service_addons")
      .select("id, name, price_guidance, duration_minutes, active, service_addon_links(service_id)")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name"),
  ]);

  // Before docs/booking-api.sql is applied there is no size_options column.
  let rows = (withSizes.data ?? []) as unknown as Array<Record<string, unknown>>;
  if (withSizes.error) {
    const { data, error } = await supabaseAdmin
      .from("services")
      .select("id, name, price_guidance, duration_minutes")
      .eq("business_id", businessId)
      .eq("active", true)
      .order("name");
    if (error) throw new Error("Could not read services.");
    rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  }
  if (addons.error) throw new Error("Could not read add-ons.");

  return {
    services: rows.map((row) => ({
      id: row["id"] as string,
      name: row["name"] as string,
      price_guidance: (row["price_guidance"] as string | null) ?? null,
      duration_minutes: (row["duration_minutes"] as number | null) ?? null,
      size_options: parseSizeOptions(row["size_options"]),
    })),
    addons: (addons.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      price_guidance: row.price_guidance ?? null,
      duration_minutes: row.duration_minutes ?? null,
      serviceIds: ((row.service_addon_links ?? []) as Array<{ service_id: string }>).map((link) => link.service_id),
    })),
  };
}

/** The packages, sizes and add-ons a website can offer, with this business's booking rules. */
export async function bookingOptions(businessId: string) {
  const [{ data: business }, catalog, config] = await Promise.all([
    supabaseAdmin.from("businesses").select("name, timezone").eq("id", businessId).maybeSingle(),
    loadCatalog(businessId),
    loadAvailabilityConfig(businessId),
  ]);
  return {
    business: { name: business?.name ?? null, timezone: config.timezone },
    online_booking: config.active,
    rules: {
      lead_time_minutes: config.leadTimeMinutes,
      horizon_days: config.horizonDays,
      travel_buffer_minutes: config.bufferMinutes ?? 0,
      slot_step_minutes: config.stepMinutes ?? 30,
    },
    services: catalog.services.map((service) => ({
      id: service.id,
      name: service.name,
      price_text: service.price_guidance,
      price: jobValueFromPrice(service.price_guidance),
      price_kind: priceKindOf(service.price_guidance),
      duration_minutes: service.duration_minutes,
      bookable_online: Boolean(service.duration_minutes) || service.size_options.some((size) => size.duration_minutes),
      sizes: service.size_options,
      addons: catalog.addons
        .filter((addon) => addon.serviceIds.includes(service.id))
        .map((addon) => ({
          id: addon.id,
          name: addon.name,
          price_text: addon.price_guidance,
          price: jobValueFromPrice(addon.price_guidance),
          price_kind: priceKindOf(addon.price_guidance),
          duration_minutes: addon.duration_minutes,
        })),
    })),
  };
}

export async function quoteFor(
  businessId: string,
  selection: BookingSelection,
): Promise<{ ok: true; quote: Quote } | { ok: false; error: QuoteError; detail?: string }> {
  const catalog = await loadCatalog(businessId);
  return quoteBooking({
    service: catalog.services.find((service) => service.id === selection.service_id) ?? null,
    sizeKey: selection.size ?? null,
    addonIds: selection.addon_ids ?? [],
    addons: catalog.addons,
  });
}

function localDateParts(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export type AvailabilityResult =
  | { ok: true; timezone: string; duration_minutes: number; quote: Quote; slots: Array<Pick<AvailableSlot, "start" | "end" | "label">>; reason: string | null }
  | { ok: false; error: QuoteError | "invalid_date"; detail?: string };

/**
 * Open start times for this package, size and add-ons. Local dates (YYYY-MM-DD,
 * in the business's timezone); `days` from `date`, capped at MAX_API_DAYS.
 */
export async function availabilityFor(
  businessId: string,
  selection: BookingSelection,
  range: { date?: string | null; days?: number | null },
): Promise<AvailabilityResult> {
  const quoted = await quoteFor(businessId, selection);
  if (!quoted.ok) return quoted;
  const [config, rules, busy] = await Promise.all([
    loadAvailabilityConfig(businessId),
    loadBookingRules(businessId),
    loadBusyIntervals(businessId),
  ]);

  let notBefore: Date | undefined;
  let notAfter: Date | undefined;
  const days = Math.min(Math.max(1, Math.floor(range.days ?? 7)), MAX_API_DAYS);
  if (range.date) {
    const parts = localDateParts(range.date);
    if (!parts) return { ok: false, error: "invalid_date", detail: "Use date=YYYY-MM-DD." };
    notBefore = zonedWallClockToUtc(config.timezone, parts.year, parts.month, parts.day, 0) ?? undefined;
    const end = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    notAfter =
      zonedWallClockToUtc(config.timezone, end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), 0) ?? undefined;
  } else {
    notAfter = new Date(Date.now() + days * 24 * 60 * 60_000);
  }

  const slots = resolveAvailableSlots({
    config,
    slotMinutes: quoted.quote.duration_minutes,
    stepMinutes: rules.stepMinutes,
    now: new Date(),
    busy,
    ...(notBefore ? { notBefore } : {}),
    ...(notAfter ? { notAfter } : {}),
    limit: MAX_API_SLOTS,
  });
  const reason = !config.active
    ? "Online booking is switched off for this business."
    : config.weeklyWindows.length === 0
      ? "No bookable hours are set for this business."
      : slots.length === 0
        ? "No open times in this range."
        : null;

  return {
    ok: true,
    timezone: config.timezone,
    duration_minutes: quoted.quote.duration_minutes,
    quote: quoted.quote,
    slots: slots.map((slot) => ({ start: slot.start, end: slot.end, label: slot.label })),
    reason,
  };
}

export type BookResult =
  | {
      ok: true;
      replay: boolean;
      booking: {
        id: string;
        customer_id: string;
        starts_at: string;
        ends_at: string;
        timezone: string;
        label: string;
        quote: Quote;
        status: "confirmed";
      };
      confirmation: { outcome: string; sent: boolean };
    }
  | { ok: false; status: number; error: string; message: string };

/**
 * Re-checks the chosen time and saves the customer and booking in one step.
 * The same Idempotency-Key always returns the first booking and never sends a
 * second confirmation.
 */
export async function bookAppointment(input: {
  businessId: string;
  apiKeyId: string;
  requestKey: string;
  request: BookingRequest;
}): Promise<BookResult> {
  const { request } = input;
  const mobile = normaliseAuMobile(request.customer.mobile);
  if (!mobile) {
    return { ok: false, status: 400, error: "invalid_mobile", message: "Send a valid Australian mobile number." };
  }

  const quoted = await quoteFor(input.businessId, request);
  if (!quoted.ok) {
    return { ok: false, status: 400, error: quoted.error, message: quoted.detail ?? quoted.error };
  }
  const quote = quoted.quote;

  const [config, rules, busy] = await Promise.all([
    loadAvailabilityConfig(input.businessId),
    loadBookingRules(input.businessId),
    loadBusyIntervals(input.businessId),
  ]);
  const startsAt = new Date(request.starts_at).toISOString();

  // A replay of an already-saved request skips the availability check (its own
  // booking now occupies the time) and returns the first result.
  const { data: existing } = await supabaseAdmin
    .from("jobs")
    .select("id" as never)
    .eq("business_id", input.businessId)
    .eq("booking_request_key" as never, input.requestKey as never)
    .maybeSingle();
  if (!existing) {
    const check = isSlotStillAvailable({
      config,
      slotMinutes: quote.duration_minutes,
      stepMinutes: rules.stepMinutes,
      now: new Date(),
      busy,
      slotStart: startsAt,
    });
    if (!check.available) {
      return {
        ok: false,
        status: 409,
        error: "slot_unavailable",
        message: "That time is no longer available. Fetch /booking/availability again and pick another.",
      };
    }
  }

  const source = request.source?.trim() || "Website";
  const consent = buildConsentPromotion({
    consented: request.sms_consent === true,
    consentText: `Customer agreed to booking texts on ${source} (BookedSecure booking API).`,
    sourceChannel: "website",
    sourceForm: "Website booking",
    formUrl: null,
    at: new Date().toISOString(),
  });

  const sizeText = quote.size ? ` (${quote.size.label})` : "";
  const addonText = quote.addons.length > 0 ? ` + ${quote.addons.map((addon) => addon.name).join(", ")}` : "";
  const { data, error } = await supabaseAdmin.rpc("api_book_appointment" as never, {
    p_business_id: input.businessId,
    p_request_key: input.requestKey,
    p_customer: {
      name: request.customer.name,
      mobile,
      email: request.customer.email || null,
      address: request.customer.address ?? null,
      suburb: request.customer.suburb ?? null,
      vehicle: request.customer.vehicle ?? null,
      notes: request.customer.notes ?? null,
      consent_status: "consent_status" in consent ? consent.consent_status : "unknown",
      consent_source: "consent_source" in consent ? consent.consent_source : null,
      consent_record: consent.consent_record,
      source_metadata: { api_key_id: input.apiKeyId, source, booking_api: true },
    },
    p_booking: {
      service_id: quote.service.id,
      service_name: quote.service.name,
      service_label: `${quote.service.name}${sizeText}${addonText}`.slice(0, 200),
      starts_at: startsAt,
      duration_minutes: quote.duration_minutes,
      buffer_minutes: rules.bufferMinutes,
      price: quote.price.amount,
      timezone: config.timezone,
      api_key_id: input.apiKeyId,
      details: { size: quote.size, addons: quote.addons, price: quote.price, lines: quote.lines, source },
    },
  } as never);

  if (error) {
    const missing = /api_book_appointment|function .* does not exist|PGRST202/i.test(error.message ?? "");
    console.error("[booking-api] book failed", error.message);
    return missing
      ? { ok: false, status: 503, error: "not_ready", message: "Online booking isn't set up for this account yet." }
      : { ok: false, status: 500, error: "server_error", message: "The booking could not be saved. Retry with the same Idempotency-Key." };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    replay?: boolean;
    reason?: string;
    job_id?: string;
    lead_id?: string;
    offer_id?: string;
    starts_at?: string;
  };
  if (result.ok !== true || !result.job_id || !result.lead_id) {
    if (result.reason === "slot_unavailable") {
      return { ok: false, status: 409, error: "slot_unavailable", message: "That time was just taken. Pick another." };
    }
    return { ok: false, status: 400, error: result.reason ?? "booking_refused", message: "The booking was not saved." };
  }

  // Confirmation: the existing path, keyed by the offer, so it is sent once.
  let confirmation = { outcome: "already_handled", sent: false };
  if (!result.replay && result.offer_id) {
    try {
      const { deliverBookingConfirmation } = await import("@/lib/booking-confirmation.server");
      const sent = await deliverBookingConfirmation({
        businessId: input.businessId,
        leadId: result.lead_id,
        offerId: result.offer_id,
      });
      confirmation = { outcome: sent.outcome, sent: sent.sent };
    } catch (e) {
      console.error("[booking-api] confirmation failed", e instanceof Error ? e.message : e);
      confirmation = { outcome: "failed", sent: false };
    }
    // The confirmation email, and the log of both. The text above is recorded, not resent.
    const { confirmNewBooking, smsOutcome } = await import("@/lib/booking-email.server");
    await confirmNewBooking({ businessId: input.businessId, jobId: result.job_id, leadId: result.lead_id, sms: smsOutcome(confirmation) });
  }

  const start = new Date(result.starts_at ?? startsAt);
  const end = new Date(start.getTime() + quote.duration_minutes * 60_000);
  const { slotLabel } = await import("@/lib/web-chat-booking");
  return {
    ok: true,
    replay: result.replay === true,
    booking: {
      id: result.job_id,
      customer_id: result.lead_id,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      timezone: config.timezone,
      label: slotLabel(start.toISOString(), config.timezone),
      quote,
      status: "confirmed",
    },
    confirmation,
  };
}
