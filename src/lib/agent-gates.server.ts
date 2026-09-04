// Phase 4 (step 1): server-side gate fact loading.
//
// Reads live tenant, campaign and lead state and evaluates the pure gates. This
// module is read-only: it sends nothing, writes nothing and calls no provider.
// It is the ONLY place allowed to conclude that live execution is permitted,
// and it never consults a client-supplied mode.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadAvailabilityConfig } from "./availability.server";
import { evaluateQuietHoursGate } from "./sms/quiet-hours";
import type { ActionKind } from "./sequence-actions";
import {
  evaluateActivationGates,
  resolveExecutionMode,
  type GateFacts,
  type GateResult,
} from "./agent-gates";

export type AuthorisationInput = {
  businessId: string;
  leadId: string;
  campaignId: string;
  actionKind: ActionKind;
  plannedSequenceId: string;
  plannedTemplateVersion: number;
  planStillCurrent: boolean;
  /** Client-supplied and deliberately advisory only. */
  requestedMode?: string | undefined;
  now?: Date;
};

const LEAD_COLUMNS =
  "id, business_id, consent_status, opted_out_at, sms_suppressed_at, reachability_state, requires_owner_review, booking_status";

export async function authoriseAgentAction(input: AuthorisationInput): Promise<GateResult> {
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [leadRes, businessRes, campaignRes, configRes, conversationRes] = await Promise.all([
    supabaseAdmin.from("leads").select(LEAD_COLUMNS).eq("id", input.leadId).maybeSingle(),
    supabaseAdmin
      .from("businesses")
      .select(
        "id, agent_enabled, agent_execution_opted_in_at, agent_kill_switch_at, agent_daily_send_cap, agent_hourly_send_cap, agent_max_leads_per_activation",
      )
      .eq("id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("sequence_campaigns")
      .select(
        "id, business_id, sequence_id, status, disabled_at, campaign_approved_at, sequence_approved_at, template_version, scope_lead_ids, max_leads, execution_authorised_at, execution_authorisation_kind",
      )
      .eq("id", input.campaignId)
      .maybeSingle(),
    supabaseAdmin
      .from("commercial_config")
      .select("agent_global_kill_switch_at")
      .eq("singleton", true)
      .maybeSingle(),
    supabaseAdmin
      .from("conversations")
      .select("automation_paused, status")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .maybeSingle(),
    supabaseAdmin
      .from("messages")
      .select("id, direction, message_kind, message_source, created_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);


  const lead = leadRes.data;
  const business = businessRes.data;
  const campaign = campaignRes.data;

  // Missing tenant, lead or campaign can never authorise live execution.
  if (!lead || !business || !campaign) {
    return {
      mode: "dry_run",
      allowed: false,
      failures: [
        {
          gate: !campaign ? "campaign_approved" : !lead ? "lead_eligibility" : "agent_enabled",
          detail: "required record not found",
        },
      ],
    };
  }

  const availability = await loadAvailabilityConfig(input.businessId);
  const quiet = evaluateQuietHoursGate(
    {
      timezone: availability.timezone,
      quiet_hours_start: availability.quietHoursStart,
      quiet_hours_end: availability.quietHoursEnd,
    },
    now,
  );

  const [sentTodayRes, sentHourRes, conflictRes] = await Promise.all([
    supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("direction", "outbound")
      .gte("created_at", dayStart),
    supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("direction", "outbound")
      .gte("created_at", hourAgo),
    supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .eq("completion_status", "scheduled"),
  ]);

  const consentStatus = lead.consent_status ?? "unknown";
  const scopeLeadIds = (campaign.scope_lead_ids ?? []) as string[];

  const facts: GateFacts = {
    actionKind: input.actionKind,
    businessId: input.businessId,
    leadBusinessId: lead.business_id,
    campaignBusinessId: campaign.business_id,

    tenantOptedInAt: business.agent_execution_opted_in_at ?? null,
    agentEnabled: business.agent_enabled === true,
    tenantKillSwitchAt: business.agent_kill_switch_at ?? null,
    globalKillSwitchAt: configRes.data?.agent_global_kill_switch_at ?? null,

    campaignStatus: campaign.status,
    campaignDisabledAt: campaign.disabled_at ?? null,
    campaignApprovedAt: campaign.campaign_approved_at ?? null,
    sequenceApprovedAt: campaign.sequence_approved_at ?? null,
    campaignSequenceId: campaign.sequence_id,
    plannedSequenceId: input.plannedSequenceId,
    approvedTemplateVersion: campaign.template_version,
    plannedTemplateVersion: input.plannedTemplateVersion,
    scopeLeadIds,
    leadId: input.leadId,
    executionAuthorisedAt: campaign.execution_authorised_at ?? null,
    executionAuthorisationKind:
      (campaign.execution_authorisation_kind as "canary" | "bounded_batch" | null) ?? null,

    requiresOwnerReview: lead.requires_owner_review === true,
    consentGranted: consentStatus === "granted",
    consentCaptureAction: input.actionKind === "capture_consent",
    consentDeclined: consentStatus === "declined",
    optedOut: Boolean(lead.opted_out_at),
    suppressed: Boolean(lead.sms_suppressed_at),
    reachable: lead.reachability_state !== "unreachable",
    tenantTakeover: conversationRes.data?.status === "owner_handling",
    automationPaused: conversationRes.data?.automation_paused === true,
    hasConflictingBooking: (conflictRes.count ?? 0) > 0 && input.actionKind === "offer_booking",
    quietHoursNow: quiet.blocked,

    sentToday: sentTodayRes.count ?? 0,
    dailySendCap: business.agent_daily_send_cap ?? 0,
    sentThisHour: sentHourRes.count ?? 0,
    hourlySendCap: business.agent_hourly_send_cap ?? 0,
    leadsInActivation: scopeLeadIds.length,
    maxLeadsPerActivation: business.agent_max_leads_per_activation ?? 0,

    planStillCurrent: input.planStillCurrent,
  };

  return resolveExecutionMode({
    requestedMode: input.requestedMode,
    serverVerifiedGateFailures: evaluateActivationGates(facts),
  });
}
