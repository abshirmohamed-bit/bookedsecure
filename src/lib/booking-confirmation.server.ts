// Operational booking-confirmation SMS: send now, or queue for release at the
// end of the tenant's quiet window.
//
// Runs only after a booking has been committed (confirmed offer + job). It
// never creates, moves or cancels a booking, never starts a sequence, never
// sends anything promotional, and never composes its own copy — the body comes
// from the versioned template in `booking-confirmation.ts`.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BOOKING_CONFIRMATION_TEMPLATE_ID,
  confirmationJobIdempotencyKey,
  confirmationReleaseAt,
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
  now?: Date;
}): Promise<ConfirmationResult> {
  const now = input.now ?? new Date();
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
      .select("name, timezone, phone_number, quiet_hours_start, quiet_hours_end")
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
  });

  if (!decision.sendable) {
    await record({ ...input, outcome: decision.outcome, reason: decision.reason });
    return { ...base, outcome: decision.outcome, reason: decision.reason };
  }

  const timezone = offer.timezone ?? business.timezone;

  // Overnight bookings wait for the tenant's quiet window to end — the
  // confirmation is never dropped and never sent inside quiet hours.
  if (!input.fromRelease) {
    const release = confirmationReleaseAt(
      {
        timezone: business.timezone,
        quiet_hours_start: business.quiet_hours_start,
        quiet_hours_end: business.quiet_hours_end,
      },
      now,
    );
    if (release) {
      const { enqueueJob } = await import("@/lib/jobs.server");
      await enqueueJob({
        businessId: input.businessId,
        leadId: input.leadId,
        jobType: "booking_confirmation",
        idempotencyKey: confirmationJobIdempotencyKey(offer.id),
        payload: { offer_id: offer.id },
        runAt: release,
      });
      const queuedFor = release.toISOString();
      await record({ ...input, outcome: "queued_quiet_hours", reason: decision.reason, queuedFor });
      return {
        ...base,
        outcome: "queued_quiet_hours",
        queuedFor,
        reason: `Quiet hours — confirmation queued for ${queuedFor}.`,
      };
    }
  }

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
