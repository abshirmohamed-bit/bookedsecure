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
  buildOutboundDecision,
  classifyMessagePath,
  evaluateNewLeadResponseExemption,
  type NewLeadResponseFacts,
  type OutboundDecision,
} from "./message-path";
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
  /** Template identity for the planned message, used by the quiet-hours policy. */
  templateId?: string | null;
  templateVersion?: number;
  /** True when this message answers the enquiry the customer just submitted. */
  directResponseToCurrentEnquiry?: boolean;
  /** Idempotency key and source attribution for the planned send. */
  idempotencyKey?: string | null;
  sourceAttribution?: string | null;
  now?: Date;
};

const LEAD_COLUMNS =
  "id, business_id, consent_status, opted_out_at, sms_suppressed_at, reachability_state, requires_owner_review, booking_status, deleted_at, lead_context, lead_origin, source_channel";

/** Outbound messages authored by a human rather than by automation. */
const MANUAL_MESSAGE_KINDS = new Set(["manual"]);
const MANUAL_MESSAGE_SOURCES = new Set(["manual", "owner", "owner_manual"]);

function isManualOutbound(row: {
  direction?: string | null;
  message_kind?: string | null;
  message_source?: string | null;
}): boolean {
  if (row.direction !== "outbound") return false;
  return (
    MANUAL_MESSAGE_KINDS.has(row.message_kind ?? "") ||
    MANUAL_MESSAGE_SOURCES.has(row.message_source ?? "")
  );
}


export type AuthorisationResult = GateResult & { decision: OutboundDecision };

export async function authoriseAgentAction(input: AuthorisationInput): Promise<AuthorisationResult> {
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const dayStart = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const [leadRes, businessRes, campaignRes, configRes, conversationRes, historyRes] =
    await Promise.all([

    supabaseAdmin.from("leads").select(LEAD_COLUMNS).eq("id", input.leadId).maybeSingle(),
    supabaseAdmin
      .from("businesses")
      .select(
        "id, agent_enabled, agent_execution_opted_in_at, agent_kill_switch_at, agent_daily_send_cap, agent_hourly_send_cap, agent_max_leads_per_activation, quote_form_active, timezone",
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
      .neq("recipient_role", "owner")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);


  const lead = leadRes.data;
  const business = businessRes.data;
  const campaign = campaignRes.data;

  // Missing tenant, lead or campaign can never authorise live execution.
  if (!lead || !business || !campaign) {
    const missingQuiet = { timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 };
    const missingFacts = newLeadFacts(input, null, null, null);
    return {
      mode: "dry_run",
      allowed: false,
      failures: [
        {
          gate: !campaign ? "campaign_approved" : !lead ? "lead_eligibility" : "agent_enabled",
          detail: "required record not found",
        },
      ],
      decision: buildOutboundDecision({
        facts: missingFacts,
        quietHours: missingQuiet,
        at: now,
        otherGatesPassed: false,
      }),
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
      .neq("recipient_role", "owner")
      .gte("created_at", dayStart),
    supabaseAdmin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("business_id", input.businessId)
      .eq("direction", "outbound")
      .neq("recipient_role", "owner")
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

  // Human-handling signals, newest first.
  const history = (historyRes.data ?? []) as {
    direction: string | null;
    message_kind: string | null;
    message_source: string | null;
    created_at: string | null;
  }[];
  const latestOutbound = history.find((m) => m.direction === "outbound") ?? null;
  const lastManualOutboundAt = history.find(isManualOutbound)?.created_at ?? null;
  const lastInboundReplyAt = history.find((m) => m.direction === "inbound")?.created_at ?? null;



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
    leadDeleted: Boolean((lead as { deleted_at?: string | null }).deleted_at),
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

    conversationStatus: conversationRes.data?.status ?? null,
    lastManualOutboundAt,
    latestOutboundIsManual: latestOutbound ? isManualOutbound(latestOutbound) : false,
    lastInboundReplyAt,
    ownerReviewFlag:
      lead.requires_owner_review === true || (lead.lead_context ?? null) === "owner_review",
    humanTakeoverActive: conversationRes.data?.status === "owner_handling",
    nowIso: now.toISOString(),
  };


  // Quiet-hours policy path. Everything defaults to `sequence_follow_up`, which
  // always enforces the tenant's quiet-hours window.
  const newLead = newLeadFacts(input, lead, business, conversationRes.data);
  const messagePath = classifyMessagePath(newLead);
  const exemption = evaluateNewLeadResponseExemption(newLead);

  const gateFailures = evaluateActivationGates({
    ...facts,
    messagePath,
    quietHoursExemptionGranted: messagePath === "new_lead_response" && exemption.granted,
  });

  const decision = buildOutboundDecision({
    facts: newLead,
    quietHours: {
      timezone: availability.timezone,
      quiet_hours_start: availability.quietHoursStart,
      quiet_hours_end: availability.quietHoursEnd,
    },
    at: now,
    otherGatesPassed: gateFailures.every((failure) => failure.gate === "quiet_hours"),
  });

  return {
    ...resolveExecutionMode({
      requestedMode: input.requestedMode,
      serverVerifiedGateFailures: gateFailures,
    }),
    decision,
  };
}

/** Server-verified new-lead-response facts. Nothing here comes from the client. */
function newLeadFacts(
  input: AuthorisationInput,
  lead: {
    id?: string;
    consent_status?: string | null;
    opted_out_at?: string | null;
    sms_suppressed_at?: string | null;
    requires_owner_review?: boolean | null;
    booking_status?: string | null;
    lead_origin?: string | null;
    source_channel?: string | null;
  } | null,
  business: {
    quote_form_active?: boolean | null;
    agent_kill_switch_at?: string | null;
  } | null,
  conversation: { status?: string | null; automation_paused?: boolean | null } | null,
): NewLeadResponseFacts {
  const consentGranted = (lead?.consent_status ?? "unknown") === "granted";
  const customerInitiated =
    lead?.lead_origin === "ai_web_chat" ||
    lead?.source_channel === "website" ||
    lead?.source_channel === "hosted_page";
  return {
    customerInitiated,
    quoteFlowActive: business?.quote_form_active === true,
    directResponseToCurrentEnquiry: input.directResponseToCurrentEnquiry === true,
    consentGranted,
    consentLeadId: consentGranted ? (lead?.id ?? null) : null,
    leadId: input.leadId,
    optedOut: Boolean(lead?.opted_out_at),
    suppressed: Boolean(lead?.sms_suppressed_at),
    requiresOwnerReview: lead?.requires_owner_review === true,
    humanTakeoverActive: conversation?.status === "owner_handling",
    automationPaused: conversation?.automation_paused === true,
    templateId: input.templateId ?? null,
    templateVersion: input.templateVersion ?? 0,
    promotional: false,
    serviceRelated: true,
    alreadyBooked: (lead?.booking_status ?? "none") === "scheduled",
    tenantKillSwitchAt: business?.agent_kill_switch_at ?? null,
    globalKillSwitchAt: null,
    idempotencyKey: input.idempotencyKey ?? null,
    sourceAttribution: input.sourceAttribution ?? null,
    sequenceId: null,
  };
}
