// Delivers one immediate owner SMS for a durable new-lead inbox alert.
// Never changes the lead, customer acknowledgement, booking or follow-up state.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getProvider } from "@/lib/sms/provider.server";
import { resolveEffectiveProviderName } from "@/lib/sms/resolution";
import { resolveSender } from "@/lib/lead-engine.server";
import { countSegments } from "@/lib/sms/segments";
import { canReuseOutboundRow, classifyCarrierFailure, RESERVED_STATUS, UNKNOWN_STATUS } from "@/lib/sms/dispatch";
import { isUniqueViolation } from "@/lib/sms/webhook.server";
import { recordSmsUsage } from "@/lib/usage.server";
import { recordMessageSpend } from "@/lib/sms/texto-accounts.server";
import { FOUNDER_PLAN_ID } from "@/lib/plans";
import { resolveOwnerNotificationNumber } from "@/lib/owner-notification";
import {
  evaluateOwnerNewLeadEligibility,
  ownerNewLeadSmsIdempotencyKey,
  renderOwnerNewLeadAlert,
} from "@/lib/owner-new-lead-notification";

export type OwnerNewLeadSmsResult = {
  sent: boolean;
  duplicate?: boolean;
  retriable?: boolean;
  reason: string;
  messageId?: string;
};

async function audit(input: {
  businessId: string;
  leadId: string;
  outcome: string;
  reason: string;
  alertKey: string;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    event_type: "owner_new_lead_sms",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: { outcome: input.outcome, reason: input.reason.slice(0, 200), alert_key: input.alertKey } as never,
  });
}

export async function deliverOwnerNewLeadSms(input: {
  businessId: string;
  leadId: string;
  alertKey: string;
}): Promise<OwnerNewLeadSmsResult> {
  const idempotencyKey = ownerNewLeadSmsIdempotencyKey(input.alertKey);
  const blocked = async (reason: string, retriable = false): Promise<OwnerNewLeadSmsResult> => {
    await audit({ ...input, outcome: retriable ? "failed" : "blocked", reason });
    return { sent: false, retriable, reason };
  };

  const { data: existing } = await supabaseAdmin
    .from("messages")
    .select("id, delivery_status, attempt_count")
    .eq("business_id", input.businessId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing && !canReuseOutboundRow(existing.delivery_status)) {
    return { sent: false, duplicate: true, reason: "Owner SMS already sent for this alert.", messageId: existing.id };
  }

  const [{ data: business }, { data: lead }, { data: preferences }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("name, default_sms_provider, owner_notification_number, plan_id")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("leads")
      .select("id, name, mobile_number, service_name_snapshot, service_intent, suburb")
      .eq("id", input.leadId)
      .eq("business_id", input.businessId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabaseAdmin
      .from("notification_preferences")
      .select("muted_kinds")
      .eq("business_id", input.businessId)
      .maybeSingle(),
  ]);
  if (!business || !lead) return blocked("The lead or business no longer exists.");

  const eligibility = evaluateOwnerNewLeadEligibility({
    ownerNotificationNumber: business.owner_notification_number,
    mutedKinds: preferences?.muted_kinds ?? [],
  });
  if (!eligibility.sendable) return blocked(eligibility.reason);

  const sender = await resolveSender({ businessId: input.businessId });
  if (!sender) return blocked("No active sending number is configured for this business.", true);
  const provider = getProvider(resolveEffectiveProviderName(business.default_sms_provider, sender.provider));
  const ownerNumber = resolveOwnerNotificationNumber(business)!;
  const { body, templateId } = renderOwnerNewLeadAlert({
    tenantName: business.name,
    customerName: lead.name,
    customerMobile: lead.mobile_number,
    serviceName: lead.service_name_snapshot ?? lead.service_intent,
    suburb: lead.suburb,
  });
  const { segments } = countSegments(body);

  let periodId: string | null = null;
  let creditsSpent = 0;
  if (business.plan_id !== FOUNDER_PLAN_ID && provider.name !== "simulated") {
    const { authorizeLiveSend } = await import("@/lib/commercial.server");
    const gate = await authorizeLiveSend(input.businessId, segments);
    if (!gate.allowed) return blocked(gate.reason);
    periodId = gate.periodId;
    creditsSpent = gate.creditsSpent;
  }
  const releaseSegments = async () => {
    if (periodId) {
      const { releaseReservedSegments } = await import("@/lib/commercial.server");
      await releaseReservedSegments(periodId, segments);
      periodId = null;
    }
    if (creditsSpent > 0) {
      const { refundPurchasedCredits } = await import("@/lib/subscription.server");
      await refundPurchasedCredits(input.businessId, creditsSpent);
      creditsSpent = 0;
    }
  };

  if (provider.name === "texto") {
    const { checkTextoCredits, checkTextoDailyCap } = await import("@/lib/sms/texto-accounts.server");
    const creditCheck = await checkTextoCredits(input.businessId, segments);
    if (!creditCheck.ok) {
      await releaseSegments();
      return blocked(creditCheck.reason);
    }
    const dailyCheck = await checkTextoDailyCap(input.businessId, true);
    if (!dailyCheck.ok) {
      await releaseSegments();
      return blocked(dailyCheck.reason);
    }
  }

  let messageId = existing?.id ?? null;
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
        attempt_count: (existing?.attempt_count ?? 0) + 1,
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
        message_source: "automation",
        delivery_event_count: 0,
      })
      .select("id")
      .single();
    if (reservation.error || !reservation.data) {
      await releaseSegments();
      if (isUniqueViolation(reservation.error)) {
        return { sent: false, duplicate: true, reason: "Owner SMS already sent for this alert." };
      }
      return blocked("Could not reserve the owner SMS, so nothing was sent.", true);
    }
    messageId = reservation.data.id;
  }

  try {
    const result = await provider.sendMessage({ to: ownerNumber, body, sender });
    const acceptedAt = new Date().toISOString();
    const acceptanceStatus = result.deliveryStatus === "queued" || result.deliveryStatus === "unknown"
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
    await recordSmsUsage({
      businessId: input.businessId,
      segmentsOut: segments,
      messagesOut: 1,
      providerCost: result.providerCost ?? 0,
    });
    if (creditsSpent > 0) {
      await recordMessageSpend(input.businessId, creditsSpent);
      creditsSpent = 0;
    } else {
      try {
        const { recordIncludedMessageCost } = await import("@/lib/provider-costs.server");
        await recordIncludedMessageCost({ businessId: input.businessId, messageId, segments });
      } catch (error) {
        console.error("[owner-new-lead] provider cost bookkeeping failed:", error);
      }
    }
    if (periodId) periodId = null;
    await audit({ ...input, outcome: "sent", reason: "Owner SMS accepted by the provider." });
    return { sent: true, reason: "Owner SMS accepted by the provider.", messageId };
  } catch (error) {
    const detail = provider.formatProviderError(error).slice(0, 200);
    if (classifyCarrierFailure(error) === "unknown_outcome") {
      await supabaseAdmin
        .from("messages")
        .update({ delivery_status: UNKNOWN_STATUS, error_code: detail })
        .eq("id", messageId);
      await audit({ ...input, outcome: "unknown", reason: detail });
      return { sent: false, retriable: false, reason: `Carrier outcome unknown; automatic resend held: ${detail}`, messageId };
    }
    await releaseSegments();
    await supabaseAdmin
      .from("messages")
      .update({ delivery_status: "failed", error_code: detail, failure_reason: detail, failed_at: new Date().toISOString() })
      .eq("id", messageId);
    await recordSmsUsage({ businessId: input.businessId, failures: 1 });
    await audit({ ...input, outcome: "failed", reason: detail });
    return { sent: false, retriable: true, reason: detail, messageId };
  }
}
