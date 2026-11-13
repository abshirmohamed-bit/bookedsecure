/**
 * The business email inbox (Campaigns → Inbox; docs/email-inbox.sql).
 *
 * Each business has <name>@bookedsecure.com. Mail to it arrives on the
 * Resend webhook (email-inbound.server), is filed into a thread by its
 * In-Reply-To/References (or subject and sender) and linked to the lead with
 * that email. The owner writes, replies, replies to all and forwards from
 * BookedSecure through the one sender (sendEmailViaResend) and the business
 * email template. Every query is filtered by the caller's business; until the
 * migration exists the inbox reports setupMissing and campaign replies work
 * exactly as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { htmlToText, mailboxLabel, parseAddress, stripQuotedReply } from "@/lib/email-inbound";
import { renderEmailHtml, renderEmailText } from "@/lib/email-template";
import { TENANT_LOGO_BUCKET } from "@/lib/tenant-logo";
import {
  attachmentBelongsTo,
  attachmentPathFor,
  attachmentProblem,
  baseSubject,
  DAILY_SEND_LIMIT,
  forwardSubject,
  INBOX_DOMAIN,
  inboxAddress,
  localPartProblem,
  mailboxLocalPartsFrom,
  MAX_ATTACHMENTS,
  MAX_RECIPIENTS,
  MAX_TOTAL_ATTACHMENT_BYTES,
  messageIdsFrom,
  normaliseLocalPart,
  parseAddressList,
  quotedBlock,
  readAttachments,
  referencesFor,
  replyRecipients,
  replySubject,
  safeFileName,
  sanitizeEmailHtml,
  searchTerm,
  snippetOf,
  type InboxFolder,
  type StoredAttachment,
} from "@/lib/email-inbox";

const db = () => supabaseAdmin as unknown as SupabaseClient;

type DbError = { code?: string; message?: string } | null;
/** The inbox tables or columns aren't there yet (docs/email-inbox.sql not applied). */
export function inboxTablesMissing(error: DbError): boolean {
  return Boolean(error && ["PGRST205", "42P01", "42703", "PGRST204"].includes(error.code ?? ""));
}

function appOrigin(): string {
  return process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com";
}

async function loadBusiness(businessId: string) {
  const { data } = await supabaseAdmin.from("businesses").select("name, timezone, logo_storage_path, logo_url, website_url, service_area, abn").eq("id", businessId).maybeSingle();
  return {
    businessName: (data?.name as string | null) ?? "Your business",
    timeZone: (data?.timezone as string | null) ?? "Australia/Sydney",
    branding: {
      logoUrl: data?.logo_storage_path ? `${appOrigin()}/api/public/tenant-logo/${businessId}` : typeof data?.logo_url === "string" && data.logo_url.startsWith("https://") ? data.logo_url : null,
      websiteUrl: (data?.website_url as string | null) ?? null,
      serviceArea: (data?.service_area as string | null) ?? null,
      abn: (data?.abn as string | null) ?? null,
    },
  };
}

/* ---------- The business's address ---------- */

export type Mailbox = { localPart: string; address: string; displayName: string | null; signature: string | null };

export async function getMailbox(businessId: string): Promise<{ setupMissing: boolean; mailbox: Mailbox | null; suggested: string; businessName: string }> {
  const [{ data, error }, { data: business }] = await Promise.all([
    db().from("email_mailboxes").select("local_part, display_name, signature").eq("business_id", businessId).maybeSingle(),
    supabaseAdmin.from("businesses").select("name").eq("id", businessId).maybeSingle(),
  ]);
  const businessName = (business?.name as string | null) ?? "";
  const suggested = normaliseLocalPart(mailboxLabel(businessName));
  if (inboxTablesMissing(error)) return { setupMissing: true, mailbox: null, suggested, businessName };
  if (error) throw new Error("Could not load your email address.");
  const row = data as { local_part: string; display_name: string | null; signature: string | null } | null;
  return {
    setupMissing: false,
    suggested,
    businessName,
    mailbox: row ? { localPart: row.local_part, address: inboxAddress(row.local_part), displayName: row.display_name, signature: row.signature } : null,
  };
}

export async function saveMailbox(businessId: string, input: { localPart: string; displayName?: string | null | undefined; signature?: string | null | undefined }): Promise<Mailbox> {
  const localPart = normaliseLocalPart(input.localPart);
  const problem = localPartProblem(localPart);
  if (problem) throw new Error(problem);
  const { data: taken, error: takenError } = await db().from("email_mailboxes").select("business_id").eq("local_part", localPart).neq("business_id", businessId).maybeSingle();
  if (inboxTablesMissing(takenError)) throw new Error("The inbox is waiting for a database update (docs/email-inbox.sql).");
  if (taken) throw new Error(`${inboxAddress(localPart)} is already taken. Try another name.`);
  const displayName = cleanDisplayName(input.displayName ?? "") || null;
  const signature = (input.signature ?? "").trim().slice(0, 1000) || null;
  const { error } = await db().from("email_mailboxes").upsert(
    { business_id: businessId, local_part: localPart, display_name: displayName, signature, updated_at: new Date().toISOString() },
    { onConflict: "business_id" },
  );
  if (error) {
    if (error.code === "23505") throw new Error(`${inboxAddress(localPart)} is already taken. Try another name.`);
    throw new Error("Your email address could not be saved.");
  }
  return { localPart, address: inboxAddress(localPart), displayName, signature };
}

/** Resend accepts `Name <email>` only without quotes, so characters that need quoting are dropped. */
function cleanDisplayName(name: string): string {
  return name.replace(/["\\<>,;:@()[\]\r\n]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function requireMailbox(businessId: string): Promise<Mailbox> {
  const { mailbox, setupMissing } = await getMailbox(businessId);
  if (setupMissing) throw new Error("The inbox is waiting for a database update (docs/email-inbox.sql).");
  if (!mailbox) throw new Error("Choose your email address first.");
  return mailbox;
}

/* ---------- Receiving ---------- */

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[] | null;
  subject: string | null;
  text: string | null;
  html: string | null;
  message_id: string | null;
  headers?: Record<string, string> | null;
  attachments?: { id: string; filename?: string | null; content_type?: string | null; size?: number | null }[] | null;
};

function header(email: ReceivedEmail, name: string): string | null {
  const headers = email.headers ?? {};
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) return typeof value === "string" ? value : null;
  return null;
}

/** Businesses whose mailbox an email was sent to. */
export async function mailboxesFor(addresses: (string | null | undefined)[]): Promise<{ businessId: string; localPart: string }[]> {
  const locals = mailboxLocalPartsFrom(addresses);
  if (!locals.length) return [];
  const { data, error } = await db().from("email_mailboxes").select("business_id, local_part").in("local_part", locals);
  if (error) return [];
  return ((data ?? []) as { business_id: string; local_part: string }[]).map((r) => ({ businessId: r.business_id, localPart: r.local_part }));
}

type Download = { name: string; type: string; bytes: Uint8Array };

/** The files attached to a received email, fetched from Resend (at most 10, 10 MB each). */
async function downloadReceivedAttachments(email: ReceivedEmail): Promise<Download[]> {
  if (!email.attachments?.length) return [];
  const key = process.env["RESEND_RECEIVING_API_KEY"] ?? process.env["RESEND_API_KEY"];
  if (!key) return [];
  const auth = { Authorization: `Bearer ${key}` };
  let listed: { id: string; filename?: string; content_type?: string; size?: number; download_url?: string }[] = [];
  try {
    const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(email.id)}/attachments`, { headers: auth });
    if (response.ok) {
      const body = (await response.json()) as { data?: typeof listed } | typeof listed;
      listed = Array.isArray(body) ? body : (body.data ?? []);
    }
  } catch (error) {
    console.error("[email-inbox] could not list attachments", error);
  }
  const out: Download[] = [];
  for (const meta of email.attachments.slice(0, 10)) {
    const name = meta.filename ?? "attachment";
    if (attachmentProblem(name, meta.size ?? 1)) continue;
    try {
      let url = listed.find((a) => a.id === meta.id)?.download_url;
      if (!url) {
        const one = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(email.id)}/attachments/${encodeURIComponent(meta.id)}`, { headers: auth });
        if (one.ok) url = ((await one.json()) as { download_url?: string }).download_url;
      }
      if (!url || !url.startsWith("https://")) continue;
      const file = await fetch(url, { redirect: "manual" });
      if (!file.ok) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (attachmentProblem(name, bytes.byteLength)) continue;
      out.push({ name, type: meta.content_type ?? "application/octet-stream", bytes });
    } catch (error) {
      console.error("[email-inbox] attachment download failed", error);
    }
  }
  return out;
}

async function storeFiles(businessId: string, files: Download[]): Promise<StoredAttachment[]> {
  const stored: StoredAttachment[] = [];
  for (const file of files) {
    const path = attachmentPathFor(businessId, file.name);
    const { error } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).upload(path, file.bytes, { contentType: file.type, upsert: false });
    if (!error) stored.push({ path, name: safeFileName(file.name), type: file.type, size: file.bytes.byteLength });
  }
  return stored;
}

async function leadIdForEmail(businessId: string, emails: string[]): Promise<string | null> {
  const list = emails.filter((e) => !e.endsWith(`@${INBOX_DOMAIN}`)).slice(0, 20);
  if (!list.length) return null;
  const { data } = await supabaseAdmin.from("leads").select("id").eq("business_id", businessId).in("email_normalised", list).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1);
  return (data?.[0]?.id as string | undefined) ?? null;
}

/** The thread an incoming email belongs to: by message ids first, then same subject from the same person within 60 days. */
async function findThread(businessId: string, ids: string[], subject: string, sender: string): Promise<{ id: string; lead_id: string | null } | null> {
  if (ids.length) {
    const { data } = await db().from("email_messages").select("thread_id").eq("business_id", businessId).in("message_id", ids.slice(-20)).not("thread_id", "is", null).limit(1);
    const threadId = (data?.[0] as { thread_id?: string } | undefined)?.thread_id;
    if (threadId) {
      const { data: thread } = await db().from("email_threads").select("id, lead_id").eq("id", threadId).eq("business_id", businessId).maybeSingle();
      if (thread) return thread as { id: string; lead_id: string | null };
    }
  }
  if (!subject) return null;
  const since = new Date(Date.now() - 60 * 24 * 3600_000).toISOString();
  const { data } = await db().from("email_threads").select("id, lead_id").eq("business_id", businessId).eq("subject", subject)
    .contains("participants", [sender]).gte("last_message_at", since).order("last_message_at", { ascending: false }).limit(1);
  return (data?.[0] as { id: string; lead_id: string | null } | undefined) ?? null;
}

async function createThread(businessId: string, subject: string, participants: string[], leadId: string | null): Promise<string> {
  const { data, error } = await db().from("email_threads").insert({ business_id: businessId, subject, participants, lead_id: leadId }).select("id").single();
  if (error || !data) throw new Error(error?.message ?? "Could not start the conversation.");
  return (data as { id: string }).id;
}

/** Recomputes a thread's list fields from its messages. */
export async function refreshThread(threadId: string): Promise<void> {
  const { data } = await db().from("email_messages")
    .select("direction, from_email, from_name, to_emails, cc_emails, body_text, created_at, read_at, attachments")
    .eq("thread_id", threadId).order("created_at", { ascending: true }).limit(500);
  const rows = (data ?? []) as { direction: "in" | "out"; from_email: string; from_name: string | null; to_emails: string[]; cc_emails: string[]; body_text: string; created_at: string; read_at: string | null; attachments: unknown }[];
  if (!rows.length) return;
  const last = rows[rows.length - 1]!;
  const people = new Set<string>();
  for (const r of rows) for (const e of [r.from_email, ...(r.to_emails ?? []), ...(r.cc_emails ?? [])]) if (e && !e.endsWith(`@${INBOX_DOMAIN}`)) people.add(e.toLowerCase());
  const lastIn = [...rows].reverse().find((r) => r.direction === "in");
  await db().from("email_threads").update({
    participants: [...people].slice(0, 50),
    last_message_at: last.created_at,
    last_snippet: snippetOf(stripQuotedReply(last.body_text)),
    last_direction: last.direction,
    last_from: lastIn ? (lastIn.from_name ?? lastIn.from_email) : null,
    message_count: rows.length,
    unread_count: rows.filter((r) => r.direction === "in" && !r.read_at).length,
    has_inbound: rows.some((r) => r.direction === "in"),
    has_outbound: rows.some((r) => r.direction === "out"),
    has_attachments: rows.some((r) => readAttachments(r.attachments).length > 0),
  }).eq("id", threadId);
}

/**
 * Files one received email into each business mailbox it was sent to.
 * Returns how many were stored.
 */
export async function storeMailboxEmail(email: ReceivedEmail, hintedTo: string[] = []): Promise<{ stored: number; reason?: string }> {
  const to = (email.to ?? []).map((a) => parseAddress(a).email);
  const cc = (email.cc ?? []).map((a) => parseAddress(a).email);
  const targets = await mailboxesFor([...to, ...cc, ...hintedTo]);
  if (!targets.length) return { stored: 0, reason: "no business mailbox" };
  const sender = parseAddress(email.from);
  const text = (email.text?.trim() ? email.text : htmlToText(email.html ?? "")).slice(0, 50_000);
  const html = email.html ? sanitizeEmailHtml(email.html) : null;
  const subject = (email.subject ?? "").slice(0, 300);
  const ids = messageIdsFrom(header(email, "in-reply-to"), header(email, "references"));
  const files = await downloadReceivedAttachments(email);

  let stored = 0;
  for (const [index, target] of targets.entries()) {
    const providerId = index === 0 ? email.id : `${email.id}:${target.businessId}`;
    const { data: existing } = await supabaseAdmin.from("email_messages").select("id").eq("provider_id", providerId).maybeSingle();
    if (existing) continue;
    const found = await findThread(target.businessId, ids, baseSubject(subject), sender.email);
    const leadId = found?.lead_id ?? (await leadIdForEmail(target.businessId, [sender.email]));
    const threadId = found?.id ?? (await createThread(target.businessId, baseSubject(subject), [sender.email], leadId));
    if (found && !found.lead_id && leadId) await db().from("email_threads").update({ lead_id: leadId }).eq("id", threadId);
    const attachments = await storeFiles(target.businessId, files);
    const { error } = await db().from("email_messages").insert({
      business_id: target.businessId,
      thread_id: threadId,
      lead_id: leadId,
      direction: "in",
      from_email: sender.email,
      from_name: sender.name,
      to_email: inboxAddress(target.localPart),
      to_emails: to,
      cc_emails: cc,
      subject: subject || null,
      body_text: text,
      body_html: html,
      message_id: email.message_id ?? null,
      in_reply_to: header(email, "in-reply-to"),
      references_header: header(email, "references"),
      provider_id: providerId,
      attachments,
    });
    if (error) {
      if (error.code === "23505") continue;
      throw new Error(error.message);
    }
    stored += 1;
    // A new email brings an archived conversation back to the inbox.
    await db().from("email_threads").update({ archived_at: null }).eq("id", threadId);
    await refreshThread(threadId);
    if (leadId) {
      await supabaseAdmin.from("leads").update({ status: "customer_replied" } as never)
        .eq("id", leadId).eq("business_id", target.businessId)
        .not("status", "in", "(completed,scheduled,quote_sent,opted_out,invalid,customer_replied,new)")
        .then(() => undefined, () => undefined);
    }
  }
  return { stored };
}

/* ---------- Reading ---------- */

export type InboxItem = {
  key: string;
  kind: "mail" | "campaign";
  id: string;
  subject: string;
  name: string;
  email: string | null;
  snippet: string;
  lastAt: string;
  lastFromThem: boolean;
  unread: number;
  messages: number;
  leadId: string | null;
  hasAttachments: boolean;
  campaignId: string | null;
  campaignName: string | null;
  archived: boolean;
};

type ThreadRow = {
  id: string; subject: string; participants: string[]; last_message_at: string; last_snippet: string; last_direction: "in" | "out";
  last_from: string | null; message_count: number; unread_count: number; has_attachments: boolean; lead_id: string | null; archived_at: string | null;
};

export async function listInbox(
  businessId: string,
  input: { folder: InboxFolder; q?: string | null | undefined; unreadOnly?: boolean | undefined; limit?: number | undefined },
): Promise<{ setupMissing: boolean; items: InboxItem[]; more: boolean }> {
  const { listReplyThreads } = await import("@/lib/email-inbound.server");
  const limit = Math.min(Math.max(input.limit ?? 60, 10), 300);
  const term = searchTerm(input.q);
  let setupMissing = false;
  let mail: InboxItem[] = [];

  if (input.folder !== "campaigns") {
    let query = db().from("email_threads")
      .select("id, subject, participants, last_message_at, last_snippet, last_direction, last_from, message_count, unread_count, has_attachments, lead_id, archived_at")
      .eq("business_id", businessId).order("last_message_at", { ascending: false }).limit(limit + 1);
    if (input.folder === "inbox") query = query.is("archived_at", null).eq("has_inbound", true);
    if (input.folder === "sent") query = query.eq("has_outbound", true);
    if (input.folder === "archived") query = query.not("archived_at", "is", null);
    if (input.unreadOnly) query = query.gt("unread_count", 0);
    if (term) {
      const { data: hits } = await db().from("email_messages").select("thread_id").eq("business_id", businessId).not("thread_id", "is", null)
        .or(`subject.ilike.%${term}%,body_text.ilike.%${term}%,from_email.ilike.%${term}%,from_name.ilike.%${term}%,to_email.ilike.%${term}%`)
        .order("created_at", { ascending: false }).limit(300);
      const ids = [...new Set(((hits ?? []) as { thread_id: string }[]).map((h) => h.thread_id))];
      query = ids.length ? query.or(`subject.ilike.%${term}%,id.in.(${ids.join(",")})`) : query.ilike("subject", `%${term}%`);
    }
    const { data, error } = await query;
    if (inboxTablesMissing(error)) setupMissing = true;
    else if (error) throw new Error("Could not load your inbox.");
    const rows = (data ?? []) as ThreadRow[];
    const leadNames = await namesForLeads(businessId, rows.map((r) => r.lead_id));
    mail = rows.map((r) => ({
      key: `mail:${r.id}`,
      kind: "mail" as const,
      id: r.id,
      subject: r.subject || "(no subject)",
      name: (r.lead_id ? leadNames.get(r.lead_id) : null) ?? (r.last_direction === "in" && r.last_from ? r.last_from : (r.participants[0] ?? "Unknown")),
      email: r.participants[0] ?? null,
      snippet: r.last_snippet,
      lastAt: r.last_message_at,
      lastFromThem: r.last_direction === "in",
      unread: r.unread_count,
      messages: r.message_count,
      leadId: r.lead_id,
      hasAttachments: r.has_attachments,
      campaignId: null,
      campaignName: null,
      archived: Boolean(r.archived_at),
    }));
  }

  let campaign: InboxItem[] = [];
  if (input.folder === "inbox" || input.folder === "campaigns") {
    const replies = await listReplyThreads(businessId);
    let matching: Set<string> | null = null;
    if (term) {
      const { data: hits } = await supabaseAdmin.from("email_messages").select("recipient_id").eq("business_id", businessId).not("recipient_id", "is", null)
        .or(`subject.ilike.%${term}%,body_text.ilike.%${term}%,from_email.ilike.%${term}%,from_name.ilike.%${term}%`).limit(300);
      matching = new Set((hits ?? []).map((h) => h.recipient_id as string));
    }
    const lower = term.toLowerCase();
    campaign = replies.threads
      .filter((t) => !input.unreadOnly || t.unread > 0)
      .filter((t) => !term || matching!.has(t.recipientId) || [t.customerName, t.customerEmail, t.campaignName].some((v) => (v ?? "").toLowerCase().includes(lower)))
      .map((t) => ({
        key: `campaign:${t.recipientId}`,
        kind: "campaign" as const,
        id: t.recipientId,
        subject: t.campaignSubject ? `Re: ${t.campaignSubject}` : "Campaign reply",
        name: t.customerName ?? t.customerEmail,
        email: t.customerEmail,
        snippet: t.lastMessage,
        lastAt: t.lastAt,
        lastFromThem: t.lastFromCustomer,
        unread: t.unread,
        messages: t.messages,
        leadId: t.leadId,
        hasAttachments: false,
        campaignId: t.campaignId,
        campaignName: t.campaignName,
        archived: false,
      }));
  }

  const all = [...mail, ...campaign].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return { setupMissing, items: all.slice(0, limit), more: all.length > limit };
}

async function namesForLeads(businessId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean) as string[])];
  if (!list.length) return new Map();
  const { data } = await supabaseAdmin.from("leads").select("id, name").eq("business_id", businessId).in("id", list);
  return new Map((data ?? []).filter((l) => l.name).map((l) => [l.id as string, l.name as string]));
}

async function loadThreadRow(businessId: string, threadId: string): Promise<ThreadRow> {
  const { data, error } = await db().from("email_threads")
    .select("id, subject, participants, last_message_at, last_snippet, last_direction, last_from, message_count, unread_count, has_attachments, lead_id, archived_at")
    .eq("id", threadId).eq("business_id", businessId).maybeSingle();
  if (inboxTablesMissing(error)) throw new Error("The inbox is waiting for a database update (docs/email-inbox.sql).");
  if (!data) throw new Error("That conversation was not found.");
  return data as ThreadRow;
}

type MessageRow = {
  id: string; direction: "in" | "out"; from_email: string; from_name: string | null; to_email: string; to_emails: string[]; cc_emails: string[]; bcc_emails: string[];
  subject: string | null; body_text: string; body_html: string | null; message_id: string | null; references_header: string | null; status: string; created_at: string; read_at: string | null; attachments: unknown;
};
const MESSAGE_COLUMNS = "id, direction, from_email, from_name, to_email, to_emails, cc_emails, bcc_emails, subject, body_text, body_html, message_id, references_header, status, created_at, read_at, attachments";

export async function getInboxThread(businessId: string, threadId: string) {
  const thread = await loadThreadRow(businessId, threadId);
  const [{ data, error }, mailbox, lead] = await Promise.all([
    db().from("email_messages").select(MESSAGE_COLUMNS).eq("business_id", businessId).eq("thread_id", threadId).order("created_at", { ascending: true }).limit(200),
    getMailbox(businessId),
    thread.lead_id ? supabaseAdmin.from("leads").select("id, name, email").eq("id", thread.lead_id).eq("business_id", businessId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (error) throw new Error("Could not load the conversation.");
  const rows = (data ?? []) as MessageRow[];
  const messages = await Promise.all(rows.map(async (m) => ({
    id: m.id,
    direction: m.direction,
    fromEmail: m.from_email,
    fromName: m.from_name,
    to: m.to_emails?.length ? m.to_emails : [m.to_email],
    cc: m.cc_emails ?? [],
    bcc: m.direction === "out" ? (m.bcc_emails ?? []) : [],
    subject: m.subject,
    bodyText: m.body_text,
    bodyHtml: m.body_html,
    status: m.status,
    createdAt: m.created_at,
    read: m.direction === "out" || Boolean(m.read_at),
    attachments: await signedAttachments(businessId, readAttachments(m.attachments)),
  })));
  return {
    id: thread.id,
    subject: thread.subject || "(no subject)",
    participants: thread.participants,
    archived: Boolean(thread.archived_at),
    lead: lead.data ? { id: lead.data.id as string, name: (lead.data.name as string | null) ?? null, email: (lead.data.email as string | null) ?? null } : null,
    mailbox: mailbox.mailbox,
    messages,
  };
}

async function signedAttachments(businessId: string, list: StoredAttachment[]) {
  return Promise.all(list.map(async (a) => {
    if (!attachmentBelongsTo(a.path, businessId)) return { ...a, url: null as string | null };
    const { data } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).createSignedUrl(a.path, 60 * 60, { download: a.name });
    return { ...a, url: data?.signedUrl ?? null };
  }));
}

export async function setThreadRead(businessId: string, threadId: string, read: boolean) {
  await loadThreadRow(businessId, threadId);
  const now = new Date().toISOString();
  if (read) {
    await db().from("email_messages").update({ read_at: now }).eq("business_id", businessId).eq("thread_id", threadId).eq("direction", "in").is("read_at", null);
  } else {
    // Marking unread flags the latest email from them, like a mail app.
    const { data } = await db().from("email_messages").select("id").eq("business_id", businessId).eq("thread_id", threadId).eq("direction", "in").order("created_at", { ascending: false }).limit(1);
    const id = (data?.[0] as { id?: string } | undefined)?.id;
    if (id) await db().from("email_messages").update({ read_at: null }).eq("id", id).eq("business_id", businessId);
  }
  await refreshThread(threadId);
  return { ok: true };
}

export async function setThreadArchived(businessId: string, threadId: string, archived: boolean) {
  await loadThreadRow(businessId, threadId);
  await db().from("email_threads").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", threadId).eq("business_id", businessId);
  return { ok: true };
}

export async function linkThreadLead(businessId: string, threadId: string, leadId: string | null) {
  await loadThreadRow(businessId, threadId);
  if (leadId) {
    const { data } = await supabaseAdmin.from("leads").select("id").eq("id", leadId).eq("business_id", businessId).is("deleted_at", null).maybeSingle();
    if (!data) throw new Error("That customer was not found.");
  }
  await db().from("email_threads").update({ lead_id: leadId }).eq("id", threadId).eq("business_id", businessId);
  await db().from("email_messages").update({ lead_id: leadId }).eq("thread_id", threadId).eq("business_id", businessId);
  return { ok: true };
}

/** Customers to link a conversation to, or to email: by name or email. */
export async function findLeadsForInbox(businessId: string, q: string, leadId?: string | null) {
  const term = searchTerm(q);
  let query = supabaseAdmin.from("leads").select("id, name, email").eq("business_id", businessId).is("deleted_at", null).order("created_at", { ascending: false }).limit(8);
  if (leadId) query = query.eq("id", leadId);
  else if (term) query = query.or(`name.ilike.%${term}%,email.ilike.%${term}%`);
  const { data } = await query;
  return (data ?? []).map((l) => ({ id: l.id as string, name: (l.name as string | null) ?? null, email: (l.email as string | null) ?? null }));
}

/** Inbox conversations with one lead, for the lead page. */
export async function leadInboxThreads(businessId: string, leadId: string) {
  const { data, error } = await db().from("email_threads").select("id, subject, last_message_at, last_snippet, last_direction, unread_count, message_count")
    .eq("business_id", businessId).eq("lead_id", leadId).order("last_message_at", { ascending: false }).limit(20);
  if (error) return [];
  return ((data ?? []) as { id: string; subject: string; last_message_at: string; last_snippet: string; last_direction: string; unread_count: number; message_count: number }[]).map((t) => ({
    id: t.id, subject: t.subject || "(no subject)", lastAt: t.last_message_at, snippet: t.last_snippet, lastFromThem: t.last_direction === "in", unread: t.unread_count, messages: t.message_count,
  }));
}

/* ---------- Attachments the owner adds ---------- */

export async function uploadAttachment(businessId: string, input: { name: string; type: string; dataBase64: string }): Promise<StoredAttachment> {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(Buffer.from(input.dataBase64, "base64")); } catch { throw new Error("That file could not be read."); }
  const problem = attachmentProblem(input.name, bytes.byteLength);
  if (problem) throw new Error(problem);
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(input.type) ? input.type : "application/octet-stream";
  const path = attachmentPathFor(businessId, input.name);
  const { error } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error("The file could not be uploaded.");
  return { path, name: safeFileName(input.name), type, size: bytes.byteLength };
}

/* ---------- Sending ---------- */

export type SendInput = {
  businessId: string;
  mode: "new" | "reply" | "reply_all" | "forward";
  threadId?: string | null | undefined;
  /** The message being answered or forwarded (defaults to the latest). */
  messageId?: string | null | undefined;
  to: string[];
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | null | undefined;
  bodyText: string;
  attachments?: StoredAttachment[] | undefined;
  /** Forwarding sends the original's files too unless turned off. */
  includeOriginalAttachments?: boolean | undefined;
  leadId?: string | null | undefined;
};

/** What a reply, reply-all or forward starts with, for the composer. */
export async function draftFor(businessId: string, input: { threadId: string; messageId?: string | null | undefined; mode: "reply" | "reply_all" | "forward" }) {
  const mailbox = await requireMailbox(businessId);
  const parent = await parentMessage(businessId, input.threadId, input.messageId ?? null);
  const own = [mailbox.address];
  if (input.mode === "forward") {
    return { to: [] as string[], cc: [] as string[], subject: forwardSubject(parent.subject), attachments: readAttachments(parent.attachments) };
  }
  const { to, cc } = replyRecipients({ direction: parent.direction, from_email: parent.from_email, to_emails: parent.to_emails ?? [], cc_emails: parent.cc_emails ?? [] }, own, input.mode === "reply_all");
  return { to, cc, subject: replySubject(parent.subject), attachments: [] as StoredAttachment[] };
}

async function parentMessage(businessId: string, threadId: string, messageId: string | null): Promise<MessageRow> {
  await loadThreadRow(businessId, threadId);
  let query = db().from("email_messages").select(MESSAGE_COLUMNS).eq("business_id", businessId).eq("thread_id", threadId);
  query = messageId ? query.eq("id", messageId) : query.order("created_at", { ascending: false }).limit(1);
  const { data } = await query;
  const row = (data?.[0] ?? null) as MessageRow | null;
  if (!row) throw new Error("That email was not found.");
  return row;
}

export async function sendInboxEmail(input: SendInput): Promise<{ sent: boolean; duplicate?: boolean; threadId: string }> {
  const { sendEmailViaResend } = await import("@/lib/email-campaigns.server");
  const mailbox = await requireMailbox(input.businessId);
  const to = parseAddressList(input.to);
  const cc = parseAddressList(input.cc ?? []);
  const bcc = parseAddressList(input.bcc ?? []);
  const invalid = [...to.invalid, ...cc.invalid, ...bcc.invalid];
  if (invalid.length) throw new Error(`Check these addresses: ${invalid.slice(0, 3).join(", ")}`);
  if (!to.emails.length) throw new Error("Add at least one recipient.");
  if (to.emails.length + cc.emails.length + bcc.emails.length > MAX_RECIPIENTS) throw new Error(`Send to at most ${MAX_RECIPIENTS} people at once. For more, use a campaign.`);
  const body = input.bodyText.replace(/\r\n/g, "\n").trim();
  if (body.length < 1 || body.length > 20_000) throw new Error("Write a message of up to 20,000 characters.");

  const parent = input.mode !== "new" && input.threadId ? await parentMessage(input.businessId, input.threadId, input.messageId ?? null) : null;
  if (input.mode !== "new" && !parent) throw new Error("Choose the email to answer.");

  const files = [...(input.attachments ?? [])];
  if (input.mode === "forward" && parent && input.includeOriginalAttachments !== false) {
    for (const a of readAttachments(parent.attachments)) if (!files.some((f) => f.path === a.path)) files.push(a);
  }
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Attach at most ${MAX_ATTACHMENTS} files.`);
  if (files.some((f) => !attachmentBelongsTo(f.path, input.businessId))) throw new Error("An attachment could not be found.");
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("Attachments must be 20 MB or less in total.");

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db().from("email_messages").select("id", { count: "exact", head: true })
    .eq("business_id", input.businessId).eq("direction", "out").not("thread_id", "is", null).gte("created_at", since);
  if ((count ?? 0) >= DAILY_SEND_LIMIT) throw new Error(`You've sent ${DAILY_SEND_LIMIT} emails in the last 24 hours. For more, use a campaign.`);

  // A double click (or two people pressing Send) must not email anyone twice.
  const twoMinutesAgo = new Date(Date.now() - 2 * 60_000).toISOString();
  let recent = db().from("email_messages").select("id, thread_id, body_text, to_emails").eq("business_id", input.businessId).eq("direction", "out").gte("created_at", twoMinutesAgo).limit(20);
  if (input.threadId) recent = recent.eq("thread_id", input.threadId);
  const { data: recentRows } = await recent;
  const dup = ((recentRows ?? []) as { thread_id: string | null; body_text: string; to_emails: string[] }[])
    .find((r) => r.thread_id && r.body_text.startsWith(body) && (r.to_emails ?? []).join(",") === to.emails.join(","));
  if (dup) return { sent: false, duplicate: true, threadId: dup.thread_id! };

  const { businessName, branding, timeZone } = await loadBusiness(input.businessId);
  const fromName = cleanDisplayName(mailbox.displayName ?? businessName) || mailbox.localPart;
  const signature = mailbox.signature?.trim();
  const ownText = signature ? `${body}\n\n${signature}` : body;
  const quote = parent && input.mode !== "new" ? quotedBlock(input.mode === "forward" ? "forward" : "reply", parent, timeZone) : null;
  const storedText = input.mode === "forward" && quote ? `${ownText}\n\n${quote}` : ownText;
  const emailText = quote ? `${ownText}\n\n${quote}` : ownText;
  const subject = (input.subject?.trim() || (parent ? (input.mode === "forward" ? forwardSubject(parent.subject) : replySubject(parent.subject)) : "")).slice(0, 200);
  if (!subject) throw new Error("Add a subject.");

  const messageId = `<${crypto.randomUUID()}@${INBOX_DOMAIN}>`;
  const answering = parent && input.mode !== "forward";
  const references = answering ? referencesFor(parent.references_header, parent.message_id) : null;
  const headers: Record<string, string> = { "Message-ID": messageId };
  if (answering && parent.message_id) headers["In-Reply-To"] = parent.message_id;
  if (references) headers["References"] = references;

  const signed = await Promise.all(files.map(async (f) => {
    const { data } = await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).createSignedUrl(f.path, 60 * 60);
    if (!data?.signedUrl) throw new Error(`${f.name} could not be attached.`);
    return { filename: f.name, path: data.signedUrl, content_type: f.type };
  }));

  const brand = { businessName, ...branding };
  const payload = {
    from: `${fromName} <${mailbox.address}>`,
    to: to.emails,
    cc: cc.emails,
    bcc: bcc.emails,
    subject,
    html: renderEmailHtml(brand, { bodyText: emailText }),
    text: renderEmailText(brand, { bodyText: emailText }),
    attachments: signed,
  };
  let storedMessageId: string | null = messageId;
  let result: { id: string | null };
  try {
    result = await sendEmailViaResend({ ...payload, headers });
  } catch (error) {
    // If the provider refuses our own Message-ID, send without it; replies then thread by subject and sender.
    if (!(error instanceof Error && /\((400|422)\)/.test(error.message))) throw error;
    const { "Message-ID": _ownId, ...rest } = headers;
    storedMessageId = null;
    result = await sendEmailViaResend({ ...payload, headers: rest });
  }

  const others = [...to.emails, ...cc.emails];
  let threadId = input.threadId ?? null;
  let leadId = input.leadId ?? null;
  if (leadId) {
    const { data } = await supabaseAdmin.from("leads").select("id").eq("id", leadId).eq("business_id", input.businessId).is("deleted_at", null).maybeSingle();
    if (!data) leadId = null;
  }
  if (threadId) {
    const thread = await loadThreadRow(input.businessId, threadId);
    leadId = thread.lead_id ?? leadId ?? (await leadIdForEmail(input.businessId, others));
    if (!thread.lead_id && leadId) await db().from("email_threads").update({ lead_id: leadId }).eq("id", threadId);
  } else {
    leadId = leadId ?? (await leadIdForEmail(input.businessId, others));
    threadId = await createThread(input.businessId, baseSubject(subject), others, leadId);
  }
  await db().from("email_messages").insert({
    business_id: input.businessId,
    thread_id: threadId,
    lead_id: leadId,
    direction: "out",
    from_email: mailbox.address,
    from_name: fromName,
    to_email: to.emails[0],
    to_emails: to.emails,
    cc_emails: cc.emails,
    bcc_emails: bcc.emails,
    subject,
    body_text: storedText,
    message_id: storedMessageId,
    in_reply_to: answering ? parent.message_id : null,
    references_header: references,
    provider_id: result.id,
    status: "sent",
    read_at: new Date().toISOString(),
    attachments: files,
  });
  // Answering a conversation means it has been read.
  await db().from("email_messages").update({ read_at: new Date().toISOString() }).eq("business_id", input.businessId).eq("thread_id", threadId).eq("direction", "in").is("read_at", null);
  await refreshThread(threadId);
  return { sent: true, threadId };
}
