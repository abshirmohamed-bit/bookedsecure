/**
 * Pure helpers for the email inbox (Campaigns → Inbox).
 *
 * Each business gets its own address <name>@bookedsecure.com. The root domain
 * already receives through Resend and is verified for sending, so mail to
 * that address comes in on the same webhook as campaign replies.
 */
import { PLATFORM_DOMAIN, PLATFORM_MAILBOXES, parseAddress } from "@/lib/email-inbound";
import { EMAIL_RE } from "@/lib/email-campaigns";

export const INBOX_DOMAIN = PLATFORM_DOMAIN;

/** Names BookedSecure uses itself, or that would look official, which no business can take. */
export const RESERVED_LOCAL_PARTS = new Set<string>([
  ...PLATFORM_MAILBOXES,
  "campaigns", "bookings", "booking", "noreply", "no-reply", "donotreply", "do-not-reply", "reply", "replies",
  "postmaster", "abuse", "security", "billing", "accounts", "account", "payments", "team", "mail", "email",
  "inbox", "www", "root", "webmaster", "hostmaster", "privacy", "legal", "sales", "contact", "help", "office",
  "bookedsecure", "booked-secure", "api", "app", "test", "notifications", "alerts", "verify", "verification",
  "owner", "staff", "system", "daemon", "mailer-daemon", "dmarc", "send", "rsend", "news", "newsletter",
]);

/** Lower-case, mailbox-safe version of what the owner typed. */
export function normaliseLocalPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/@.*$/, "")
    .normalize("NFKD")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/[-.]{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40)
    .replace(/[-.]+$/g, "");
}

/** Why a chosen name can't be used, or null when it can. */
export function localPartProblem(localPart: string): string | null {
  if (localPart.length < 3) return "Use at least 3 letters or numbers.";
  if (!/^[a-z0-9]([a-z0-9.-]{0,38}[a-z0-9])?$/.test(localPart)) return "Use letters, numbers, dots and dashes only.";
  if (RESERVED_LOCAL_PARTS.has(localPart) || /^co-?work/.test(localPart)) return "That name is kept for BookedSecure. Try your business name.";
  return null;
}

export function inboxAddress(localPart: string): string {
  return `${localPart}@${INBOX_DOMAIN}`;
}

/**
 * The business mailbox names (local parts) among the addresses an email was
 * sent to. Plus tags (glocast+quotes@) go to the same mailbox. BookedSecure's
 * own mailboxes and reserved names are never a business mailbox.
 */
export function mailboxLocalPartsFrom(addresses: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of addresses) {
    const email = parseAddress(raw ?? "").email;
    const at = email.lastIndexOf("@");
    if (at < 1 || email.slice(at + 1) !== INBOX_DOMAIN) continue;
    const local = email.slice(0, at).split("+")[0]!;
    if (!local || RESERVED_LOCAL_PARTS.has(local) || localPartProblem(local)) continue;
    if (!out.includes(local)) out.push(local);
  }
  return out;
}

/** "Re: Fwd: RE: Quote" → "Quote", for matching a reply to its thread. */
export function baseSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").trim();
  for (;;) {
    const next = s.replace(/^(re|fw|fwd|aw|sv|antw|wg)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  return s.replace(/\s+/g, " ").trim();
}

export function replySubject(subject: string | null | undefined): string {
  const base = baseSubject(subject);
  return (base ? `Re: ${base}` : "Re: (no subject)").slice(0, 200);
}

export function forwardSubject(subject: string | null | undefined): string {
  const base = baseSubject(subject);
  return (base ? `Fwd: ${base}` : "Fwd: (no subject)").slice(0, 200);
}

/**
 * "Jess <jess@x.com>, sam@y.com; bad" → valid, de-duplicated, lower-case
 * addresses plus whatever couldn't be read.
 */
export function parseAddressList(value: string | string[] | null | undefined): { emails: string[]; invalid: string[] } {
  const parts = (Array.isArray(value) ? value : [value ?? ""]).flatMap((v) => v.split(/[,;\n]+/));
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const { email } = parseAddress(trimmed);
    if (EMAIL_RE.test(email) && email.length <= 254) {
      if (!emails.includes(email)) emails.push(email);
    } else invalid.push(trimmed);
  }
  return { emails, invalid };
}

/** Message ids from In-Reply-To and References headers, e.g. "<a@x> <b@y>". */
export function messageIdsFrom(...headers: (string | null | undefined)[]): string[] {
  const ids: string[] = [];
  for (const header of headers) {
    for (const match of (header ?? "").matchAll(/<[^<>\s]+>/g)) if (!ids.includes(match[0])) ids.push(match[0]);
  }
  return ids;
}

/** The References header for a reply: the parent's references plus the parent itself (last 20). */
export function referencesFor(parentReferences: string | null | undefined, parentMessageId: string | null | undefined): string | null {
  const ids = messageIdsFrom(parentReferences, parentMessageId);
  return ids.length ? ids.slice(-20).join(" ") : null;
}

/** Who a reply / reply-all goes to, never including the business's own address. */
export function replyRecipients(
  message: { direction: "in" | "out"; from_email: string; to_emails: string[]; cc_emails: string[] },
  own: string[],
  all: boolean,
): { to: string[]; cc: string[] } {
  const mine = new Set(own.map((e) => e.toLowerCase()));
  const keep = (list: string[]) => [...new Set(list.map((e) => e.toLowerCase()))].filter((e) => !mine.has(e));
  const to = message.direction === "in" ? keep([message.from_email]) : keep(message.to_emails);
  if (!all) return { to, cc: [] };
  const extra = message.direction === "in" ? [...message.to_emails, ...message.cc_emails] : message.cc_emails;
  const cc = keep(extra).filter((e) => !to.includes(e));
  return { to, cc };
}

/** Plain-text quote of an earlier message, added under a reply or forward. */
export function quotedBlock(
  kind: "reply" | "forward",
  message: { from_email: string; from_name: string | null; to_emails: string[]; subject: string | null; created_at: string; body_text: string },
  timeZone?: string,
): string {
  const when = formatWhen(message.created_at, timeZone);
  const who = message.from_name ? `${message.from_name} <${message.from_email}>` : message.from_email;
  const body = message.body_text.trim().slice(0, 20_000);
  if (kind === "forward") {
    return [
      "---------- Forwarded message ---------",
      `From: ${who}`,
      `Date: ${when}`,
      `Subject: ${message.subject ?? "(no subject)"}`,
      message.to_emails.length ? `To: ${message.to_emails.join(", ")}` : null,
      "",
      body,
    ].filter((l) => l !== null).join("\n");
  }
  return `On ${when}, ${who} wrote:\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`;
}

function formatWhen(iso: string, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** One line for the thread list. */
export function snippetOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

/* ---------- Attachments ---------- */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_RECIPIENTS = 20;
/** Emails a business can send from its inbox in 24 hours (protects the shared sending domain). */
export const DAILY_SEND_LIMIT = 200;

export type StoredAttachment = { path: string; name: string; type: string; size: number };

/** Types never sent or kept, because mail clients and filters treat them as malware. */
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|scr|pif|msi|vbs|vbe|js|jse|wsf|wsh|ps1|jar|lnk|hta|cpl|reg|dll)$/i;

export function attachmentProblem(name: string, size: number): string | null {
  if (!name.trim()) return "Each attachment needs a file name.";
  if (BLOCKED_EXTENSIONS.test(name.trim())) return `${name} can't be attached: programs and scripts are blocked by email providers.`;
  if (size <= 0) return `${name} is empty.`;
  if (size > MAX_ATTACHMENT_BYTES) return `${name} is over 10 MB.`;
  return null;
}

/** A file name safe for a storage path and a Content-Disposition header. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ()]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(-120);
  return cleaned || "attachment";
}

/** Storage paths for attachments always sit in the business's own mail folder. */
export const ATTACHMENT_PATH = /^[0-9a-f-]{36}\/mail\/[0-9a-f-]{36}\/[\w.\- ()]{1,120}$/;
export function attachmentPathFor(businessId: string, name: string): string {
  return `${businessId}/mail/${crypto.randomUUID()}/${safeFileName(name)}`;
}
export function attachmentBelongsTo(path: string, businessId: string): boolean {
  return ATTACHMENT_PATH.test(path) && path.startsWith(`${businessId}/mail/`);
}

export function readAttachments(value: unknown): StoredAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const r = a as Record<string, unknown>;
    if (typeof r["path"] !== "string" || typeof r["name"] !== "string") return [];
    return [{ path: r["path"], name: r["name"], type: typeof r["type"] === "string" ? r["type"] : "application/octet-stream", size: typeof r["size"] === "number" ? r["size"] : 0 }];
  });
}

/* ---------- Showing received HTML safely ---------- */

/**
 * Strips what could run or reach out from a received email's HTML: scripts,
 * frames, forms, event handlers and javascript: links. It is shown in a
 * sandboxed frame with scripts off as well, so this is a second line.
 */
export function sanitizeEmailHtml(html: string): string {
  return html
    .slice(0, 400_000)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|iframe|frame|frameset|object|embed|applet|form|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(script|iframe|frame|frameset|object|embed|applet|form|base|meta|link|input|button|textarea|select|noscript|template)\b[^>]*>/gi, "")
    .replace(/\s(on[a-z]+|formaction|srcdoc)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action|background|poster)\s*=\s*("|')\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1=$2#$2')
    .replace(/(href|src|action|background|poster)\s*=\s*(javascript|vbscript):[^\s>]*/gi, '$1="#"');
}

/** The document shown in the sandboxed frame: links open in a new tab, nothing can run. */
export function emailFrameDocument(html: string): string {
  const csp = "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline'; font-src https: data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0;padding:0;background:#fff;color:#16243b;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${sanitizeEmailHtml(html)}</body></html>`;
}

/* ---------- Thread list ---------- */

export type InboxFolder = "inbox" | "sent" | "campaigns" | "archived";
export const INBOX_FOLDERS: { id: InboxFolder; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "campaigns", label: "Campaign replies" },
  { id: "archived", label: "Archived" },
];

/** Characters PostgREST's or() filter treats as syntax are dropped from searches. */
export function searchTerm(q: string | null | undefined): string {
  return (q ?? "").replace(/[,()%*\\"':]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
