/**
 * Customer replies to campaign emails: received from Resend, matched to the
 * campaign recipient by the reply+<id> address, stored as a conversation, a
 * copy forwarded to the owner's own inbox, and answered from BookedSecure.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { campaignSender, PLATFORM_FROM_ADDRESS } from "@/lib/email-campaigns";
import { renderEmailHtml, renderEmailText } from "@/lib/email-template";
import {
  htmlToText,
  parseAddress,
  recipientIdFromAddresses,
  replyAddressFor,
  replyToHeader,
  stripQuotedReply,
  verifyResendWebhook,
} from "@/lib/email-inbound";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

/** Replies are captured only once the inbound webhook secret is configured. */
export function inboundRepliesEnabled(): boolean {
  return Boolean(process.env["RESEND_WEBHOOK_SECRET"]);
}

async function resendSend(payload: Record<string, unknown>): Promise<{ id: string | null }> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) throw new Error("Email sending is not configured.");
  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}`, "X-Connection-Api-Key": resendKey },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Email provider rejected the send (${response.status}).`);
  const parsed = (await response.json().catch(() => null)) as { id?: string } | null;
  return { id: parsed?.id ?? null };
}

type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  message_id: string | null;
  headers?: Record<string, string> | null;
};

/** Full content of a received email (the webhook only carries metadata). */
async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  const key = process.env["RESEND_RECEIVING_API_KEY"] ?? process.env["RESEND_API_KEY"];
  if (!key) throw new Error("RESEND_RECEIVING_API_KEY is not configured.");
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Could not read the received email (${response.status}).`);
  return (await response.json()) as ReceivedEmail;
}

async function loadBusiness(businessId: string) {
  const { data } = await supabaseAdmin.from("businesses").select("name, logo_storage_path, logo_url, website_url, service_area, abn").eq("id", businessId).maybeSingle();
  const origin = process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
  return {
    businessName: (data?.name as string | null) ?? "your business",
    branding: {
      logoUrl: data?.logo_storage_path ? `${origin}/api/public/tenant-logo/${businessId}` : typeof data?.logo_url === "string" && data.logo_url.startsWith("https://") ? data.logo_url : null,
      websiteUrl: (data?.website_url as string | null) ?? null,
      serviceArea: (data?.service_area as string | null) ?? null,
      abn: (data?.abn as string | null) ?? null,
    },
  };
}

async function ownerAddress(campaignFrom: string, createdBy: string | null): Promise<string | null> {
  let creator: string | null = null;
  if (createdBy) {
    const { data } = await supabaseAdmin.auth.admin.getUserById(createdBy);
    creator = data?.user?.email ?? null;
  }
  return campaignSender(campaignFrom, creator).replyTo ?? creator;
}

/**
 * Handles one Resend webhook delivery. Returns an HTTP status: 401 for a bad
 * signature, 200 otherwise (including replies we can't match, so Resend
 * doesn't retry them forever).
 */
export async function handleResendWebhook(request: Request): Promise<Response> {
  const body = await request.text();
  if (body.length > 1_000_000) return new Response("Too large", { status: 413 });
  const ok = await verifyResendWebhook({
    secret: process.env["RESEND_WEBHOOK_SECRET"] ?? "",
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
  });
  if (!ok) return new Response("Invalid signature", { status: 401 });
  let event: { type?: string; data?: { email_id?: string; to?: string[]; received_for?: string[] } } = {};
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("ok");
  }
  if (event.type !== "email.received" || !event.data?.email_id) return new Response("ok");
  try {
    await storeInboundReply(event.data.email_id, [...(event.data.to ?? []), ...(event.data.received_for ?? [])]);
  } catch (error) {
    console.error("[email-inbound] could not store reply", error);
    return new Response("Retry later", { status: 500 });
  }
  return new Response("ok");
}

export async function storeInboundReply(emailId: string, hintedTo: string[] = []) {
  const { data: existing } = await supabaseAdmin.from("email_messages").select("id").eq("provider_id", emailId).maybeSingle();
  if (existing) return { stored: false, reason: "duplicate" };
  const email = await fetchReceivedEmail(emailId);
  const recipientId = recipientIdFromAddresses([...(email.to ?? []), ...hintedTo]);
  if (!recipientId) return { stored: false, reason: "not a campaign reply" };

  const { data: recipient } = await supabaseAdmin.from("email_campaign_recipients")
    .select("id, business_id, campaign_id, lead_id, email").eq("id", recipientId).maybeSingle();
  if (!recipient) return { stored: false, reason: "unknown recipient" };
  const { data: campaign } = await supabaseAdmin.from("email_campaigns")
    .select("id, subject, from_address, created_by").eq("id", recipient.campaign_id).maybeSingle();

  const sender = parseAddress(email.from);
  const text = stripQuotedReply(email.text?.trim() ? email.text : htmlToText(email.html ?? "")).slice(0, 20_000);
  const { data: saved, error } = await supabaseAdmin.from("email_messages").insert({
    business_id: recipient.business_id,
    campaign_id: recipient.campaign_id,
    recipient_id: recipient.id,
    lead_id: recipient.lead_id,
    direction: "in",
    from_email: sender.email,
    from_name: sender.name,
    to_email: replyAddressFor(recipient.id),
    subject: email.subject ?? null,
    body_text: text,
    message_id: email.message_id ?? null,
    in_reply_to: email.headers?.["in-reply-to"] ?? null,
    provider_id: emailId,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") return { stored: false, reason: "duplicate" };
    throw new Error(error.message);
  }

  // A copy in the owner's own inbox, so nothing depends on opening BookedSecure.
  if (campaign) {
    const to = await ownerAddress(campaign.from_address as string, campaign.created_by as string | null);
    if (to) {
      const { businessName } = await loadBusiness(recipient.business_id);
      const who = sender.name ? `${sender.name} (${sender.email})` : sender.email;
      const note = `${who} replied to your campaign "${campaign.subject}":\n\n${text}\n\nReply from BookedSecure (Campaigns, Replies), or reply to this email to answer them directly.`;
      await resendSend({
        from: `BookedSecure <${PLATFORM_FROM_ADDRESS}>`,
        to: [to],
        subject: `Reply from ${sender.name ?? sender.email}: ${email.subject ?? campaign.subject}`.slice(0, 200),
        reply_to: sender.email,
        html: renderEmailHtml({ businessName }, { bodyText: note, heading: "New reply to your campaign" }),
        text: renderEmailText({ businessName }, { bodyText: note }),
      }).catch((e) => console.error("[email-inbound] owner copy failed", e));
    }
  }
  return { stored: true, id: saved.id };
}

/* ---------- Inbox for the Campaigns page ---------- */

export async function listReplyThreads(businessId: string) {
  const { data, error } = await supabaseAdmin.from("email_messages")
    .select("id, recipient_id, campaign_id, lead_id, direction, from_email, from_name, to_email, subject, body_text, read_at, created_at")
    .eq("business_id", businessId).order("created_at", { ascending: false }).limit(1000);
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") return { threads: [], setupMissing: true };
    throw new Error("Could not load email replies.");
  }
  const threads = new Map<string, { recipientId: string; campaignId: string | null; leadId: string | null; customerEmail: string; customerName: string | null; lastMessage: string; lastAt: string; lastFromCustomer: boolean; unread: number; messages: number }>();
  for (const m of data ?? []) {
    if (!m.recipient_id) continue;
    let t = threads.get(m.recipient_id);
    if (!t) {
      t = { recipientId: m.recipient_id, campaignId: m.campaign_id, leadId: m.lead_id, customerEmail: m.direction === "in" ? m.from_email : m.to_email, customerName: m.direction === "in" ? m.from_name : null, lastMessage: m.body_text.slice(0, 200), lastAt: m.created_at, lastFromCustomer: m.direction === "in", unread: 0, messages: 0 };
      threads.set(m.recipient_id, t);
    }
    t.messages += 1;
    if (m.direction === "in" && !m.read_at) t.unread += 1;
    if (!t.customerName && m.direction === "in" && m.from_name) t.customerName = m.from_name;
  }
  const list = [...threads.values()];
  const campaignIds = [...new Set(list.map((t) => t.campaignId).filter(Boolean) as string[])];
  const leadIds = [...new Set(list.map((t) => t.leadId).filter(Boolean) as string[])];
  const [campaigns, leads] = await Promise.all([
    campaignIds.length ? supabaseAdmin.from("email_campaigns").select("id, name, subject").eq("business_id", businessId).in("id", campaignIds) : Promise.resolve({ data: [] as { id: string; name: string; subject: string }[] }),
    leadIds.length ? supabaseAdmin.from("leads").select("id, name").eq("business_id", businessId).in("id", leadIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
  ]);
  const campaignById = new Map((campaigns.data ?? []).map((c) => [c.id, c]));
  const leadById = new Map((leads.data ?? []).map((l) => [l.id, l.name]));
  return {
    setupMissing: false,
    threads: list.map((t) => ({
      ...t,
      customerName: (t.leadId ? leadById.get(t.leadId) : null) ?? t.customerName,
      campaignName: t.campaignId ? (campaignById.get(t.campaignId)?.name ?? null) : null,
      campaignSubject: t.campaignId ? (campaignById.get(t.campaignId)?.subject ?? null) : null,
    })),
  };
}

export async function getReplyThread(businessId: string, recipientId: string) {
  const { data: recipient } = await supabaseAdmin.from("email_campaign_recipients")
    .select("id, campaign_id, lead_id, email, sent_at").eq("id", recipientId).eq("business_id", businessId).maybeSingle();
  if (!recipient) throw new Error("That conversation was not found.");
  const [{ data: campaign }, { data: messages, error }, { data: lead }] = await Promise.all([
    supabaseAdmin.from("email_campaigns").select("id, name, subject, body_text").eq("id", recipient.campaign_id).maybeSingle(),
    supabaseAdmin.from("email_messages").select("id, direction, from_email, from_name, body_text, subject, created_at, status, error, read_at")
      .eq("business_id", businessId).eq("recipient_id", recipientId).order("created_at", { ascending: true }).limit(200),
    recipient.lead_id ? supabaseAdmin.from("leads").select("id, name").eq("id", recipient.lead_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error("Could not load the conversation.");
  return {
    recipientId,
    leadId: recipient.lead_id,
    customerName: lead?.name ?? null,
    customerEmail: recipient.email,
    campaign: campaign ? { id: campaign.id, name: campaign.name, subject: campaign.subject, bodyText: campaign.body_text, sentAt: recipient.sent_at } : null,
    messages: messages ?? [],
  };
}

export async function markThreadRead(businessId: string, recipientId: string) {
  await supabaseAdmin.from("email_messages").update({ read_at: new Date().toISOString() })
    .eq("business_id", businessId).eq("recipient_id", recipientId).eq("direction", "in").is("read_at", null);
  return { ok: true };
}

export async function unreadReplyCount(businessId: string): Promise<number> {
  const { count, error } = await supabaseAdmin.from("email_messages").select("id", { count: "exact", head: true })
    .eq("business_id", businessId).eq("direction", "in").is("read_at", null);
  return error ? 0 : (count ?? 0);
}

/** The owner answers a customer from BookedSecure; it threads with their reply. */
export async function replyToThread(input: { businessId: string; recipientId: string; bodyText: string }) {
  const body = input.bodyText.trim();
  if (body.length < 1 || body.length > 10_000) throw new Error("Write a reply of up to 10,000 characters.");
  const thread = await getReplyThread(input.businessId, input.recipientId);
  // A double click (or two people pressing Send) must not email the customer twice.
  const twoMinutesAgo = Date.now() - 2 * 60_000;
  const duplicate = thread.messages.some(
    (m) => m.direction === "out" && m.body_text.trim() === body && Date.parse(m.created_at) > twoMinutesAgo,
  );
  if (duplicate) return { sent: false, duplicate: true };
  const lastIn = [...thread.messages].reverse().find((m) => m.direction === "in");
  const { data: lastHeader } = lastIn
    ? await supabaseAdmin.from("email_messages").select("message_id, subject").eq("id", lastIn.id).maybeSingle()
    : { data: null };
  const { businessName, branding } = await loadBusiness(input.businessId);
  const baseSubject = (lastHeader?.subject ?? thread.campaign?.subject ?? "Your enquiry").replace(/^(re:\s*)+/i, "");
  const subject = `Re: ${baseSubject}`.slice(0, 200);
  const result = await resendSend({
    from: `${businessName} <${PLATFORM_FROM_ADDRESS}>`,
    to: [thread.customerEmail],
    subject,
    reply_to: replyToHeader(input.recipientId, businessName),
    html: renderEmailHtml({ businessName, ...branding }, { bodyText: body }),
    text: renderEmailText({ businessName, ...branding }, { bodyText: body }),
    ...(lastHeader?.message_id ? { headers: { "In-Reply-To": lastHeader.message_id, References: lastHeader.message_id } } : {}),
  });
  const { data: recipient } = await supabaseAdmin.from("email_campaign_recipients").select("campaign_id, lead_id").eq("id", input.recipientId).maybeSingle();
  await supabaseAdmin.from("email_messages").insert({
    business_id: input.businessId,
    campaign_id: recipient?.campaign_id ?? null,
    recipient_id: input.recipientId,
    lead_id: recipient?.lead_id ?? null,
    direction: "out",
    from_email: PLATFORM_FROM_ADDRESS,
    from_name: businessName,
    to_email: thread.customerEmail,
    subject,
    body_text: body,
    in_reply_to: lastHeader?.message_id ?? null,
    provider_id: result.id,
    status: "sent",
    read_at: new Date().toISOString(),
  });
  await markThreadRead(input.businessId, input.recipientId);
  return { sent: true };
}
