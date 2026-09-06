// Operational booking-confirmation SMS: sent immediately after a booking is committed.
//
// Runs only after a booking has been committed (confirmed offer + job). It
// never creates, moves or cancels a booking, never starts a sequence, never
// sends anything promotional, and never composes its own copy — the body comes
// from the versioned template in `booking-confirmation.ts`.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BOOKING_CONFIRMATION_TEMPLATE_ID,
  evaluateConfirmationEligibility,
  renderBookingConfirmation,
  resolveTenantCallbackNumber,
  type ConfirmationOutcome,
} from "@/lib/booking-confirmation";
import { bookingConfirmationIdempotencyKey } from "@/lib/booking";

export type ConfirmationResult = {
  outcome: ConfirmationOutcome;
  sent: boolean;
  queuedFor: string | null;
  reason: string;
  messageId?: string | undefined;
  templateId: typeof BOOKING_CONFIRMATION_TEMPLATE_ID;
};

async function record(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  outcome: ConfirmationOutcome;
  reason: string;
  queuedFor?: string | null;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    event_type: "booking_confirmation_sms",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      offer_id: input.offerId,
      outcome: input.outcome,
      reason: input.reason,
      template_id: BOOKING_CONFIRMATION_TEMPLATE_ID,
      queued_for: input.queuedFor ?? null,
    } as never,
  });
}

/**
 * Evaluates one confirmation event and either sends it, queues it until the
 * tenant's quiet window ends, or records exactly why it was blocked.
 */
export async function deliverBookingConfirmation(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  /** Set when called from the release job: never re-queue, just decide. */
  fromRelease?: boolean;
  now?: Date | undefined;
}): Promise<ConfirmationResult> {
  const [{ data: lead }, { data: business }, { data: offer }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select(
        "id, name, mobile_number, consent_status, opted_out_at, sms_suppressed_at, service_name_snapshot",
      )
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabaseAdmin
      .from("businesses")
      .select(
        "name, timezone, phone_number, owner_notification_number, quiet_hours_start, quiet_hours_end",
      )
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("booking_offers")
      .select("id, status, job_id, slot_start, timezone, service_name_snapshot, confirmation_sms_sent_at")
      .eq("id", input.offerId)
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .maybeSingle(),
  ]);

  const base = { templateId: BOOKING_CONFIRMATION_TEMPLATE_ID, sent: false, queuedFor: null } as const;
  if (!lead || !business || !offer) {
    return {
      ...base,
      outcome: "blocked_no_booking",
      reason: "Booking, customer or business record not found for this tenant.",
    };
  }

  const decision = evaluateConfirmationEligibility({
    offerStatus: offer.status,
    jobId: offer.job_id,
    confirmationSentAt: offer.confirmation_sms_sent_at,
    consentStatus: lead.consent_status,
    optedOutAt: lead.opted_out_at,
    smsSuppressedAt: lead.sms_suppressed_at,
    mobileNumber: lead.mobile_number,
    tenantCallbackNumber: business.phone_number,
    ownerNotificationNumber: business.owner_notification_number,
  });

  if (!decision.sendable) {
    await record({ ...input, outcome: decision.outcome, reason: decision.reason });
    return { ...base, outcome: decision.outcome, reason: decision.reason };
  }

  const timezone = offer.timezone ?? business.timezone;

  // The booking confirmation is transactional: the customer has just booked and
  // is told immediately, at any hour. Quiet hours never hold it back and it is
  // never queued — the outbound path carries a template-scoped exemption for
  // this one message. Promotional copy and sequence steps remain blocked.



  const callbackNumber = resolveTenantCallbackNumber(business)!;
  const { body, templateId } = renderBookingConfirmation({
    customerName: lead.name,
    tenantName: business.name,
    serviceName: offer.service_name_snapshot ?? lead.service_name_snapshot,
    slotStart: offer.slot_start,
    timezone,
    callbackNumber,
  });

  const { sendSms } = await import("@/lib/lead-engine.server");
  const result = await sendSms({
    businessId: input.businessId,
    leadId: input.leadId,
    body,
    kind: "manual",
    respectAutomation: false,
    userId: null,
    source: "quote_page",
    templateId,
    idempotencyKey: bookingConfirmationIdempotencyKey(offer.id),
  });

  if (result.sent || result.duplicate) {
    await supabaseAdmin
      .from("booking_offers")
      .update({
        confirmation_sms_sent_at: new Date().toISOString(),
        ...(result.messageId ? { confirmation_message_id: result.messageId } : {}),
      })
      .eq("id", offer.id)
      .eq("business_id", input.businessId);
    const outcome: ConfirmationOutcome = result.sent ? "sent" : "duplicate_suppressed";
    await record({ ...input, outcome, reason: result.reason ?? "Confirmation sent." });
    return {
      ...base,
      outcome,
      sent: result.sent === true,
      reason: result.reason ?? "Confirmation sent.",
      messageId: result.messageId,
    };
  }

  await record({ ...input, outcome: "failed", reason: result.reason ?? "Send failed." });
  return { ...base, outcome: "failed", reason: result.reason ?? "Send failed." };
}
