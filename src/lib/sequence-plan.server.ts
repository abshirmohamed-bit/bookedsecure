// Phase 3: dry-run sequence planner.
//
// Reads real tenant state through existing loaders and returns the planned
// action set. There is NO live-mode branch: `mode` is hard-coded to "dry_run",
// every action carries `wouldSend: false`, and this module performs no insert,
// update, delete, enqueue, provider call or SMS send of any kind.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAvailabilityConfig, loadServiceDurationMinutes } from "./availability.server";
import { evaluateQuietHoursGate } from "./sms/quiet-hours";
import type { BookingStatus, ConsentStatus, LeadContext } from "./lead-provenance";
import { selectSequence } from "./sequences";
import { planSequenceActions, type PlanFacts, type SequencePlan } from "./sequence-actions";

const LEAD_COLUMNS =
  "id, business_id, lead_context, consent_status, booking_status, verified_service_id, opted_out_at, sms_suppressed_at, requires_owner_review";

/**
 * Dry-run plan for one lead. Read-only.
 *
 * `signals` carries server-observed explicit intents (never model-inferred).
 */
export async function planLeadSequence(input: {
  businessId: string;
  leadId: string;
  now?: Date;
  signals?: {
    explicitBookingIntent?: boolean;
    requestedHuman?: boolean;
    requestedQuote?: boolean;
    unsupportedRequest?: boolean;
    conflictingContext?: boolean;
    toolFailure?: boolean;
    tenantTakeover?: boolean;
    hasInboundReply?: boolean;
  };
}): Promise<SequencePlan | null> {
  const now = input.now ?? new Date();
  const signals = input.signals ?? {};

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!lead) return null;

  const [{ data: business }, { data: conversation }, { data: rules }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id, timezone, quiet_hours_start, quiet_hours_end, automation_enabled")
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("conversations")
      .select("automation_paused")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .maybeSingle(),
    supabaseAdmin
      .from("automation_rules")
      .select("step")
      .eq("business_id", input.businessId)
      .eq("rule_type", "follow_up")
      .eq("active", true)
      .order("step", { ascending: true }),
  ]);

  const availability = await loadAvailabilityConfig(input.businessId);
  const durationMinutes = await loadServiceDurationMinutes(input.businessId, lead.verified_service_id);

  const quiet = evaluateQuietHoursGate(
    {
      timezone: availability.timezone,
      quietHoursStart: availability.quietHoursStart,
      quietHoursEnd: availability.quietHoursEnd,
    },
    now,
  );

  const consentStatus = (lead.consent_status ?? "unknown") as ConsentStatus;
  const bookingStatus = (lead.booking_status ?? "none") as BookingStatus;
  const leadContext = (lead.lead_context ?? "contact_only_unqualified") as LeadContext;

  const decision = selectSequence({
    leadContext,
    consentStatus,
    bookingStatus,
    explicitBookingIntent: signals.explicitBookingIntent,
    requestedHuman: signals.requestedHuman,
    requestedQuote: signals.requestedQuote,
    unsupportedRequest: signals.unsupportedRequest,
    conflictingContext: signals.conflictingContext || lead.requires_owner_review === true,
    toolFailure: signals.toolFailure,
    tenantTakeover: signals.tenantTakeover,
    automationPaused: conversation?.automation_paused === true,
    agentEnabled: business?.automation_enabled !== false,
    hasInboundReply: signals.hasInboundReply,
    hasBookingLink: availability.active,
  });

  const facts: PlanFacts = {
    businessId: input.businessId,
    leadId: lead.id,
    leadBusinessId: lead.business_id,
    leadContext,
    quietHoursNow: quiet.blocked,
    hasBookingLink: availability.active,
    bookableServiceValid: durationMinutes !== null,
    followUpRuleSteps: (rules ?? []).map((r) => Number(r.step)),
    consentGranted: consentStatus === "granted",
    tenantTakeover: signals.tenantTakeover === true,
    automationPaused: conversation?.automation_paused === true,
    agentEnabled: business?.automation_enabled !== false,
    toolFailure: signals.toolFailure === true,
    suppressed: Boolean(lead.sms_suppressed_at),
    optedOut: Boolean(lead.opted_out_at),
  };

  return planSequenceActions({ decision, facts });
}
