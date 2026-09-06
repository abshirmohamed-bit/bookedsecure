// Server orchestration for reactivation campaigns.
//
// Drafting is read-only apart from writing the draft rows: nothing is sent
// until the owner approves. Sending reuses the existing `sendSms` path, so
// opt-out, suppression, consent, quiet hours, caps and ledger accounting all
// apply unchanged.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkApproval,
  classifyReactivationCandidate,
  guardReactivationMessage,
  normaliseOffer,
  proposeOffer,
  renderReactivationMessage,
  renderReactivationReminder,
  shouldSendReactivationReminder,
  REACTIVATION_REMINDER_DELAY_DAYS,
  type ReactivationFacts,
} from "@/lib/reactivation";
import { tenantQuoteUrl } from "@/lib/tenant-nav";

/**
 * The tenant's own public quote-page link, built from that tenant's slug.
 * Universal: no tenant is special-cased, and a tenant without a usable slug
 * simply gets a message with no link instead of another tenant's page.
 */
export function tenantQuoteLink(slug: string | null | undefined): string | null {
  const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.lovable.app";
  return tenantQuoteUrl(origin, slug);
}

const LEAD_COLUMNS =
  "id, name, mobile_number, email, booking_status, verified_service_id, verified_vehicle, verified_suburb, verified_concern, vehicle_type, suburb, main_concerns, approved_service_id, opted_out_at, sms_suppressed_at, deleted_at, lead_origin, created_at";

export type ReactivationCandidate = {
  leadId: string;
  name: string | null;
  mobileNumber: string;
  email: string | null;
  createdAt: string | null;
};

type LeadRow = {
  id: string;
  name: string | null;
  mobile_number: string | null;
  email: string | null;
  booking_status: string | null;
  verified_service_id: string | null;
  verified_vehicle: string | null;
  verified_suburb: string | null;
  verified_concern: string | null;
  vehicle_type: string | null;
  suburb: string | null;
  main_concerns: string | null;
  approved_service_id: string | null;
  opted_out_at: string | null;
  sms_suppressed_at: string | null;
  deleted_at: string | null;
  created_at: string | null;
};

export function factsFromLead(
  lead: LeadRow,
  sets: { messageLeadIds: Set<string>; chatLeadIds: Set<string>; jobLeadIds: Set<string> },
): ReactivationFacts {
  return {
    hasMessages: sets.messageLeadIds.has(lead.id),
    hasQuoteChat: sets.chatLeadIds.has(lead.id),
    hasBooking: sets.jobLeadIds.has(lead.id) || (lead.booking_status ?? "none") !== "none",
    hasVerifiedContext: Boolean(
      lead.verified_service_id ||
        lead.verified_vehicle ||
        lead.verified_suburb ||
        lead.verified_concern ||
        lead.approved_service_id ||
        lead.vehicle_type ||
        lead.suburb ||
        lead.main_concerns,
    ),
    optedOut: Boolean(lead.opted_out_at),
    suppressed: Boolean(lead.sms_suppressed_at),
    deleted: Boolean(lead.deleted_at),
    hasMobileNumber: Boolean((lead.mobile_number ?? "").trim()),
  };
}

/** Read-only: the dormant leads that qualify for reactivation right now. */
export async function loadReactivationCandidates(
  businessId: string,
  limit = 200,
): Promise<{ candidates: ReactivationCandidate[]; excluded: number }> {
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = (leads ?? []) as unknown as LeadRow[];
  if (rows.length === 0) return { candidates: [], excluded: 0 };
  const ids = rows.map((row) => row.id);

  const [{ data: messages }, { data: chats }, { data: jobs }] = await Promise.all([
    supabaseAdmin.from("messages").select("lead_id").eq("business_id", businessId).in("lead_id", ids),
    supabaseAdmin
      .from("web_conversations")
      .select("lead_id")
      .eq("business_id", businessId)
      .in("lead_id", ids),
    supabaseAdmin.from("jobs").select("lead_id").eq("business_id", businessId).in("lead_id", ids),
  ]);

  const sets = {
    messageLeadIds: new Set((messages ?? []).map((m) => m.lead_id as string)),
    chatLeadIds: new Set((chats ?? []).map((c) => c.lead_id as string).filter(Boolean)),
    jobLeadIds: new Set((jobs ?? []).map((j) => j.lead_id as string)),
  };

  const candidates: ReactivationCandidate[] = [];
  let excluded = 0;
  for (const row of rows) {
    const decision = classifyReactivationCandidate(factsFromLead(row, sets));
    if (decision.eligible) {
      candidates.push({
        leadId: row.id,
        name: row.name,
        mobileNumber: row.mobile_number ?? "",
        email: row.email,
        createdAt: row.created_at,
      });
    } else {
      excluded += 1;
    }
  }
  return { candidates, excluded };
}

/**
 * Asks the model for generic offer wording. A dormant contact has no known
 * service history, so the offer must never name a service: any proposal that
 * mentions one of the tenant's service names is rejected in favour of the
 * deterministic generic offer. Any failure also falls back to it.
 */
export async function proposeOfferWithAi(input: {
  businessId: string;
  businessName: string;
  serviceNames?: string[];
}): Promise<{ offer: string; source: "ai_proposed" | "owner_edited"; notes: string | null }> {
  const fallback = proposeOffer();
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return { offer: fallback, source: "ai_proposed", notes: null };

  try {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    const { generateText } = await import("ai");
    const { ANALYSIS_MODEL } = await import("@/lib/ai.server");
    const { checkAiCap, recordAiUsage } = await import("@/lib/usage.server");
    const cap = await checkAiCap(input.businessId);
    if (cap.blocked) return { offer: fallback, source: "ai_proposed", notes: null };

    const gateway = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    });

    const result = await generateText({
      model: gateway(ANALYSIS_MODEL),
      system: [
        "You propose one short reactivation offer line for an Australian mobile detailing business.",
        "Output the offer only: no greeting, no sign-off, no quotes, under 12 words.",
        "It must be a percentage discount on a generic next enquiry or next service.",
        "Never name a specific service: the customer's service history is unknown.",
        "Never state a dollar amount, fee, deposit, date, time or availability.",
      ].join("\n"),
      prompt: [`Business: ${input.businessName}`, `Example shape: ${fallback}`].join("\n"),
    });

    await recordAiUsage({
      businessId: input.businessId,
      purpose: "reactivation_offer",
      model: ANALYSIS_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    });

    const proposed = normaliseOffer((result.text ?? "").replace(/^["'\s]+|["'\s.]+$/g, ""));
    const namesService = (input.serviceNames ?? []).some((name) => {
      const trimmed = name.trim().toLowerCase();
      return trimmed.length > 2 && proposed.toLowerCase().includes(trimmed);
    });
    const usable =
      proposed.length > 4 && /\d+\s?%/.test(proposed) && !namesService ? proposed : fallback;
    return { offer: usable, source: "ai_proposed", notes: null };
  } catch {
    return { offer: fallback, source: "ai_proposed", notes: null };
  }
}


export type ReactivationCampaignView = {
  campaign: {
    id: string;
    status: string;
    offerText: string;
    offerSource: string;
    createdAt: string;
    approvedAt: string | null;
  } | null;
  drafts: Array<{
    id: string;
    leadId: string;
    leadName: string | null;
    mobileNumber: string;
    body: string;
    status: string;
    edited: boolean;
    sendReason: string | null;
  }>;
  excluded: number;
};

async function viewOf(businessId: string, campaignId: string, excluded = 0): Promise<ReactivationCampaignView> {
  const { data: campaign } = await supabaseAdmin
    .from("reactivation_campaigns")
    .select("id, status, offer_text, offer_source, created_at, approved_at")
    .eq("id", campaignId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!campaign) return { campaign: null, drafts: [], excluded };

  const { data: drafts } = await supabaseAdmin
    .from("reactivation_drafts")
    .select("id, lead_id, body, status, edited, send_reason, leads(name, mobile_number)")
    .eq("campaign_id", campaignId)
    .eq("business_id", businessId)
    .order("created_at", { ascending: true });

  return {
    campaign: {
      id: campaign.id,
      status: campaign.status,
      offerText: campaign.offer_text,
      offerSource: campaign.offer_source,
      createdAt: campaign.created_at,
      approvedAt: campaign.approved_at,
    },
    drafts: (drafts ?? []).map((row) => {
      const lead = (row as { leads?: { name?: string | null; mobile_number?: string | null } | null }).leads;
      return {
        id: row.id as string,
        leadId: row.lead_id as string,
        leadName: lead?.name ?? null,
        mobileNumber: lead?.mobile_number ?? "",
        body: row.body as string,
        status: row.status as string,
        edited: Boolean(row.edited),
        sendReason: (row.send_reason as string | null) ?? null,
      };
    }),
    excluded,
  };
}

/** The tenant's current open draft campaign, if any. */
export async function loadOpenCampaign(businessId: string): Promise<ReactivationCampaignView> {
  const { data: campaign } = await supabaseAdmin
    .from("reactivation_campaigns")
    .select("id")
    .eq("business_id", businessId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!campaign) return { campaign: null, drafts: [], excluded: 0 };
  return viewOf(businessId, campaign.id);
}

/**
 * Builds one draft campaign covering every eligible dormant lead. Writes only
 * draft rows — no messages, no jobs, no lead mutation, no provider calls.
 */
export async function draftReactivationCampaign(input: {
  businessId: string;
  userId: string;
  offerText?: string | null;
  maxLeads?: number;
}): Promise<ReactivationCampaignView & { candidates: number }> {
  const [{ data: business }, { data: services }] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("name, slug, sms_signature")
      .eq("id", input.businessId)
      .single(),
    supabaseAdmin
      .from("services")
      .select("name")
      .eq("business_id", input.businessId)
      .eq("active", true),
  ]);

  const businessName = business?.name ?? "our team";
  const serviceNames = (services ?? []).map((s) => s.name as string).filter(Boolean);
  const quoteUrl = tenantQuoteLink((business as { slug?: string | null } | null)?.slug ?? null);

  const { candidates, excluded } = await loadReactivationCandidates(input.businessId);
  const scoped = candidates.slice(0, input.maxLeads ?? 200);

  const offer =
    typeof input.offerText === "string" && input.offerText.trim().length > 0
      ? { offer: normaliseOffer(input.offerText), source: "owner_edited" as const, notes: null }
      : await proposeOfferWithAi({ businessId: input.businessId, businessName, serviceNames });

  // Re-use the tenant's existing open draft so repeated runs never pile up.
  const existing = await loadOpenCampaign(input.businessId);
  let campaignId = existing.campaign?.id ?? null;
  if (campaignId) {
    await supabaseAdmin
      .from("reactivation_campaigns")
      .update({ offer_text: offer.offer, offer_source: offer.source })
      .eq("id", campaignId)
      .eq("business_id", input.businessId);
  } else {
    const { data: created, error } = await supabaseAdmin
      .from("reactivation_campaigns")
      .insert({
        business_id: input.businessId,
        offer_text: offer.offer,
        offer_source: offer.source,
        created_by: input.userId,
      })
      .select("id")
      .single();
    if (error || !created) throw new Error(error?.message ?? "Could not create the campaign.");
    campaignId = created.id;
  }

  const { data: existingDrafts } = await supabaseAdmin
    .from("reactivation_drafts")
    .select("id, lead_id, edited")
    .eq("campaign_id", campaignId);
  const byLead = new Map(
    (existingDrafts ?? []).map((row) => [row.lead_id as string, row as { id: string; edited: boolean }]),
  );

  for (const candidate of scoped) {
    const rendered = renderReactivationMessage({
      businessName,
      leadName: candidate.name,
      offerText: offer.offer,
      quoteUrl,
      signature: business?.sms_signature ?? null,
    });
    const guarded = guardReactivationMessage(rendered, offer.offer);
    const body = guarded.text;
    const current = byLead.get(candidate.leadId);
    if (current) {
      // An owner edit is never overwritten by a re-run.
      if (!current.edited) {
        await supabaseAdmin.from("reactivation_drafts").update({ body }).eq("id", current.id);
      }
      continue;
    }
    await supabaseAdmin.from("reactivation_drafts").insert({
      campaign_id: campaignId,
      business_id: input.businessId,
      lead_id: candidate.leadId,
      body,
    });
  }

  const view = await viewOf(input.businessId, campaignId, excluded);
  return { ...view, candidates: scoped.length };
}

export async function updateReactivationDraft(input: {
  businessId: string;
  draftId: string;
  body?: string;
  status?: "draft" | "skipped";
}): Promise<{ ok: true }> {
  const patch: { body?: string; edited?: boolean; status?: "draft" | "skipped" } = {};
  if (typeof input.body === "string") {
    const { data: draft } = await supabaseAdmin
      .from("reactivation_drafts")
      .select("campaign_id")
      .eq("id", input.draftId)
      .eq("business_id", input.businessId)
      .maybeSingle();
    if (!draft) throw new Error("Draft not found.");
    const { data: campaign } = await supabaseAdmin
      .from("reactivation_campaigns")
      .select("offer_text")
      .eq("id", draft.campaign_id)
      .maybeSingle();
    const guarded = guardReactivationMessage(input.body, campaign?.offer_text ?? "");
    if (guarded.text.trim().length < 2) throw new Error("That message could not be used as written.");
    patch.body = guarded.text;
    patch.edited = true;
  }
  if (input.status) patch.status = input.status;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabaseAdmin
    .from("reactivation_drafts")
    .update(patch)
    .eq("id", input.draftId)
    .eq("business_id", input.businessId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function cancelReactivationCampaign(input: {
  businessId: string;
  campaignId: string;
}): Promise<{ ok: true }> {
  await supabaseAdmin
    .from("reactivation_campaigns")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .eq("status", "draft");
  return { ok: true };
}

/**
 * Owner approval → send. Every send goes through `sendSms`, keyed on the draft
 * id so a repeat approval never sends twice.
 */
export async function approveReactivationCampaign(input: {
  businessId: string;
  userId: string;
  campaignId: string;
  attested: boolean;
  draftIds?: string[] | null;
}): Promise<{ sent: number; failed: number; skipped: number; results: Array<{ draftId: string; sent: boolean; reason?: string }> }> {
  const { data: campaign } = await supabaseAdmin
    .from("reactivation_campaigns")
    .select("id, status, offer_text")
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found.");

  let query = supabaseAdmin
    .from("reactivation_drafts")
    .select("id, lead_id, body, status")
    .eq("campaign_id", input.campaignId)
    .eq("business_id", input.businessId)
    .eq("status", "draft");
  if (input.draftIds?.length) query = query.in("id", input.draftIds);
  const { data: drafts } = await query;
  const pending = drafts ?? [];

  const gate = checkApproval({
    attested: input.attested,
    campaignStatus: campaign.status,
    approvedDraftCount: pending.length,
  });
  if (!gate.ok) throw new Error(gate.reason);

  const { sendSms } = await import("@/lib/lead-engine.server");
  const results: Array<{ draftId: string; sent: boolean; reason?: string }> = [];
  let sent = 0;
  let failed = 0;

  for (const draft of pending) {
    const guarded = guardReactivationMessage(draft.body as string, campaign.offer_text);
    if (guarded.text.trim().length < 2) {
      failed += 1;
      await supabaseAdmin
        .from("reactivation_drafts")
        .update({ status: "failed", send_reason: "Message content could not be sent as written." })
        .eq("id", draft.id);
      results.push({ draftId: draft.id as string, sent: false, reason: "Message content rejected." });
      continue;
    }
    const result = await sendSms({
      businessId: input.businessId,
      leadId: draft.lead_id as string,
      body: guarded.text,
      kind: "approved_reply",
      idempotencyKey: `reactivation:${draft.id}`,
      respectAutomation: false,
      userId: input.userId,
      source: "manual",
    });
    if (result.sent) {
      sent += 1;
      await supabaseAdmin
        .from("reactivation_drafts")
        .update({ status: "sent", sent_at: new Date().toISOString(), send_reason: null })
        .eq("id", draft.id);
      results.push({ draftId: draft.id as string, sent: true });
    } else {
      failed += 1;
      await supabaseAdmin
        .from("reactivation_drafts")
        .update({ status: "failed", send_reason: result.reason ?? "Not sent." })
        .eq("id", draft.id);
      results.push({ draftId: draft.id as string, sent: false, reason: result.reason ?? "Not sent." });
    }
  }

  const { count: remaining } = await supabaseAdmin
    .from("reactivation_drafts")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", input.campaignId)
    .eq("status", "draft");

  if (!remaining) {
    await supabaseAdmin
      .from("reactivation_campaigns")
      .update({
        status: "approved",
        approved_by: input.userId,
        approved_at: new Date().toISOString(),
        attested_at: new Date().toISOString(),
      })
      .eq("id", input.campaignId)
      .eq("business_id", input.businessId);
  }

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: "reactivation_campaign_approved",
    entity_type: "reactivation_campaign",
    entity_id: input.campaignId,
    metadata: { sent, failed, attested: true } as never,
  });

  return { sent, failed, skipped: 0, results };
}

/**
 * The one automatic win-back reminder, three days after the approved first
 * message. Universal for every tenant: eligibility, wording and the tenant's
 * own quote link all come from that tenant's own data.
 *
 * Anything that counts as engagement cancels it, and every send still goes
 * through `sendSms`, so opt-out, suppression, quiet hours and caps apply.
 */
export async function processDueReactivationReminders(now: Date = new Date()): Promise<{
  sent: number;
  skipped: Array<{ leadId: string; reason: string }>;
}> {
  const cutoff = new Date(
    now.getTime() - REACTIVATION_REMINDER_DELAY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data: candidates } = await supabaseAdmin
    .from("reactivation_drafts")
    .select("id, business_id, lead_id, sent_at, campaign_id")
    .eq("status", "sent")
    .not("sent_at", "is", null)
    .lte("sent_at", cutoff)
    .order("sent_at", { ascending: true })
    .limit(200);

  const skipped: Array<{ leadId: string; reason: string }> = [];
  let sent = 0;

  for (const draft of candidates ?? []) {
    const businessId = draft.business_id as string;
    const leadId = draft.lead_id as string;
    const sentAt = draft.sent_at ? new Date(draft.sent_at as string) : null;
    const reminderKey = `reactivation-reminder:${draft.id}`;

    const [{ data: reminder }, { data: lead }, { data: inbound }, { data: chat }, { data: campaign }] =
      await Promise.all([
        supabaseAdmin
          .from("messages")
          .select("id")
          .eq("business_id", businessId)
          .eq("idempotency_key", reminderKey)
          .maybeSingle(),
        supabaseAdmin
          .from("leads")
          .select("id, name, booking_status, opted_out_at, sms_suppressed_at, deleted_at")
          .eq("id", leadId)
          .eq("business_id", businessId)
          .maybeSingle(),
        supabaseAdmin
          .from("messages")
          .select("id")
          .eq("business_id", businessId)
          .eq("lead_id", leadId)
          .eq("direction", "inbound")
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("web_conversations")
          .select("id")
          .eq("business_id", businessId)
          .eq("lead_id", leadId)
          .limit(1)
          .maybeSingle(),
        supabaseAdmin
          .from("reactivation_campaigns")
          .select("offer_text, status")
          .eq("id", draft.campaign_id as string)
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);

    if (!lead || !campaign) {
      skipped.push({ leadId, reason: "Campaign or lead no longer available." });
      continue;
    }

    const decision = shouldSendReactivationReminder({
      sentAt,
      now,
      reminderAlreadySent: Boolean(reminder?.id),
      hasInboundReply: Boolean(inbound?.id),
      hasQuoteChat: Boolean(chat?.id),
      hasBooking: (lead.booking_status ?? "none") !== "none",
      optedOut: Boolean(lead.opted_out_at),
      suppressed: Boolean(lead.sms_suppressed_at),
      deleted: Boolean(lead.deleted_at),
    });
    if (!decision.send) {
      skipped.push({ leadId, reason: decision.reason });
      continue;
    }

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name, slug, sms_signature")
      .eq("id", businessId)
      .maybeSingle();
    if (!business) {
      skipped.push({ leadId, reason: "Business not found." });
      continue;
    }

    const body = guardReactivationMessage(
      renderReactivationReminder({
        businessName: business.name,
        leadName: lead.name,
        offerText: campaign.offer_text as string,
        quoteUrl: tenantQuoteLink(business.slug),
        signature: business.sms_signature,
      }),
      campaign.offer_text as string,
    );
    if (body.text.trim().length < 2) {
      skipped.push({ leadId, reason: "Reminder content could not be sent as written." });
      continue;
    }

    const { sendSms } = await import("@/lib/lead-engine.server");
    const result = await sendSms({
      businessId,
      leadId,
      body: body.text,
      kind: "approved_reply",
      idempotencyKey: reminderKey,
      respectAutomation: true,
      source: "automation",
    });
    if (result.sent) sent += 1;
    else skipped.push({ leadId, reason: result.reason ?? "Not sent." });
  }

  return { sent, skipped };
}
