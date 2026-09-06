// Owner booking-confirmation SMS delivery.
//
// Runs ONLY after `commit_web_chat_booking` has produced an authoritative
// booking (confirmed offer + job). It never creates, moves or cancels a
// booking, never touches the customer message row, never plans a sequence, and
// never composes its own copy. A failure here is recorded and swallowed: the
// booking, the customer confirmation and the dashboard alert all stand.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvider } from "@/lib/sms/provider.server";
import { resolveEffectiveProviderName } from "@/lib/sms/resolution";
import { resolveSender } from "@/lib/lead-engine.server";
import { countSegments } from "@/lib/sms/segments";
import { RESERVED_STATUS, canReuseOutboundRow } from "@/lib/sms/dispatch";
import {
  OWNER_BOOKING_CONFIRMED_TEMPLATE_ID,
  evaluateOwnerNotificationEligibility,
  ownerBookingConfirmationIdempotencyKey,
  renderOwnerBookingConfirmation,
  resolveOwnerNotificationNumber,
  type OwnerNotificationOutcome,
} from "@/lib/owner-notification";

export type OwnerNotificationResult = {
  outcome: OwnerNotificationOutcome;
  sent: boolean;
  reason: string;
  messageId?: string | undefined;
  providerMessageId?: string | null | undefined;
  toNumber?: string | undefined;
  fromNumber?: string | undefined;
  idempotencyKey: string;
  templateId: typeof OWNER_BOOKING_CONFIRMED_TEMPLATE_ID;
};

async function audit(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  outcome: OwnerNotificationOutcome;
  reason: string;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    event_type: "owner_booking_confirmation_sms",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      offer_id: input.offerId,
      outcome: input.outcome,
      reason: input.reason,
      template_id: OWNER_BOOKING_CONFIRMED_TEMPLATE_ID,
    } as never,
  });
}

/** Sends the owner alert for a booking that is already committed. */
export async function deliverOwnerBookingConfirmation(input: {
  businessId: string;
  leadId: string;
  offerId: string;
}): Promise<OwnerNotificationResult> {
  const idempotencyKey = ownerBookingConfirmationIdempotencyKey(input.offerId);
  const base = {
    templateId: OWNER_BOOKING_CONFIRMED_TEMPLATE_ID,
    sent: false,
    idempotencyKey,
  } as const;

  const [{ data: lead }, { data: business }, { data: offer }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, name, suburb, service_name_snapshot")
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabaseAdmin
      .from("businesses")
      .select("name, timezone, default_sms_provider, owner_notification_name, owner_notification_number")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("booking_offers")
      .select("id, status, job_id, slot_start, timezone, service_name_snapshot")
      .eq("id", input.offerId)
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .maybeSingle(),
  ]);

  if (!lead || !business || !offer) {
    return {
      ...base,
      outcome: "blocked_no_booking",
      reason: "Booking, customer or business record not found for this tenant.",
    };
  }

  const decision = evaluateOwnerNotificationEligibility({
    offerStatus: offer.status,
    jobId: offer.job_id,
    ownerNotificationNumber: business.owner_notification_number,
  });
  if (!decision.sendable) {
    await audit({ ...input, outcome: decision.outcome, reason: decision.reason });
    return { ...base, outcome: decision.outcome, reason: decision.reason };
  }

  // Owner alerts are idempotent on the confirmed booking: a replay reuses the
  // existing row and never dispatches a second message.
  const { data: prior } = await supabaseAdmin
    .from("messages")
    .select("id, delivery_status, provider_message_id")
    .eq("business_id", input.businessId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (prior && !canReuseOutboundRow(prior.delivery_status)) {
    await audit({
      ...input,
      outcome: "duplicate_suppressed",
      reason: "Owner notification already sent for this booking.",
    });
    return {
      ...base,
      outcome: "duplicate_suppressed",
      reason: "Owner notification already sent for this booking.",
      messageId: prior.id,
      providerMessageId: prior.provider_message_id,
    };
  }

  const ownerNumber = resolveOwnerNotificationNumber(business)!;
  const timezone = offer.timezone ?? business.timezone ?? "Australia/Sydney";
  const { body, templateId } = renderOwnerBookingConfirmation({
    tenantName: business.name,
    serviceName: offer.service_name_snapshot ?? lead.service_name_snapshot,
    customerName: lead.name,
    suburb: lead.suburb,
    slotStart: offer.slot_start,
    timezone,
  });

  // The tenant's own active primary sending line — never another tenant's, and
  // never the owner's number in the customer FROM role.
  const sender = await resolveSender({ businessId: input.businessId });
  if (!sender) {
    await audit({
      ...input,
      outcome: "failed",
      reason: "No active sender number configured for this business.",
    });
    return {
      ...base,
      outcome: "failed",
      reason: "No active sender number configured for this business.",
    };
  }
  const provider = getProvider(
    resolveEffectiveProviderName(business.default_sms_provider, sender.provider),
  );

  const { segments } = countSegments(body);

  // Reserve the row before dispatch; the unique index on
  // (business_id, idempotency_key) is the real duplicate guarantee.
  let messageId = prior?.id ?? null;
  if (messageId) {
    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: RESERVED_STATUS,
        body,
        provider: provider.name,
        sender_id: sender.id,
        from_number: sender.phoneNumber,
        to_number: ownerNumber,
        segments,
        error_code: null,
        failure_reason: null,
      })
      .eq("id", messageId);
  } else {
    const reservation = await supabaseAdmin
      .from("messages")
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        direction: "outbound",
        body,
        provider: provider.name,
        sender_id: sender.id,
        from_number: sender.phoneNumber,
        to_number: ownerNumber,
        recipient_role: "owner",
        segments,
        delivery_status: RESERVED_STATUS,
        message_kind: "manual",
        idempotency_key: idempotencyKey,
        template_id: templateId,
        attempt_count: 1,
        message_source: "quote_page",
        delivery_event_count: 0,
      })
      .select("id")
      .single();
    if (reservation.error || !reservation.data) {
      await audit({
        ...input,
        outcome: "duplicate_suppressed",
        reason: "A concurrent owner notification holds this booking's key.",
      });
      return {
        ...base,
        outcome: "duplicate_suppressed",
        reason: "A concurrent owner notification holds this booking's key.",
      };
    }
    messageId = reservation.data.id;
  }

  try {
    const result = await provider.sendMessage({ to: ownerNumber, body, sender });
    const acceptedAt = new Date().toISOString();
    const acceptanceStatus =
      result.deliveryStatus === "queued" || result.deliveryStatus === "unknown"
        ? "provider_accepted"
        : result.deliveryStatus;
    await supabaseAdmin
      .from("messages")
      .update({
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        provider_cost: result.providerCost ?? null,
        delivery_status: acceptanceStatus,
        provider_raw_status: result.deliveryStatus,
        error_code: result.errorCode ?? null,
        provider_accepted_at: acceptedAt,
        sent_at: acceptanceStatus === "provider_accepted" ? null : acceptedAt,
        ...(acceptanceStatus === "delivered" ? { delivered_at: acceptedAt } : {}),
      })
      .eq("id", messageId);
    await audit({ ...input, outcome: "sent", reason: "Owner notification sent." });
    return {
      ...base,
      outcome: "sent",
      sent: true,
      reason: "Owner notification sent.",
      messageId,
      providerMessageId: result.providerMessageId,
      toNumber: ownerNumber,
      fromNumber: sender.phoneNumber,
    };
  } catch (error) {
    const detail = provider.formatProviderError(error).slice(0, 200);
    await supabaseAdmin
      .from("messages")
      .update({
        delivery_status: "failed",
        failed_at: new Date().toISOString(),
        error_code: detail,
        failure_reason: detail,
      })
      .eq("id", messageId);
    await audit({ ...input, outcome: "failed", reason: detail });
    // Never rolls back the booking, the customer SMS or the dashboard alert.
    return {
      ...base,
      outcome: "failed",
      reason: detail,
      messageId,
      toNumber: ownerNumber,
      fromNumber: sender.phoneNumber,
    };
  }
}
