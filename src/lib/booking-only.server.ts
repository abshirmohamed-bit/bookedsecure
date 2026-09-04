// Booking-only mode: post-commit operational side effects.
//
// Runs ONLY after `commitWebChatBooking` has returned a committed booking from
// the deterministic `commit_web_chat_booking` routine. It never writes to
// `booking_offers.status`, `jobs`, `leads.status`, consent, owner review, caps,
// campaigns or kill switches; it never plans a follow-up sequence; and the only
// message it can produce is the server-composed operational confirmation,
// idempotent on the confirmed offer.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isBookingOnlyTenant, ownerBookingAlert } from "@/lib/booking-only-mode";
import { slotLabel } from "@/lib/web-chat-booking";

export type BookingOnlyFinalizeResult = {
  smsSent: boolean;
  smsSkippedReason: string | null;
  ownerAlerted: boolean;
  sequenceStarted: false;
};

/**
 * Sends the approved operational confirmation (consent-gated) and raises the
 * owner alert for a booking that already exists.
 */
export async function finalizeBookingOnlyBooking(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  slotStart: string;
  replay: boolean;
}): Promise<BookingOnlyFinalizeResult> {
  const base: BookingOnlyFinalizeResult = {
    smsSent: false,
    smsSkippedReason: null,
    ownerAlerted: false,
    sequenceStarted: false,
  };
  if (!isBookingOnlyTenant(input.businessId)) {
    return { ...base, smsSkippedReason: "tenant_not_booking_only" };
  }

  const [{ data: lead }, { data: business }, { data: offer }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, name, mobile_number, consent_status, opted_out_at, sms_suppressed_at, service_name_snapshot")
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabaseAdmin
      .from("businesses")
      .select("name, timezone")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("booking_offers")
      .select("id, status, job_id, slot_start, service_name_snapshot, timezone, confirmation_sms_sent_at")
      .eq("id", input.offerId)
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .maybeSingle(),
  ]);

  // Only an authoritative, committed booking may produce a message or an alert.
  if (!lead || !offer || offer.status !== "confirmed" || !offer.job_id) {
    return { ...base, smsSkippedReason: "no_confirmed_booking" };
  }

  const timezone = offer.timezone ?? business?.timezone ?? "Australia/Sydney";
  const label = slotLabel(offer.slot_start, timezone);
  const serviceName = offer.service_name_snapshot ?? lead.service_name_snapshot ?? null;

  // Operational confirmation: consent-gated, versioned template, tenant
  // callback number, queued to the end of quiet hours instead of dropped.
  const { deliverBookingConfirmation } = await import("@/lib/booking-confirmation.server");
  const confirmation = await deliverBookingConfirmation({
    businessId: input.businessId,
    leadId: input.leadId,
    offerId: offer.id,
  });
  const smsSent = confirmation.sent;
  const smsSkippedReason = confirmation.sent ? null : confirmation.outcome;


  const alert = ownerBookingAlert({
    businessId: input.businessId,
    leadId: input.leadId,
    offerId: offer.id,
    customerName: lead.name,
    serviceName,
    slotLabel: label,
  });
  const { createNotification } = await import("@/lib/jobs.server");
  const notified = await createNotification({
    businessId: input.businessId,
    leadId: input.leadId,
    kind: alert.kind,
    title: alert.title,
    body: alert.body,
    metadata: { offer_id: offer.id, job_id: offer.job_id, slot_start: offer.slot_start },
    idempotencyKey: alert.idempotencyKey,
  });

  return {
    smsSent,
    smsSkippedReason,
    ownerAlerted: notified.created,
    sequenceStarted: false,
  };
}
