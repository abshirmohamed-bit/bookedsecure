/**
 * Server orchestration for email campaigns.
 *
 * Drafts are created first; nothing is sent until the owner approves. Sends
 * go through the Resend connector gateway, one email per recipient, and every
 * outcome is recorded on the recipient row. Unsubscribed addresses are
 * skipped both when the draft is built and again at send time.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildEmailHtml,
  isDeliverableFromAddress,
  normaliseFromAddress,
  splitRecipients,
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

async function loadBusinessName(businessId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();
  return (data?.name as string | null) ?? "your business";
}

async function loadUnsubscribed(businessId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("email_unsubscribes")
    .select("email")
    .eq("business_id", businessId);
  return new Set((data ?? []).map((row) => (row.email as string).toLowerCase()));
}

export async function listEmailCampaigns(businessId: string) {
  const [{ data: campaigns }, { data: recipients }] = await Promise.all([
    supabaseAdmin
      .from("email_campaigns")
      .select("id, name, subject, body_text, from_address, status, created_at, sent_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabaseAdmin
      .from("email_campaign_recipients")
      .select("campaign_id, email, status, error")
      .eq("business_id", businessId)
      .limit(2000),
  ]);

  const byCampaign = new Map<string, { email: string; status: string; error: string | null }[]>();
  for (const row of recipients ?? []) {
    const list = byCampaign.get(row.campaign_id as string) ?? [];
    list.push({ email: row.email as string, status: row.status as string, error: row.error });
    byCampaign.set(row.campaign_id as string, list);
  }

  return (campaigns ?? []).map((campaign) => {
    const rows = byCampaign.get(campaign.id as string) ?? [];
    return {
      id: campaign.id as string,
      name: campaign.name as string,
      subject: campaign.subject as string,
      bodyText: campaign.body_text as string,
      fromAddress: campaign.from_address as string,
      fromDeliverable: isDeliverableFromAddress(campaign.from_address as string),
      status: campaign.status as string,
      createdAt: campaign.created_at as string,
      sentAt: campaign.sent_at as string | null,
      recipients: rows,
      counts: {
        total: rows.length,
        sent: rows.filter((r) => r.status === "sent").length,
        failed: rows.filter((r) => r.status === "failed").length,
        pending: rows.filter((r) => r.status === "pending").length,
      },
    };
  });
}

export async function createEmailCampaign(input: {
  businessId: string;
  userId: string;
  name: string;
  subject: string;
  bodyText: string;
  fromAddress?: string | null;
  leadIds: string[];
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
    .select("id, subject, body_text, from_address, status")
    .eq("id", input.campaignId)
    .eq("business_id", input.businessId)
    .maybeSingle();
  if (!campaign) throw new Error("Campaign not found.");
  if (campaign.status === "sent") throw new Error("This campaign has already been sent.");
  if (campaign.status === "cancelled") throw new Error("This campaign was cancelled.");

  const businessName = await loadBusinessName(input.businessId);
  const unsubscribed = await loadUnsubscribed(input.businessId);

  const { data: recipients } = await supabaseAdmin
    .from("email_campaign_recipients")
    .select("id, email")
    .eq("campaign_id", input.campaignId)
    .eq("status", "pending");

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const recipient of recipients ?? []) {
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
        from: `${businessName} <${campaign.from_address}>`,
        to: email,
        subject: campaign.subject as string,
        html: buildEmailHtml({
          businessName,
          bodyText: campaign.body_text as string,
          unsubscribeUrl: unsubscribeUrl(input.businessId, email),
        }),
      });
      sent += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ status: "sent", sent_at: new Date().toISOString(), provider_id: result.id })
        .eq("id", recipient.id);
    } catch (error) {
      failed += 1;
      await supabaseAdmin
        .from("email_campaign_recipients")
        .update({ status: "failed", error: error instanceof Error ? error.message : "Send failed" })
        .eq("id", recipient.id);
    }
  }

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
