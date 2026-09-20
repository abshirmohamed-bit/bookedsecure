// Phase 4 pilot server side: server-computed appointment slots for the public AI
// quote chat, plus the transactional booking commit.
//
// Hard boundaries held here:
// - Slots are ALWAYS computed server-side from the tenant's saved availability
//   (timezone, working windows, minimum notice, horizon, appointment length).
//   Nothing about a slot is ever taken from the browser.
// - The customer's selection is revalidated against fresh availability before
//   any booking action, and committed through a single database routine so the
//   booking either exists completely or not at all.
// - No SMS, no `messages` row, no provider call, no AI usage event and no
//   automation job is created on this path.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isSlotStillAvailable } from "@/lib/availability";
import {
  generateBookingOffers,
  loadAvailabilityConfig,
  loadServiceDurationMinutes,
  occupiedSlotStarts,
  type OfferRow,
} from "@/lib/availability.server";
import { buildBookingConfirmationMessage } from "@/lib/booking";
import {
  isPilotEligible,
  slotLabel,
  webChatBookingIdempotencyKey,
  type PilotOffer,
} from "@/lib/web-chat-booking";

export type CommitOutcome =
  | { ok: true; replay: boolean; offerId: string; jobId: string; slotStart: string }
  | { ok: false; reason: string };

/** Maps offer rows to the client-safe, tenant-labelled shape stored on the conversation. */
export function toPilotOffers(offers: OfferRow[]): PilotOffer[] {
  return offers.map((offer) => ({
    offer_id: offer.id,
    slot_start: offer.slot_start,
    label: slotLabel(offer.slot_start, offer.timezone),
  }));
}

async function loadPilotLead(businessId: string, leadId: string) {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, business_id, status, approved_service_id, service_name_snapshot, requires_owner_review")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .maybeSingle();
  return data ?? null;
}

/**
 * Decides whether this lead is in the Full Detail pilot and, if so, generates
 * the server-computed options. Anything outside the pilot returns
 * `{ offered: false }` so the conversation completes exactly as it does today.
 */
export async function openBookingStep(input: {
  businessId: string;
  slug: string;
  leadId: string;
}): Promise<{ offered: false } | { offered: true; offers: PilotOffer[] }> {
  const lead = await loadPilotLead(input.businessId, input.leadId);
  if (!lead) return { offered: false };
  if (lead.requires_owner_review === true) return { offered: false };
  if (!lead.approved_service_id) return { offered: false };

  const { data: service } = await supabaseAdmin
    .from("services")
    .select("id, name, active, duration_minutes")
    .eq("id", lead.approved_service_id)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!service) return { offered: false };

  const config = await loadAvailabilityConfig(input.businessId);
  // Appointment length is the approved service's own duration, read server side.
  const slotMinutes = await loadServiceDurationMinutes(input.businessId, service.id);

  // Slots come from the tenant's own configuration, evaluated in the tenant
  // timezone. The eligibility gate also needs the live slot count.
  const occupied = await occupiedSlotStarts(input.businessId);
  const { resolveAvailableSlots, MAX_OFFERED_SLOTS } = await import("@/lib/availability");
  const preview = slotMinutes === null ? [] : resolveAvailableSlots({
    config,
    slotMinutes,
    now: new Date(),
    occupiedStarts: occupied,
    limit: MAX_OFFERED_SLOTS,
  });

  const { isBookingOnlyTenant } = await import("@/lib/booking-only-mode");
  const eligible = isPilotEligible({
    businessId: input.businessId,
    slug: input.slug,
    approvedServiceId: lead.approved_service_id,
    serviceName: service.name,
    serviceActive: service.active === true,
    serviceDurationMinutes: slotMinutes,
    availabilityActive: config.active,
    slotCount: preview.length,
    bookingOnlyTenant: isBookingOnlyTenant(input.businessId),
  });
  if (!eligible) return { offered: false };


  const generated = await generateBookingOffers({
    businessId: input.businessId,
    leadId: input.leadId,
    userId: null,
  });
  if (!generated.ok || generated.offers.length === 0) return { offered: false };

  return { offered: true, offers: toPilotOffers(generated.offers) };
}

/** Recomputes fresh options after a conflict, without restarting the conversation. */
export async function refreshBookingOffers(input: {
  businessId: string;
  leadId: string;
}): Promise<PilotOffer[]> {
  const generated = await generateBookingOffers({ ...input, userId: null });
  if (!generated.ok) return [];
  return toPilotOffers(generated.offers);
}

/**
 * Resume-safe offer list.
 *
 * A conversation resumed after a refresh must never re-present an offer that
 * has since expired or been taken, and must never be able to produce a second
 * booking for a lead that is already booked. Everything is re-derived from the
 * database and from live availability. the stored `pilot_offers` on the
 * conversation are treated as untrusted display state.
 */
export async function rehydrateBookingOffers(input: {
  businessId: string;
  leadId: string;
}): Promise<
  | { state: "already_booked"; slotStart: string }
  | { state: "open"; offers: PilotOffer[] }
  | { state: "unavailable" }
> {
  const lead = await loadPilotLead(input.businessId, input.leadId);
  if (!lead) return { state: "unavailable" };

  const { data: existing } = await supabaseAdmin
    .from("booking_offers")
    .select("id, slot_start, status, expires_at, job_id")
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .order("slot_start", { ascending: true });

  const rows = existing ?? [];
  const booked = rows.find((row) => row.status === "confirmed" && row.job_id);
  if (booked) return { state: "already_booked", slotStart: booked.slot_start };

  const config = await loadAvailabilityConfig(input.businessId);
  const slotMinutes = await loadServiceDurationMinutes(
    input.businessId,
    lead.approved_service_id,
  );
  if (slotMinutes === null) return { state: "unavailable" };
  const occupied = await occupiedSlotStarts(input.businessId);
  const now = new Date();

  const live = rows.filter((row) => {
    if (row.status !== "offered") return false;
    if (new Date(row.expires_at).getTime() <= now.getTime()) return false;
    return isSlotStillAvailable({
      config,
      slotMinutes,
      now,
      occupiedStarts: occupied,
      slotStart: row.slot_start,
    }).available;
  });

  if (live.length > 0) {
    return {
      state: "open",
      offers: live.map((row) => ({
        offer_id: row.id,
        slot_start: row.slot_start,
        label: slotLabel(row.slot_start, config.timezone),
      })),
    };
  }

  const fresh = await refreshBookingOffers(input);
  if (fresh.length === 0) return { state: "unavailable" };
  return { state: "open", offers: fresh };
}

/**
 * Revalidates the customer's chosen slot and commits the booking.
 *
 * Availability is recomputed here. an expired, occupied, malformed or
 * cross-tenant slot is rejected even though it was once offered. The commit
 * itself runs inside one database routine (job + offer confirmation + peer
 * withdrawal + lead status), so a partial booking cannot exist. A replay of the
 * same selection returns the existing booking.
 */
export async function commitWebChatBooking(input: {
  businessId: string;
  leadId: string;
  conversationId: string;
  offerId: string;
}): Promise<CommitOutcome> {
  const lead = await loadPilotLead(input.businessId, input.leadId);
  if (!lead) return { ok: false, reason: "cross_tenant" };

  const { data: offerRow } = await supabaseAdmin
    .from("booking_offers")
    .select("id, business_id, lead_id, slot_start, status, expires_at, job_id, service_name_snapshot, timezone")
    .eq("id", input.offerId)
    // Tenant AND lead scoping: an offer from another business or lead is invisible.
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .maybeSingle();
  if (!offerRow) return { ok: false, reason: "offer_not_found" };

  if (offerRow.status === "confirmed" && offerRow.job_id) {
    return {
      ok: true,
      replay: true,
      offerId: offerRow.id,
      jobId: offerRow.job_id,
      slotStart: offerRow.slot_start,
    };
  }

  // An offer that has been withdrawn, or that belongs to a booking that has
  // already been made elsewhere, can never be committed.
  if (offerRow.status !== "offered" && offerRow.status !== "accepted") {
    return { ok: false, reason: "offer_closed" };
  }

  // Expiry is enforced here as well as inside the commit routine, so an expired
  // offer id never reaches the transaction at all.
  if (new Date(offerRow.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "offer_expired" };
  }

  const config = await loadAvailabilityConfig(input.businessId);
  // Duration is re-derived from the approved service; the client never supplies it.
  const slotMinutes = await loadServiceDurationMinutes(
    input.businessId,
    lead.approved_service_id,
  );
  if (slotMinutes === null) return { ok: false, reason: "service_duration_missing" };
  const occupied = await occupiedSlotStarts(input.businessId, offerRow.id);
  const revalidated = isSlotStillAvailable({
    config,
    slotMinutes,
    now: new Date(),
    occupiedStarts: occupied,
    slotStart: offerRow.slot_start,
  });
  if (!revalidated.available) return { ok: false, reason: "slot_unavailable" };

  const { data, error } = await supabaseAdmin.rpc("commit_web_chat_booking", {
    p_business_id: input.businessId,
    p_lead_id: input.leadId,
    p_offer_id: input.offerId,
    p_idempotency_key: webChatBookingIdempotencyKey(input.conversationId, input.offerId),
  });
  if (error) {
    console.error("[web-chat] booking commit failed", error);
    return { ok: false, reason: "commit_failed" };
  }

  const result = (data ?? {}) as {
    ok?: boolean;
    replay?: boolean;
    reason?: string;
    offer_id?: string;
    job_id?: string;
    slot_start?: string;
  };
  if (result.ok !== true || !result.job_id || !result.offer_id || !result.slot_start) {
    return { ok: false, reason: result.reason ?? "commit_failed" };
  }
  // The booking is confirmed, so any pending follow-up timer is void. Idempotent.
  await supabaseAdmin
    .from("conversations")
    .update({ next_follow_up_at: null })
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId);
  return {
    ok: true,
    replay: result.replay === true,
    offerId: result.offer_id,
    jobId: result.job_id,
    slotStart: result.slot_start,
  };
}

/** Server-composed confirmation text for the web transcript. Never model output. */
export async function bookingConfirmationText(input: {
  businessId: string;
  leadId: string;
  slotStart: string;
}): Promise<string> {
  const [{ data: lead }, { data: business }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("name, service_name_snapshot")
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .maybeSingle(),
    supabaseAdmin.from("businesses").select("name, timezone").eq("id", input.businessId).maybeSingle(),
  ]);
  return buildBookingConfirmationMessage({
    name: lead?.name ?? "there",
    businessName: business?.name ?? "our team",
    serviceName: lead?.service_name_snapshot ?? null,
    slotLabel: slotLabel(input.slotStart, business?.timezone ?? "Australia/Sydney"),
  });
}
