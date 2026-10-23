// Phase 3 server side: loads tenant availability, generates offers, records the
// customer's explicit selection and confirms a booking.
//
// Everything here is tenant-scoped and server-authoritative. Slots, prices,
// statuses and booking ids are never taken from model output. The confirmation
// SMS goes through the existing single outbound path (`sendSms`), which keeps
// opt-out, suppression, quiet hours, usage caps, provider gating and message
// idempotency exactly as they were.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isSlotStillAvailable,
  resolveAvailableSlots,
  MAX_OFFERED_SLOTS,
  parseWeeklyWindows,
  type AvailabilityConfig,
  type AvailableSlot,
} from "@/lib/availability";
import { buildApprovedFacts, hasApprovedPrice } from "@/lib/approved-facts";
import {
  assessAutomaticBooking,
  assessBookingConfirmation,
  assessOfferGeneration,
  bookingConfirmationIdempotencyKey,
  buildBookingConfirmationMessage,
  buildSlotOfferMessage,
  slotOfferIdempotencyKey,
  type BookingDecision,
} from "@/lib/booking";

const AVAILABILITY_COLUMNS =
  "business_id, active, lead_time_minutes, horizon_days, offer_ttl_minutes, weekly_windows";

const OFFER_COLUMNS =
  "id, business_id, lead_id, service_id, service_name_snapshot, slot_start, slot_end, timezone, status, expires_at, accepted_at, accepted_message_id, confirmed_at, job_id, created_at";

export type OfferRow = {
  id: string;
  business_id: string;
  lead_id: string;
  service_id: string | null;
  service_name_snapshot: string | null;
  slot_start: string;
  slot_end: string;
  timezone: string;
  status: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_message_id: string | null;
  confirmed_at: string | null;
  job_id: string | null;
  created_at: string;
};

export const DEFAULT_AVAILABILITY = {
  active: false,
  lead_time_minutes: 120,
  horizon_days: 7,
  offer_ttl_minutes: 120,
  weekly_windows: [] as unknown[],
};

/** Tenant availability config, combining Business Settings with the booking row. */
export async function loadAvailabilityConfig(businessId: string): Promise<AvailabilityConfig> {
  const [{ data: business }, { data: availability }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("timezone, quiet_hours_start, quiet_hours_end")
      .eq("id", businessId)
      .single(),
    supabaseAdmin
      .from("booking_availability")
      .select(AVAILABILITY_COLUMNS)
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);

  const row = availability ?? DEFAULT_AVAILABILITY;
  return {
    timezone: business?.timezone ?? "Australia/Sydney",
    active: Boolean(row.active),
    leadTimeMinutes: Number(row.lead_time_minutes ?? 120),
    horizonDays: Number(row.horizon_days ?? 7),
    offerTtlMinutes: Number(row.offer_ttl_minutes ?? 120),
    weeklyWindows: parseWeeklyWindows(row.weekly_windows),
    quietHoursStart: Number(business?.quiet_hours_start ?? 21),
    quietHoursEnd: Number(business?.quiet_hours_end ?? 8),
  };
}

/**
 * Appointment length for a booking, taken ONLY from the approved service row.
 *
 * There is no business-wide fallback: a missing, non-positive or inactive
 * service duration means nothing is bookable. The value is never accepted from
 * the browser, the customer, AI text, price guidance or the description.
 */
export async function loadServiceDurationMinutes(
  businessId: string,
  serviceId: string | null | undefined,
): Promise<number | null> {
  if (!serviceId) return null;
  const { data } = await supabaseAdmin
    .from("services")
    .select("id, active, duration_minutes")
    .eq("id", serviceId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data || data.active !== true) return null;
  const minutes = Number(data.duration_minutes);
  if (!Number.isInteger(minutes) || minutes <= 0) return null;
  return minutes;
}

/** Slot starts already taken by this tenant: booked jobs and taken offers. */
export async function occupiedSlotStarts(
  businessId: string,
  ignoreOfferId?: string,
): Promise<string[]> {
  const [jobs, offers] = await Promise.all([
    supabaseAdmin
      .from("jobs")
      .select("scheduled_at")
      .eq("business_id", businessId)
      .eq("completion_status", "scheduled")
      .not("scheduled_at", "is", null),
    supabaseAdmin
      .from("booking_offers")
      .select("id, slot_start, status")
      .eq("business_id", businessId)
      .in("status", ["accepted", "confirmed"]),
  ]);

  const starts: string[] = [];
  for (const job of jobs.data ?? []) {
    if (job.scheduled_at) starts.push(new Date(job.scheduled_at).toISOString());
  }
  for (const offer of offers.data ?? []) {
    if (ignoreOfferId && offer.id === ignoreOfferId) continue;
    starts.push(new Date(offer.slot_start).toISOString());
  }
  return starts;
}

async function audit(input: {
  businessId: string;
  userId?: string | null | undefined;
  eventType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { recordAuditEvent } = await import("@/lib/lead-engine.server");
  await recordAuditEvent({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: input.eventType,
    entityType: "lead",
    entityId: input.entityId ?? null,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

type LeadRow = {
  id: string;
  business_id: string;
  name: string;
  status: string;
  opted_out_at: string | null;
  sms_suppressed_at: string | null;
  approved_service_id: string | null;
  service_name_snapshot: string | null;
  requires_owner_review: boolean | null;
};

const LEAD_COLUMNS =
  "id, business_id, name, status, opted_out_at, sms_suppressed_at, approved_service_id, service_name_snapshot, requires_owner_review";

async function loadLeadAndConversation(businessId: string, leadId: string) {
  const [{ data: lead }, { data: conversation }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("id", leadId)
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabaseAdmin
      .from("conversations")
      .select("id, automation_paused")
      .eq("lead_id", leadId)
      .eq("business_id", businessId)
      .maybeSingle(),
  ]);
  return { lead: (lead ?? null) as LeadRow | null, conversation: conversation ?? null };
}

/** Read-only view for the lead detail UI. Never writes. */
export async function getBookingView(input: { businessId: string; leadId: string }): Promise<{
  config: AvailabilityConfig;
  slots: AvailableSlot[];
  offers: OfferRow[];
}> {
  const config = await loadAvailabilityConfig(input.businessId);
  const { lead } = await loadLeadAndConversation(input.businessId, input.leadId);
  const slotMinutes = await loadServiceDurationMinutes(
    input.businessId,
    lead?.approved_service_id ?? null,
  );
  const [occupied, offers] = await Promise.all([
    occupiedSlotStarts(input.businessId),
    supabaseAdmin
      .from("booking_offers")
      .select(OFFER_COLUMNS)
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .order("slot_start", { ascending: true }),
  ]);
  return {
    config,
    slots: slotMinutes
      ? resolveAvailableSlots({ config, slotMinutes, now: new Date(), occupiedStarts: occupied })
      : [],
    offers: (offers.data ?? []) as OfferRow[],
  };
}

/**
 * Computes valid options and persists them as offers. Idempotent: the unique
 * index on (business_id, lead_id, slot_start) means a replay reuses the same
 * offer rows instead of creating duplicates.
 */
export async function generateBookingOffers(input: {
  businessId: string;
  leadId: string;
  userId?: string | null;
}): Promise<{ ok: boolean; decision: BookingDecision; offers: OfferRow[] }> {
  const { lead, conversation } = await loadLeadAndConversation(input.businessId, input.leadId);
  if (!lead)
    return {
      ok: false,
      decision: { allowed: false, reason: "cross_tenant", needsHumanReview: true },
      offers: [],
    };

  const config = await loadAvailabilityConfig(input.businessId);
  const slotMinutes = await loadServiceDurationMinutes(
    input.businessId,
    lead.approved_service_id,
  );
  if (!slotMinutes)
    return {
      ok: false,
      decision: { allowed: false, reason: "service_duration_missing", needsHumanReview: true },
      offers: [],
    };
  const occupied = await occupiedSlotStarts(input.businessId);
  const slots = resolveAvailableSlots({
    config,
    slotMinutes,
    now: new Date(),
    occupiedStarts: occupied,
    limit: MAX_OFFERED_SLOTS,
  });

  const decision = assessOfferGeneration({
    businessId: input.businessId,
    lead,
    conversation,
    availabilityActive: config.active,
    serviceDurationMinutes: slotMinutes,
    slotCount: slots.length,
  });
  if (!decision.allowed) return { ok: false, decision, offers: [] };

  const expiresAt = new Date(Date.now() + config.offerTtlMinutes * 60_000).toISOString();
  for (const slot of slots) {
    await supabaseAdmin
      .from("booking_offers")
      .upsert(
        {
          business_id: input.businessId,
          lead_id: input.leadId,
          service_id: lead.approved_service_id,
          service_name_snapshot: lead.service_name_snapshot,
          slot_start: slot.start,
          slot_end: slot.end,
          timezone: config.timezone,
          status: "offered",
          expires_at: expiresAt,
        },
        { onConflict: "business_id,lead_id,slot_start", ignoreDuplicates: false },
      )
      .select("id");
  }

  const { data: offers } = await supabaseAdmin
    .from("booking_offers")
    .select(OFFER_COLUMNS)
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .eq("status", "offered")
    .in(
      "slot_start",
      slots.map((slot) => slot.start),
    )
    .order("slot_start", { ascending: true });

  const rows = (offers ?? []) as OfferRow[];
  await audit({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: "booking_offers_generated",
    entityId: input.leadId,
    metadata: { slots: slots.map((slot) => slot.start), expires_at: expiresAt },
  });
  return { ok: true, decision, offers: rows };
}

/** Sends the server-composed options through the existing approved send path. */
export async function sendSlotOffer(input: {
  businessId: string;
  leadId: string;
  userId?: string | null;
}): Promise<{ sent: boolean; reason?: string; decision: BookingDecision; offers: OfferRow[] }> {
  const generated = await generateBookingOffers(input);
  if (!generated.ok)
    return {
      sent: false,
      reason: generated.decision.reason ?? "Options could not be offered.",
      decision: generated.decision,
      offers: [],
    };

  const [{ data: lead }, { data: business }] = await Promise.all([
    supabaseAdmin.from("leads").select("name, service_name_snapshot").eq("id", input.leadId).single(),
    supabaseAdmin.from("businesses").select("name").eq("id", input.businessId).single(),
  ]);

  const body = buildSlotOfferMessage({
    name: lead?.name ?? "there",
    businessName: business?.name ?? "our team",
    serviceName: lead?.service_name_snapshot ?? null,
    slotLabels: generated.offers.map((offer) =>
      new Intl.DateTimeFormat("en-AU", {
        timeZone: offer.timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
        .format(new Date(offer.slot_start))
        .replace(/\u202f/g, " "),
    ),
  });

  const { sendSms } = await import("@/lib/lead-engine.server");
  const result = await sendSms({
    businessId: input.businessId,
    leadId: input.leadId,
    body,
    kind: "manual",
    respectAutomation: false,
    userId: input.userId ?? null,
    idempotencyKey: slotOfferIdempotencyKey(generated.offers.map((offer) => offer.id)),
  });
  return {
    sent: Boolean(result.sent),
    ...(result.reason === undefined ? {} : { reason: result.reason }),
    decision: generated.decision,
    offers: generated.offers,
  };
}

/**
 * Normal-path automatic booking: ordinary approved bookings are confirmed by
 * the server as soon as the customer picks a server-generated slot. Exception
 * cases return without booking and stay with the owner.
 */
async function autoConfirmIfNormalPath(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  lead: LeadRow;
  conversation: { automation_paused?: boolean | null } | null;
}): Promise<{ automaticallyBooked: boolean; reason?: string }> {
  const [{ data: business }, { data: services }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("automation_enabled")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("services")
      .select(
        "id, business_id, name, description, price_guidance, included_items, excluded_items, qualification_note, active",
      )
      .eq("business_id", input.businessId)
      .eq("active", true),
  ]);

  const facts = buildApprovedFacts({
    businessId: input.businessId,
    lead: input.lead as never,
    services: (services ?? []) as never,
  });

  const gate = assessAutomaticBooking({
    businessId: input.businessId,
    lead: input.lead,
    conversation: input.conversation,
    automationEnabled: Boolean(business?.automation_enabled),
    approvedPriceAvailable: hasApprovedPrice(facts),
  });
  if (!gate.automatic) return { automaticallyBooked: false, ...(gate.reason ? { reason: gate.reason } : {}) };

  const confirmed = await confirmBooking({
    businessId: input.businessId,
    leadId: input.leadId,
    offerId: input.offerId,
    userId: null,
  });
  return {
    automaticallyBooked: confirmed.ok,
    ...(confirmed.reason === undefined ? {} : { reason: confirmed.reason }),
  };
}

/**
 * Records the customer's explicit selection of ONE server-returned option.
 * `messageId` must be an inbound message on this lead. the deterministic proof
 * of customer confirmation. The conditional update plus the partial unique index
 * on (business_id, slot_start) makes double-booking impossible.
 */
export async function recordCustomerSlotSelection(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  messageId: string;
  userId?: string | null;
}): Promise<{
  ok: boolean;
  reason?: string;
  offer?: OfferRow;
  automaticallyBooked?: boolean;
}> {
  const { data: message } = await supabaseAdmin
    .from("messages")
    .select("id, direction")
    .eq("id", input.messageId)
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .maybeSingle();
  if (!message || message.direction !== "inbound")
    return { ok: false, reason: "Selection must reference an inbound customer message." };

  const { data: offer } = await supabaseAdmin
    .from("booking_offers")
    .select(OFFER_COLUMNS)
    .eq("id", input.offerId)
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .maybeSingle();
  if (!offer) return { ok: false, reason: "That appointment option does not exist for this lead." };
  if (offer.status === "accepted" || offer.status === "confirmed")
    return { ok: true, offer: offer as OfferRow }; // replay-safe
  if (offer.status !== "offered") return { ok: false, reason: "That option is no longer open." };
  if (new Date(offer.expires_at).getTime() <= Date.now())
    return { ok: false, reason: "That appointment option has expired." };

  const { data: updated, error } = await supabaseAdmin
    .from("booking_offers")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_message_id: input.messageId,
    })
    .eq("id", input.offerId)
    .eq("business_id", input.businessId)
    .eq("status", "offered")
    .select(OFFER_COLUMNS)
    .maybeSingle();
  if (error) return { ok: false, reason: "That time is no longer available." };
  if (!updated) return { ok: false, reason: "That option is no longer open." };

  // Other options for this lead close once one is chosen.
  await supabaseAdmin
    .from("booking_offers")
    .update({ status: "withdrawn" })
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .eq("status", "offered")
    .neq("id", input.offerId);

  await audit({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: "booking_slot_selected",
    entityId: input.leadId,
    metadata: { offer_id: input.offerId, slot_start: offer.slot_start, message_id: input.messageId },
  });

  const { lead, conversation } = await loadLeadAndConversation(input.businessId, input.leadId);
  if (!lead) return { ok: true, offer: updated as OfferRow, automaticallyBooked: false };

  const auto = await autoConfirmIfNormalPath({
    businessId: input.businessId,
    leadId: input.leadId,
    offerId: input.offerId,
    lead,
    conversation,
  });

  return {
    ok: true,
    offer: updated as OfferRow,
    automaticallyBooked: auto.automaticallyBooked,
    ...(auto.automaticallyBooked || auto.reason === undefined ? {} : { reason: auto.reason }),
  };
}

/**
 * The only path to `scheduled`/Booked. Owner-invoked, tenant-scoped, and it
 * revalidates availability at the moment of booking.
 */
export async function confirmBooking(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  userId?: string | null;
}): Promise<{
  ok: boolean;
  reason?: string;
  decision: BookingDecision;
  alreadyConfirmed?: boolean;
  jobId?: string;
  smsSent?: boolean;
  smsReason?: string;
}> {
  const { lead, conversation } = await loadLeadAndConversation(input.businessId, input.leadId);
  if (!lead)
    return {
      ok: false,
      reason: "Lead not found for this business.",
      decision: { allowed: false, reason: "cross_tenant", needsHumanReview: true },
    };

  const { data: offerRow } = await supabaseAdmin
    .from("booking_offers")
    .select(OFFER_COLUMNS)
    .eq("id", input.offerId)
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .maybeSingle();
  const offer = (offerRow ?? null) as OfferRow | null;

  // Replaying the same confirmation is a no-op: no second job, SMS or usage.
  if (offer?.status === "confirmed") {
    return {
      ok: true,
      alreadyConfirmed: true,
      decision: { allowed: true, reason: null, needsHumanReview: false },
      ...(offer.job_id ? { jobId: offer.job_id } : {}),
    };
  }

  const config = await loadAvailabilityConfig(input.businessId);
  // Slot length comes from the offer's own approved service, re-read server side.
  const slotMinutes = await loadServiceDurationMinutes(
    input.businessId,
    offer?.service_id ?? lead.approved_service_id,
  );
  const occupied = await occupiedSlotStarts(input.businessId, input.offerId);
  const revalidated = offer && slotMinutes
    ? isSlotStillAvailable({
        config,
        slotMinutes,
        now: new Date(),
        occupiedStarts: occupied,
        slotStart: offer.slot_start,
      })
    : { available: false, slot: null };

  const decision = assessBookingConfirmation({
    businessId: input.businessId,
    lead,
    conversation,
    offer,
    slotStillAvailable: revalidated.available,
    now: new Date(),
  });

  if (!decision.allowed) {
    await audit({
      businessId: input.businessId,
      userId: input.userId ?? null,
      eventType: "booking_confirmation_blocked",
      entityId: input.leadId,
      metadata: { offer_id: input.offerId, reason: decision.reason },
    });
    return { ok: false, reason: decision.reason ?? "Booking blocked.", decision };
  }

  const confirmed = offer!;
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name")
    .eq("id", input.businessId)
    .single();

  const body = buildBookingConfirmationMessage({
    name: lead.name,
    businessName: business?.name ?? "our team",
    serviceName: confirmed.service_name_snapshot ?? lead.service_name_snapshot ?? null,
    slotLabel: revalidated.slot!.label,
  });

  const { sendSms } = await import("@/lib/lead-engine.server");
  const sms = await sendSms({
    businessId: input.businessId,
    leadId: input.leadId,
    body,
    kind: "manual",
    respectAutomation: false,
    userId: input.userId ?? null,
    idempotencyKey: bookingConfirmationIdempotencyKey(confirmed.id),
  });

  // The booking only exists once the confirmation has left through the approved
  // send path (a duplicate-suppressed replay counts as already delivered).
  if (!sms.sent && !sms.duplicate) {
    await audit({
      businessId: input.businessId,
      userId: input.userId ?? null,
      eventType: "booking_confirmation_blocked",
      entityId: input.leadId,
      metadata: { offer_id: confirmed.id, reason: "confirmation_not_sent", detail: sms.reason ?? null },
    });
    return {
      ok: false,
      reason: sms.reason ?? "Confirmation SMS was not sent. the lead is not booked.",
      decision: { allowed: false, reason: null, needsHumanReview: true },
      smsSent: false,
      ...(sms.reason === undefined ? {} : { smsReason: sms.reason }),
    };
  }

  // Scheduled job record only. never a completed job and never a value.
  const { data: existingJob } = await supabaseAdmin
    .from("jobs")
    .select("id, completion_status")
    .eq("business_id", input.businessId)
    .eq("lead_id", input.leadId)
    .maybeSingle();

  let jobId = existingJob?.id ?? null;
  const jobPayload = {
    business_id: input.businessId,
    lead_id: input.leadId,
    service_id: confirmed.service_id,
    scheduled_at: confirmed.slot_start,
    completion_status: "scheduled",
  };
  if (existingJob) {
    const { data: saved, error: jobError } = await supabaseAdmin
      .from("jobs")
      .update(jobPayload)
      .eq("business_id", input.businessId)
      .eq("id", existingJob.id)
      .select("id")
      .single();
    if (jobError || !saved) {
      return {
        ok: false,
        reason: "The booking could not be saved. Please check the schedule before confirming again.",
        decision: { allowed: false, reason: "slot_unavailable", needsHumanReview: true },
      };
    }
  } else {
    const { data: created, error: jobError } = await supabaseAdmin
      .from("jobs")
      .insert(jobPayload)
      .select("id")
      .single();
    if (jobError || !created) {
      return {
        ok: false,
        reason: "That time was taken while confirming. nothing was booked.",
        decision: { allowed: false, reason: "slot_unavailable", needsHumanReview: true },
      };
    }
    jobId = created.id;
  }

  await supabaseAdmin
    .from("booking_offers")
    .update({
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      confirmed_by: input.userId ?? null,
      job_id: jobId,
    })
    .eq("id", confirmed.id)
    .eq("business_id", input.businessId);

  await supabaseAdmin
    .from("leads")
    .update({ status: "scheduled" })
    .eq("id", input.leadId)
    .eq("business_id", input.businessId);

  await audit({
    businessId: input.businessId,
    userId: input.userId ?? null,
    eventType: "booking_confirmed",
    entityId: input.leadId,
    metadata: {
      offer_id: confirmed.id,
      slot_start: confirmed.slot_start,
      job_id: jobId,
      timezone: config.timezone,
    },
  });

  return {
    ok: true,
    decision,
    ...(jobId ? { jobId } : {}),
    smsSent: Boolean(sms.sent),
  };
}
