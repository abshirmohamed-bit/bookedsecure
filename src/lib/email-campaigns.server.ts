/**
 * Server orchestration for email campaigns.
 *
 * Drafts are created first; nothing is sent until the owner approves. Sends
 * go through the Resend connector gateway, one email per recipient, and every
 * outcome is recorded on the recipient row. Unsubscribed addresses are
 * skipped both when the draft is built and again at send time.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { replyToHeader } from "@/lib/email-inbound";
import {
  bookedRecipients,
  buildEmailHtml,
  buildEmailText,
  CAMPAIGN_AUDIENCES,
  followUpDue,
  followUpSkipReason,
  campaignSender,
  isDeliverableFromAddress,
  NEVER_EMAIL_STATUSES,
  normaliseFromAddress,
  parseCampaignDraft,
  scheduleTimeProblem,
  splitRecipients,
  type CampaignAudienceId,
} from "@/lib/email-campaigns";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

function appOrigin(): string {
  return process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
}

export function unsubscribeUrl(businessId: string, email: string): string {
  const params = new URLSearchParams({ b: businessId, e: email });
  return `${appOrigin()}/api/public/email-unsubscribe?${params.toString()}`;
}

async function sendEmailViaResend(input: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<{ id: string | null }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  if (!lovableKey) throw new Error("LOVABLE_API_KEY is not configured");
  const resendKey = process.env["RESEND_API_KEY"];
  if (!resendKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: input.from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`[email-campaigns] Resend send failed [${response.status}]: ${body}`);
    throw new Error(`Email provider rejected the send (${response.status}).`);
  }
  const parsed = (await response.json().catch(() => null)) as { id?: string } | null;
  return { id: parsed?.id ?? null };
}

type Branding = { businessName: string; branding: { logoUrl: string | null; websiteUrl: string | null; serviceArea: string | null; abn: string | null } };

/** Name, logo and footer details for the email template. */
async function loadBranding(businessId: string): Promise<Branding> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("name, logo_storage_path, logo_url, website_url, service_area, abn")
    .eq("id", businessId)
    .maybeSingle();
  const logoUrl = data?.logo_storage_path
    ? `${appOrigin()}/api/public/tenant-logo/${businessId}`
    : typeof data?.logo_url === "string" && /^https:\/\//.test(data.logo_url)
      ? data.logo_url
      : null;
  return {
    businessName: (data?.name as string | null) ?? "your business",
    branding: {
      logoUrl,
      websiteUrl: (data?.website_url as string | null) ?? null,
      serviceArea: (data?.service_area as string | null) ?? null,
      abn: (data?.abn as string | null) ?? null,
    },
  };
}

/**
 * Where a customer's reply goes. Once inbound replies are set up (the Resend
 * webhook secret exists), each recipient gets their own reply+<id> address so
 * replies appear in Campaigns → Replies (with a copy to the owner); until then
 * replies go straight to the owner.
 */
function replyToFor(recipientId: string, ownerReplyTo: string | null, businessName: string): string | null {
  return process.env["RESEND_WEBHOOK_SECRET"] ? replyToHeader(recipientId, businessName) : ownerReplyTo;
}

/** The campaign creator's login email: where customer replies go by default. */
async function creatorEmail(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

async function loadUnsubscribed(businessId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("email_unsubscribes")
    .select("email")
    .eq("business_id", businessId);
  return new Set((data ?? []).map((row) => (row.email as string).toLowerCase()));
}

/**
 * Follow-up and scheduling columns arrive with migration 0030. Until it is
 * applied, campaigns keep working with the original columns (no follow-ups
 * or scheduling) instead of failing to load.
 */
let sequenceColumns: boolean | null = null;
export async function hasSequenceColumns(): Promise<boolean> {
  if (sequenceColumns !== null) return sequenceColumns;
  const { error } = await supabaseAdmin.from("email_campaigns").select("follow_up_delay_days").limit(1);
  if (!error) sequenceColumns = true;
  else if (error.code === "42703" || /follow_up_delay_days/.test(error.message)) sequenceColumns = false;
  else return true;
  return sequenceColumns;
}
const LEGACY_CAMPAIGN_COLUMNS = "id, name, subject, body_text, from_address, status, created_at, sent_at";
const LEGACY_RECIPIENT_COLUMNS = "id, campaign_id, lead_id, email, status, error, sent_at";
const campaignColumns = async () => ((await hasSequenceColumns()) ? CAMPAIGN_COLUMNS : LEGACY_CAMPAIGN_COLUMNS);
const recipientColumns = async () => ((await hasSequenceColumns()) ? RECIPIENT_COLUMNS : LEGACY_RECIPIENT_COLUMNS);
function fillCampaign(row: Partial<CampaignRow> & { id: string }): CampaignRow {
  return {
    scheduled_at: null,
    follow_up_subject: null,
    follow_up_body: null,
    follow_up_delay_days: null,
    stop_on_booking: true,
    audience_label: null,
    ...row,
  } as CampaignRow;
}
function fillRecipient(row: Partial<RecipientRow>): RecipientRow {
  return { follow_up_status: null, follow_up_sent_at: null, follow_up_error: null, ...row } as RecipientRow;
}

const CAMPAIGN_COLUMNS =
  "id, name, subject, body_text, from_address, status, created_at, sent_at, scheduled_at, follow_up_subject, follow_up_body, follow_up_delay_days, stop_on_booking, audience_label";
const RECIPIENT_COLUMNS =
  "id, campaign_id, lead_id, email, status, error, sent_at, follow_up_status, follow_up_sent_at, follow_up_error";

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  body_text: string;
  from_address: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  scheduled_at: string | null;
  follow_up_subject: string | null;
  follow_up_body: string | null;
  follow_up_delay_days: number | null;
  stop_on_booking: boolean;
  audience_label: string | null;
};
type RecipientRow = {
  id: string;
  campaign_id: string;
  lead_id: string | null;
  email: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  follow_up_status: string | null;
  follow_up_sent_at: string | null;
  follow_up_error: string | null;
};

async function loadJobsFor(businessId: string, leadIds: string[]) {
  const jobs: { lead_id: string; created_at: string; completion_status: string }[] = [];
  for (let i = 0; i < leadIds.length; i += 300) {
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .select("lead_id, created_at, completion_status")
      .eq("business_id", businessId)
      .in("lead_id", leadIds.slice(i, i + 300));
    if (error) throw new Error("Could not read bookings for campaign results.");
    jobs.push(...((data ?? []) as typeof jobs));
  }
  return jobs;
}

/**
 * Customer replies per campaign recipient (from Campaigns > Replies), so the
 * campaign pages and the inbox show the same numbers. Before migration 0033
 * there are simply no replies.
 */
type ReplyStats = Map<string, { replies: number; unread: number }>;
async function loadReplyStats(businessId: string, campaignId?: string): Promise<ReplyStats> {
  let query = supabaseAdmin
    .from("email_messages")
    .select("recipient_id, read_at")
    .eq("business_id", businessId)
    .eq("direction", "in")
    .not("recipient_id", "is", null)
    .limit(5000);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  const { data, error } = await query;
  const stats: ReplyStats = new Map();
  if (error) return stats;
  for (const m of (data ?? []) as { recipient_id: string; read_at: string | null }[]) {
    const s = stats.get(m.recipient_id) ?? { replies: 0, unread: 0 };
    s.replies += 1;
    if (!m.read_at) s.unread += 1;
    stats.set(m.recipient_id, s);
  }
  return stats;
}

function shapeCampaign(
  campaign: CampaignRow,
  rows: RecipientRow[],
  booked: Set<string>,
  names?: Map<string, string | null>,
  replyStats: ReplyStats = new Map(),
) {
  return {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    bodyText: campaign.body_text,
    fromAddress: campaign.from_address,
    fromDeliverable: isDeliverableFromAddress(campaign.from_address),
    status: campaign.status,
    createdAt: campaign.created_at,
    sentAt: campaign.sent_at,
    scheduledAt: campaign.scheduled_at,
    audienceLabel: campaign.audience_label,
    followUp: campaign.follow_up_delay_days
      ? {
          subject: campaign.follow_up_subject ?? "",
          bodyText: campaign.follow_up_body ?? "",
          delayDays: campaign.follow_up_delay_days,
          stopOnBooking: campaign.stop_on_booking,
        }
      : null,
    recipients: rows.map((r) => ({
      recipientId: r.id,
      leadId: r.lead_id,
      name: r.lead_id ? (names?.get(r.lead_id) ?? null) : null,
      email: r.email,
      status: r.status,
      error: r.error,
      sentAt: r.sent_at,
      followUpStatus: r.follow_up_status,
      followUpSentAt: r.follow_up_sent_at,
      followUpError: r.follow_up_error,
      booked: Boolean(r.lead_id && booked.has(r.lead_id)),
      replies: replyStats.get(r.id)?.replies ?? 0,
    })),
    counts: {
      total: rows.length,
      sent: rows.filter((r) => r.status === "sent").length,
      failed: rows.filter((r) => r.status === "failed").length,
      pending: rows.filter((r) => r.status === "pending").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      followUpsSent: rows.filter((r) => r.follow_up_status === "sent").length,
      followUpsWaiting: rows.filter((r) => r.follow_up_status === "pending").length,
      booked: booked.size,
      replied: rows.filter((r) => replyStats.has(r.id)).length,
      unreadReplies: rows.reduce((n, r) => n + (replyStats.get(r.id)?.unread ?? 0), 0),
    },
  };
}

export async function listEmailCampaigns(businessId: string) {
  const [cCols, rCols] = await Promise.all([campaignColumns(), recipientColumns()]);
  const [{ data: campaigns, error }, { data: recipients, error: recipientError }] =
    await Promise.all([
      supabaseAdmin
        .from("email_campaigns")
        .select(cCols)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("email_campaign_recipients")
        .select(rCols)
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);
  if (error || recipientError) throw new Error("Could not load email campaigns.");

  const rowsAll = ((recipients ?? []) as unknown as Partial<RecipientRow>[]).map(fillRecipient);
  const byCampaign = new Map<string, RecipientRow[]>();
  for (const row of rowsAll) {
    const list = byCampaign.get(row.campaign_id) ?? [];
    list.push(row);
    byCampaign.set(row.campaign_id, list);
  }
  const leadIds = [
    ...new Set(rowsAll.filter((r) => r.lead_id && r.sent_at).map((r) => r.lead_id as string)),
  ];
  const [jobs, replyStats] = await Promise.all([loadJobsFor(businessId, leadIds), loadReplyStats(businessId)]);

  return ((campaigns ?? []) as unknown as CampaignRow[]).map(fillCampaign).map((campaign) => {
    const rows = byCampaign.get(campaign.id) ?? [];
    const booked = bookedRecipients(
      rows.map((r) => ({ leadId: r.lead_id, sentAt: r.sent_at })),
      jobs,
    );
    return shapeCampaign(campaign, rows, booked, undefined, replyStats);
  });
}

/** One campaign with every recipient, their names and results. */
export async function getEmailCampaign(businessId: string, campaignId: string) {
  const [cCols, rCols] = await Promise.all([campaignColumns(), recipientColumns()]);
  const { data: campaign, error } = await supabaseAdmin
    .from("email_campaigns")
    .select(cCols)
    .eq("business_id", businessId)
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw new Error("Could not load the campaign.");
  if (!campaign) throw new Error("Campaign not found.");
  const { data: recipients, error: recipientError } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select(rCols)
    .eq("business_id", businessId)
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (recipientError) throw new Error("Could not load the campaign recipients.");
  const rows = ((recipients ?? []) as unknown as Partial<RecipientRow>[]).map(fillRecipient);
  const leadIds = [...new Set(rows.filter((r) => r.lead_id).map((r) => r.lead_id as string))];
  const names = new Map<string, string | null>();
  for (let i = 0; i < leadIds.length; i += 300) {
    const { data, error: nameError } = await supabaseAdmin
      .from("leads")
      .select("id, name")
      .eq("business_id", businessId)
      .in("id", leadIds.slice(i, i + 300));
    if (nameError) throw new Error("Could not load the campaign recipients.");
    for (const lead of data ?? []) names.set(lead.id as string, (lead.name as string | null) ?? null);
  }
  const [jobs, replyStats] = await Promise.all([loadJobsFor(businessId, leadIds), loadReplyStats(businessId, campaignId)]);
  const booked = bookedRecipients(
    rows.map((r) => ({ leadId: r.lead_id, sentAt: r.sent_at })),
    jobs,
  );
  return shapeCampaign(fillCampaign(campaign as unknown as CampaignRow), rows, booked, names, replyStats);
}

/** Customers in a quick audience (with an email, never opted out), newest first. */
export async function campaignAudience(businessId: string, audience: CampaignAudienceId) {
  const def = CAMPAIGN_AUDIENCES.find((a) => a.id === audience);
  if (!def) throw new Error("Unknown audience.");
  let query = supabaseAdmin
    .from("leads")
    .select("id, name, email, suburb")
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .not("email", "is", null)
    .not("status", "in", `(${NEVER_EMAIL_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(500);
  if (def.statuses) query = query.in("status", [...def.statuses]);
  const { data, error } = await query;
  if (error) throw new Error("Could not load that audience.");
  const unsubscribed = await loadUnsubscribed(businessId);
  return (data ?? [])
    .filter((row) => row.email && !unsubscribed.has((row.email as string).trim().toLowerCase()))
    .map((row) => ({
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string | null,
      suburb: row.suburb as string | null,
    }));
}

export async function createEmailCampaign(input: {
  businessId: string;
  userId: string;
  name: string;
  subject: string;
  bodyText: string;
  fromAddress?: string | null;
  leadIds: string[];
  followUp?: { subject: string; bodyText: string; delayDays: number; stopOnBooking: boolean } | null;
  audienceLabel?: string | null;
}) {
  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, name, email, deleted_at")
    .eq("business_id", input.businessId)
    .in("id", input.leadIds);

  const unsubscribed = await loadUnsubscribed(input.businessId);
  const split = splitRecipients(leads ?? [], unsubscribed);
  if (split.emailable.length === 0) {
    throw new Error(
      "None of the selected customers can be emailed (no email address, or unsubscribed).",
    );
  }

  const fromAddress = normaliseFromAddress(input.fromAddress);
  const sequences = await hasSequenceColumns();
  if (!sequences && input.followUp) {
    throw new Error("Follow-ups aren't switched on yet. Ask support to finish the campaigns update, or save without a follow-up.");
  }
  const { data: campaign, error } = await supabaseAdmin
    .from("email_campaigns")
    .insert({
      business_id: input.businessId,
      name: input.name,
      subject: input.subject,
      body_text: input.bodyText,
      from_address: fromAddress,
      status: "draft",
      created_by: input.userId,
      ...(sequences
        ? {
            follow_up_subject: input.followUp?.subject ?? null,
            follow_up_body: input.followUp?.bodyText ?? null,
            follow_up_delay_days: input.followUp?.delayDays ?? null,
            stop_on_booking: input.followUp?.stopOnBooking ?? true,
            audience_label: input.audienceLabel ?? null,
          }
        : {}),
    })
    .select("id")
    .single();
  if (error || !campaign) throw new Error("Could not save the email campaign.");

  const { error: recipientError } = await supabaseAdmin
    .from("email_campaign_recipients")
    .insert(
      split.emailable.map((r) => ({
        campaign_id: campaign.id,
        business_id: input.businessId,
        lead_id: r.leadId,
        email: r.email,
      })),
    );
  if (recipientError) throw new Error("Could not save the campaign recipients.");

  return {
    campaignId: campaign.id as string,
    emailable: split.emailable.length,
    skippedNoEmail: split.skippedNoEmail.length,
    skippedUnsubscribed: split.skippedUnsubscribed.length,
    fromDeliverable: isDeliverableFromAddress(fromAddress),
  };
}

export async function sendEmailCampaign(input: { businessId: string; campaignId: string }) {
  const { data: campaign } = await supabaseAdmin
    .from("email_campaigns")
    // Before migration 0030 the follow-up column is missing; it then reads as undefined.
    .select(
      ((await hasSequenceColumns())
        ? "id, subject, body_text, from_address, status, created_by, follow_up_delay_days"
        : "id, subject, body_text, from_address, status, created_by") as "id, subject, body_text, from_address, status, created_by, follow_up_delay_days",
    )
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "sent") throw new Error("This campaign has already been sent.");
  if (campaign.status === "cancelled") throw new Error("This campaign was cancelled.");

  const { businessName, branding } = await loadBranding(input.businessId);
  const unsubscribed = await loadUnsubscribed(input.businessId);
  const sender = campaignSender(campaign.from_address as string, await creatorEmail(campaign.created_by as string | null));

  const { data: recipients } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id, email")
    .eq("campaign_id", input.campaignId)
    .in("status", ["pending", "failed"]);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients ?? []) {
    // Claim the row first so a scheduled run and a manual Send never both email it.
    const { data: claimed } = await supabaseAdmin
      .from("email_campaign_recipients")
      .update({ status: "sending" })
      .eq("id", recipient.id)
      .in("status", ["pending", "failed"])
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    const email = (recipient.email as string).toLowerCase();
    if (unsubscribed.has(email)) {
      skipped += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ status: "skipped", error: "Unsubscribed" })
        .eq("id", recipient.id);
      continue;
    }
    try {
      const result = await sendEmailViaResend({
        from: `${businessName} <${sender.from}>`,
        replyTo: replyToFor(recipient.id as string, sender.replyTo, businessName),
        to: email,
        subject: campaign.subject as string,
        html: buildEmailHtml({
          businessName,
          branding,
          bodyText: campaign.body_text as string,
          unsubscribeUrl: unsubscribeUrl(input.businessId, email),
        }),
        text: buildEmailText({
          businessName,
          branding,
          bodyText: campaign.body_text as string,
          unsubscribeUrl: unsubscribeUrl(input.businessId, email),
        }),
      });
      sent += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_id: result.id,
          ...(campaign.follow_up_delay_days
            ? { follow_up_status: "pending" }
            : {}),
        })
        .eq("id", recipient.id);
    } catch (error) {
      failed += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ status: "failed", error: error instanceof Error ? error.message : "Send failed" })
        .eq("id", recipient.id);
    }
  }

  // Nothing delivered: keep it a draft so the owner can fix the cause and retry
  // the failed customers without rebuilding the campaign.
  if (sent === 0 && failed > 0) return { sent, failed, skipped };

  await supabaseAdmin
    .from("email_campaigns")
    .update({
      status: "sent",
      approved_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    })
    .eq("id", input.campaignId);

  return { sent, failed, skipped };
}

export async function cancelEmailCampaign(input: { businessId: string; campaignId: string }) {
  const { data: campaign } = await supabaseAdmin
    .from("email_campaigns")
    .select("status")
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "sent") throw new Error("A sent campaign cannot be cancelled.");
  if (campaign.status === "sending") throw new Error("This campaign is sending right now.");
  await supabaseAdmin
    .from("email_campaigns")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", input.campaignId);
  return { ok: true };
}

export async function recordUnsubscribe(businessId: string, email: string) {
  const normalised = email.trim().toLowerCase();
  if (!normalised) return;
  await supabaseAdmin
    .from("email_unsubscribes")
    .upsert(
      { business_id: businessId, email: normalised },
      { onConflict: "business_id,email" },
    );
}

/** Owner approval for a later send: the draft goes out at the chosen time. */
export async function scheduleEmailCampaign(input: {
  businessId: string;
  campaignId: string;
  scheduledAt: string;
  now?: Date;
}) {
  if (!(await hasSequenceColumns())) throw new Error("Scheduling isn't switched on yet. Send now instead, or try again later.");
  const at = new Date(input.scheduledAt);
  const problem = scheduleTimeProblem(at, input.now ?? new Date());
  if (problem) throw new Error(problem);
  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .update({ status: "scheduled", scheduled_at: at.toISOString(), approved_at: new Date().toISOString() })
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .in("status", ["draft", "scheduled"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not schedule the campaign.");
  if (!data) throw new Error("Only a draft can be scheduled.");
  return { scheduledAt: at.toISOString() };
}

/** Moves a scheduled campaign back to a draft; nothing is sent. */
export async function unscheduleEmailCampaign(input: { businessId: string; campaignId: string }) {
  const { data, error } = await supabaseAdmin
    .from("email_campaigns")
    .update({ status: "draft", scheduled_at: null, approved_at: null })
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Could not change the campaign.");
  if (!data) throw new Error("That campaign is no longer scheduled.");
  return { ok: true };
}

/** Stops every follow-up that has not gone out yet. */
export async function stopCampaignFollowUps(input: { businessId: string; campaignId: string }) {
  const { data, error } = await supabaseAdmin
    .from("email_campaign_recipients")
    .update({ follow_up_status: "skipped", follow_up_error: "Stopped by owner" })
    .eq("business_id", input.businessId)
    .eq("campaign_id", input.campaignId)
    .eq("follow_up_status", "pending")
    .select("id");
  if (error) throw new Error("Could not stop the follow-ups.");
  return { stopped: (data ?? []).length };
}

type DueFollowUp = {
  id: string;
  business_id: string;
  lead_id: string | null;
  email: string;
  sent_at: string | null;
  email_campaigns: {
    status: string;
    from_address: string;
    created_by: string | null;
    follow_up_subject: string | null;
    follow_up_body: string | null;
    follow_up_delay_days: number | null;
    stop_on_booking: boolean;
  } | null;
};

async function resetScheduled(campaignId: string) {
  await supabaseAdmin
    .from("email_campaigns")
    .update({ status: "draft", scheduled_at: null })
    .eq("id", campaignId)
    .eq("status", "sending");
}

/**
 * Called by the 10-minute follow-ups hook: sends campaigns whose scheduled
 * time has come, then every follow-up that is due. Each row is claimed with a
 * conditional update first, so overlapping runs never send twice.
 */
export async function processDueEmailCampaigns(now: Date = new Date()) {
  if (!(await hasSequenceColumns())) return { campaignsSent: 0, followUpsSent: 0, followUpsSkipped: 0, followUpsFailed: 0, waitingForMigration: true };
  let campaignsSent = 0;
  const { data: scheduled, error: scheduledError } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, business_id")
    .eq("status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .limit(10);
  if (scheduledError) throw new Error(`Could not read scheduled campaigns: ${scheduledError.message}`);
  for (const campaign of scheduled ?? []) {
    const { data: claimed } = await supabaseAdmin
      .from("email_campaigns")
      .update({ status: "sending" })
      .eq("id", campaign.id)
      .eq("status", "scheduled")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    try {
      const result = await sendEmailCampaign({
        businessId: campaign.business_id as string,
        campaignId: campaign.id as string,
      });
      if (result.sent > 0) campaignsSent += 1;
      else await resetScheduled(campaign.id as string);
    } catch (error) {
      console.error("[email-campaigns] scheduled send failed", error);
      await resetScheduled(campaign.id as string);
    }
  }

  let followUpsSent = 0;
  let followUpsSkipped = 0;
  let followUpsFailed = 0;
  const { data: pending, error } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select(
      "id, business_id, lead_id, email, sent_at, email_campaigns!inner(status, from_address, created_by, follow_up_subject, follow_up_body, follow_up_delay_days, stop_on_booking)",
    )
    .eq("follow_up_status", "pending")
    .order("sent_at", { ascending: true })
    .limit(500);
  if (error) throw new Error(`Could not read due follow-ups: ${error.message}`);

  const due = ((pending ?? []) as unknown as DueFollowUp[])
    .filter((r) => r.email_campaigns && followUpDue(r.sent_at, r.email_campaigns.follow_up_delay_days, now))
    .slice(0, 100);
  const unsubscribedBy = new Map<string, Set<string>>();
  const brandings = new Map<string, Branding>();

  for (const row of due) {
    const campaign = row.email_campaigns!;
    const { data: claimed } = await supabaseAdmin
      .from("email_campaign_recipients")
      .update({ follow_up_status: "sending" })
      .eq("id", row.id)
      .eq("follow_up_status", "pending")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    if (!unsubscribedBy.has(row.business_id)) {
      unsubscribedBy.set(row.business_id, await loadUnsubscribed(row.business_id));
    }
    const email = row.email.toLowerCase();
    let leadDeleted = false;
    let booked = false;
    if (row.lead_id) {
      const [{ data: lead }, { data: jobs }] = await Promise.all([
        supabaseAdmin.from("leads").select("deleted_at").eq("id", row.lead_id).maybeSingle(),
        supabaseAdmin
          .from("jobs")
          .select("id")
          .eq("business_id", row.business_id)
          .eq("lead_id", row.lead_id)
          .neq("completion_status", "cancelled")
          .gte("created_at", row.sent_at ?? now.toISOString())
          .limit(1),
      ]);
      leadDeleted = !lead || Boolean(lead.deleted_at);
      booked = (jobs ?? []).length > 0;
    }
    const reason = followUpSkipReason({
      unsubscribed: unsubscribedBy.get(row.business_id)!.has(email),
      leadDeleted,
      bookedSinceFirstEmail: booked,
      stopOnBooking: campaign.stop_on_booking,
      campaignStatus: campaign.status,
    });
    if (reason || !campaign.follow_up_subject || !campaign.follow_up_body) {
      followUpsSkipped += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ follow_up_status: "skipped", follow_up_error: reason ?? "Follow-up has no wording" })
        .eq("id", row.id);
      continue;
    }
    if (!brandings.has(row.business_id)) {
      brandings.set(row.business_id, await loadBranding(row.business_id));
    }
    const { businessName, branding } = brandings.get(row.business_id)!;
    const sender = campaignSender(campaign.from_address, await creatorEmail(campaign.created_by));
    try {
      await sendEmailViaResend({
        from: `${businessName} <${sender.from}>`,
        replyTo: replyToFor(row.id, sender.replyTo, businessName),
        to: email,
        subject: campaign.follow_up_subject,
        html: buildEmailHtml({
          businessName,
          branding,
          bodyText: campaign.follow_up_body,
          unsubscribeUrl: unsubscribeUrl(row.business_id, email),
        }),
        text: buildEmailText({
          businessName,
          branding,
          bodyText: campaign.follow_up_body,
          unsubscribeUrl: unsubscribeUrl(row.business_id, email),
        }),
      });
      followUpsSent += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({
          follow_up_status: "sent",
          follow_up_sent_at: new Date().toISOString(),
          follow_up_error: null,
        })
        .eq("id", row.id);
    } catch (sendError) {
      followUpsFailed += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({
          follow_up_status: "failed",
          follow_up_error: sendError instanceof Error ? sendError.message : "Send failed",
        })
        .eq("id", row.id);
    }
  }
  return { campaignsSent, followUpsSent, followUpsSkipped, followUpsFailed };
}

/** AI writes a first email or follow-up from the owner's instructions. Nothing is saved. */
export async function draftCampaignEmail(input: {
  businessId: string;
  kind: "first" | "follow_up";
  instructions: string;
  chips: string[];
  firstEmail?: { subject: string; bodyText: string } | null;
}): Promise<{ subject: string; bodyText: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("The AI service is not configured.");
  const { checkAiCap, recordAiUsage } = await import("./usage.server");
  if ((await checkAiCap(input.businessId)).blocked) {
    throw new Error("This month's AI limit is reached.");
  }
  const { loadBusinessFacts, FACTS_ONLY_RULES } = await import("./business-facts.server");
  const facts = await loadBusinessFacts(input.businessId);
  const businessName = facts.name;
  const { generateText, streamText } = await import("ai");
  const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
  const { withAiBackup } = await import("./tenant-ai.server");
  const { ANALYSIS_MODEL } = await import("./ai.server");
  const system = [
    `You write marketing emails for ${businessName} to its own customers.`,
    FACTS_ONLY_RULES,
    input.kind === "follow_up"
      ? "Write a short, friendly follow-up (under 80 words) for customers who received the first email below and have not booked yet. Do not repeat it word for word."
      : "Write one short email (under 140 words) that gets customers to reply or book.",
    "Australian English, plain text only, warm and direct. Start with 'Hi there,'. End with 'Thanks,' and the business name on the next line.",
    "Never use placeholders, merge fields or square or curly brackets. Never invent prices, discounts, dates or guarantees the owner did not give.",
    "Blank lines separate paragraphs.",
    "Business facts:",
    ...facts.lines,
    "Reply in exactly this format:",
    "SUBJECT: <subject under 60 characters>",
    "BODY:",
    "<the email>",
  ].join("\n");
  const prompt = [
    input.instructions.trim()
      ? `Owner's instructions: """${input.instructions.trim().slice(0, 2000)}"""`
      : "No extra instructions.",
    input.chips.length ? `Also: ${input.chips.slice(0, 8).join("; ")}.` : "",
    input.firstEmail
      ? `First email:\nSubject: ${input.firstEmail.subject}\n${input.firstEmail.bodyText.slice(0, 3000)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const gateway = createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  const result = await withAiBackup({
    businessId: input.businessId,
    role: "fast",
    usage: { source: "lovable" },
    gateway: async () => {
      const r = await generateText({ model: gateway(ANALYSIS_MODEL), system, prompt });
      return { text: r.text, input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 };
    },
    backup: async (provider) => {
      const r = streamText({ ...provider, maxRetries: 0, system, prompt, onError: () => undefined });
      const u = await r.usage;
      return { text: await r.text, input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 };
    },
  });
  await recordAiUsage({
    businessId: input.businessId,
    purpose: "email_campaign_draft",
    model: ANALYSIS_MODEL,
    inputTokens: result.input,
    outputTokens: result.output,
  }).catch(() => undefined);
  const parsed = parseCampaignDraft(result.text);
  if (!parsed) throw new Error("The AI didn't return an email. Please try again.");
  return parsed;
}

/**
 * Edit a draft (or scheduled) campaign: wording, follow-up, reply-to address
 * and recipients. Only pending recipients can be removed; a sent campaign can
 * no longer change. Returns the campaign as saved.
 */
export async function updateEmailCampaignDraft(input: {
  businessId: string;
  campaignId: string;
  name?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  replyTo?: string | null;
  /** undefined = leave as is, null = remove the follow-up. */
  followUp?: { subject: string; bodyText: string; delayDays: number; stopOnBooking: boolean } | null;
  addLeadIds?: string[];
  removeLeadIds?: string[];
  /** Replace every pending recipient with these customers. */
  replaceLeadIds?: string[];
  audienceLabel?: string | null;
}) {
  const { data: campaign, error } = await supabaseAdmin
    .from("email_campaigns")
    .select("id, status")
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (error) throw new Error("Could not load the campaign.");
  if (!campaign) throw new Error("Campaign not found.");
  if (!["draft", "scheduled"].includes(campaign.status as string)) {
    throw new Error("Only a draft or scheduled campaign can be changed.");
  }
  const sequences = await hasSequenceColumns();
  const patch: Database["public"]["Tables"]["email_campaigns"]["Update"] = {};
  if (input.name?.trim()) patch.name = input.name.trim().slice(0, 120);
  if (input.subject?.trim()) patch.subject = input.subject.trim().slice(0, 160);
  if (input.bodyText?.trim()) patch.body_text = input.bodyText.trim().slice(0, 5000);
  if (input.replyTo !== undefined) patch.from_address = normaliseFromAddress(input.replyTo);
  if (input.followUp !== undefined) {
    if (!sequences) throw new Error("Follow-ups aren't switched on yet.");
    patch.follow_up_subject = input.followUp?.subject ?? null;
    patch.follow_up_body = input.followUp?.bodyText ?? null;
    patch.follow_up_delay_days = input.followUp?.delayDays ?? null;
    patch.stop_on_booking = input.followUp?.stopOnBooking ?? true;
  }
  if (input.audienceLabel !== undefined && sequences) patch.audience_label = input.audienceLabel;
  if (Object.keys(patch).length) {
    const { error: updateError } = await supabaseAdmin.from("email_campaigns").update(patch)
      .eq("id", input.campaignId).eq("business_id", input.businessId).in("status", ["draft", "scheduled"]);
    if (updateError) throw new Error("Could not save the campaign changes.");
  }

  let added = 0;
  let removed = 0;
  let skippedNoEmail = 0;
  let skippedUnsubscribed = 0;
  const removeIds = input.replaceLeadIds ? null : (input.removeLeadIds ?? []);
  if (input.replaceLeadIds) {
    const { data: gone, error: clearError } = await supabaseAdmin.from("email_campaign_recipients").delete()
      .eq("campaign_id", input.campaignId).eq("business_id", input.businessId).eq("status", "pending").select("id");
    if (clearError) throw new Error("Could not update the recipients.");
    removed = (gone ?? []).length;
  } else if (removeIds && removeIds.length) {
    const { data: gone, error: removeError } = await supabaseAdmin.from("email_campaign_recipients").delete()
      .eq("campaign_id", input.campaignId).eq("business_id", input.businessId).eq("status", "pending").in("lead_id", removeIds).select("id");
    if (removeError) throw new Error("Could not remove those recipients.");
    removed = (gone ?? []).length;
  }
  const toAdd = input.replaceLeadIds ?? input.addLeadIds ?? [];
  if (toAdd.length) {
    const [{ data: leads }, { data: existing }] = await Promise.all([
      supabaseAdmin.from("leads").select("id, name, email, deleted_at").eq("business_id", input.businessId).in("id", toAdd),
      supabaseAdmin.from("email_campaign_recipients").select("email").eq("campaign_id", input.campaignId),
    ]);
    const unsubscribed = await loadUnsubscribed(input.businessId);
    const split = splitRecipients(leads ?? [], unsubscribed);
    const already = new Set((existing ?? []).map((r) => (r.email as string).toLowerCase()));
    const fresh = split.emailable.filter((r) => !already.has(r.email));
    skippedNoEmail = split.skippedNoEmail.length;
    skippedUnsubscribed = split.skippedUnsubscribed.length;
    if (fresh.length) {
      const { error: insertError } = await supabaseAdmin.from("email_campaign_recipients").insert(
        fresh.map((r) => ({ campaign_id: input.campaignId, business_id: input.businessId, lead_id: r.leadId, email: r.email })),
      );
      if (insertError) throw new Error("Could not add those recipients.");
    }
    added = fresh.length;
  }
  const saved = await getEmailCampaign(input.businessId, input.campaignId);
  return { campaign: saved, added, removed, skippedNoEmail, skippedUnsubscribed };
}
