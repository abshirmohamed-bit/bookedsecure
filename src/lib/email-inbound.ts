/**
 * Pure helpers for receiving customer replies to campaign emails.
 *
 * Each campaign email carries a Reply-To of reply+<recipient id>@reply domain,
 * so a reply lands in Resend, comes to our webhook, and is matched to the
 * exact customer and campaign it answers.
 */

export const REPLY_DOMAIN = "reply.bookedsecure.com";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * A mailbox-safe version of the business name, e.g. "glocast-mobile-auto".
 * The part before @ may be at most 64 characters, and "+<recipient id>" takes
 * 37, so the label is capped at 24 (whole words where possible).
 */
export const MAX_LABEL = 24;
export function mailboxLabel(name: string | null | undefined): string {
  const full = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  let label = full;
  if (label.length > MAX_LABEL) {
    const cut = label.slice(0, MAX_LABEL + 1);
    const lastDash = cut.lastIndexOf("-");
    label = (lastDash >= 8 ? cut.slice(0, lastDash) : label.slice(0, MAX_LABEL)).replace(/-+$/g, "");
  }
  return label || "reply";
}

/**
 * The address customers reply to for one campaign recipient, named after the
 * business: glocast-mobile-auto+<recipient id>@reply.bookedsecure.com.
 */
export function replyAddressFor(recipientId: string, businessName?: string | null): string {
  return `${mailboxLabel(businessName)}+${recipientId.toLowerCase()}@${REPLY_DOMAIN}`;
}

/**
 * Reply-To that shows the business name, e.g. Glocast Mobile Auto Detailing <…>.
 * Resend only accepts `Name <email>` with no quotes, so characters that would
 * need quoting (quotes, commas, angle brackets, @, ;, :) are dropped from the name.
 */
export function replyToHeader(recipientId: string, businessName: string | null | undefined): string {
  const display = (businessName ?? "").replace(/["\\<>,;:@()[\]\r\n]/g, "").replace(/\s+/g, " ").trim();
  const address = replyAddressFor(recipientId, businessName);
  return display ? `${display} <${address}>` : address;
}

/** Finds the recipient id in any of the addresses a reply was sent to (any business label). */
export function recipientIdFromAddresses(addresses: (string | null | undefined)[]): string | null {
  const re = new RegExp(`[a-z0-9][a-z0-9-]{0,40}\\+(${UUID})@${REPLY_DOMAIN.replaceAll(".", "\\.")}`, "i");
  for (const address of addresses) {
    const match = (address ?? "").match(re);
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}

/** BookedSecure's own domain, whose public mailboxes are forwarded to the team's inbox. */
export const PLATFORM_DOMAIN = "bookedsecure.com";
export const PLATFORM_MAILBOXES = ["admin", "support", "hello", "info"] as const;
export const DEFAULT_PLATFORM_FORWARD_TO = "bookedsecure@gmail.com";

/**
 * The BookedSecure mailbox (e.g. admin@bookedsecure.com) an email was sent to,
 * or null. Only the root domain counts; reply.bookedsecure.com is for campaign
 * replies, and any other name is ignored.
 */
export function platformMailboxFrom(addresses: (string | null | undefined)[]): string | null {
  for (const raw of addresses) {
    const email = parseAddress(raw ?? "").email;
    const [local, domain] = email.split("@");
    if (domain === PLATFORM_DOMAIN && (PLATFORM_MAILBOXES as readonly string[]).includes(local ?? "")) return email;
  }
  return null;
}

/** "Jess Smith <jess@x.com>" → { name, email }. */
export function parseAddress(value: string | null | undefined): { name: string | null; email: string } {
  const raw = (value ?? "").trim();
  const match = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1]!.trim() || null, email: match[2]!.trim().toLowerCase() };
  return { name: null, email: raw.toLowerCase() };
}

/** Plain text from an HTML email body (used when the reply has no text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Keeps only what the customer wrote: drops the quoted original email
 * ("On … wrote:", "-----Original Message-----", ">" lines) and signatures
 * after "-- ".
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .{4,200}wrote:\s*$/i.test(t)) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(t)) break;
    if (/^From:\s.+/i.test(t) && out.length > 0) break;
    if (/^Sent from my (iPhone|iPad|Android|Samsung|mobile)/i.test(t)) break;
    if (t === "--") break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  const cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned || text.trim();
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Verifies a Resend (Svix) webhook: HMAC-SHA256 over "id.timestamp.body" with
 * the base64 secret after "whsec_", compared against any "v1,<sig>" in the
 * svix-signature header, within five minutes of now.
 */
export async function verifyResendWebhook(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now?: Date;
}): Promise<boolean> {
  if (!input.secret || !input.id || !input.timestamp || !input.signature) return false;
  const ts = Number(input.timestamp);
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const keyBytes = base64ToBytes(input.secret.replace(/^whsec_/, ""));
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${input.id}.${input.timestamp}.${input.body}`));
  const expected = bytesToBase64(mac);
  return input.signature
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => sig.length === expected.length && sig === expected);
}
