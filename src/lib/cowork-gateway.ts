/**
 * Co-Work gateways as plain rules (no database here): the owner messages
 * Co-Work by text, email or Telegram, and Co-Work answers in the same place.
 *
 * A gateway turn reads and prepares, like a routine: the person is there, but
 * a text or email is easier to fake than a signed-in session, so anything that
 * sends, posts, books or changes waits for them to tap Confirm in Co-Work.
 * Answers always go back to the verified number, address or chat, never to
 * whoever wrote, so a faked sender learns nothing.
 */
import { countSegments } from "@/lib/sms/segments";
import { ROUTINE_TOOLS } from "@/lib/cowork-routines";

export const GATEWAY_CHANNELS = ["sms", "email", "telegram"] as const;
export type GatewayChannel = (typeof GATEWAY_CHANNELS)[number];

export const GATEWAY_LABEL: Record<GatewayChannel, string> = { sms: "Text message", email: "Email", telegram: "Telegram" };

/** Messages per person per channel per day (a loop or a stuck phone can't run up credits). */
export const GATEWAY_DAILY_LIMIT = 40;
/** How much of one message Co-Work reads. */
export const GATEWAY_MESSAGE_MAX = 2000;
/** SMS answers stay within three parts. */
export const SMS_REPLY_SEGMENTS = 3;
/** Telegram's own limit is 4096 characters. */
export const TELEGRAM_REPLY_MAX = 3900;
/** Verification codes. */
export const CODE_TTL_MS = 15 * 60_000;
export const CODE_RESEND_MS = 60_000;
export const CODE_ATTEMPTS = 5;
/** A turn still "running" after this was interrupted; it is never run again. */
export const GATEWAY_STALE_MS = 5 * 60_000;

export const EMAIL_DOMAIN = "bookedsecure.com";

/** Tools a gateway turn may use: a routine's (reading and preparing) plus remembering and routine lists. */
export const GATEWAY_TOOLS: ReadonlySet<string> = new Set([...ROUTINE_TOOLS, "remember", "list_routines"]);

export function gatewayTools<T extends Record<string, unknown>>(all: T): Partial<T> {
  return Object.fromEntries(Object.entries(all).filter(([name]) => GATEWAY_TOOLS.has(name))) as Partial<T>;
}

/** What Co-Work is told with a message that came in through a gateway. */
export function gatewayRequest(channel: GatewayChannel, text: string): string {
  const how =
    channel === "sms"
      ? "by text message from their verified phone. Answer in plain text (no markdown, lists or tables), as short as a text: a sentence or two, the key figures first."
      : channel === "email"
        ? "by email from their verified address. Answer in plain text paragraphs (no markdown or tables)."
        : "on Telegram from their linked chat. Answer in plain text (no markdown or tables), short and easy to read on a phone.";
  return [
    `[The owner is messaging you ${how} You can read their records and prepare drafts or Confirm cards; anything that sends, posts, books or changes waits for them to tap Confirm in Co-Work, so say it is ready there (the link is added for you).]`,
    text.trim().slice(0, GATEWAY_MESSAGE_MAX),
  ].join("\n");
}

/** Markdown and tables to plain text for a phone. */
export function plainText(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|[.,!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}[-:| \t]*(\n|$)/gm, "")
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_m, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(", "))
    .replace(/^[ \t]*[-*•][ \t]+/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * An answer that fits a few SMS parts. When it is cut, or something waits for
 * a yes, the Co-Work link goes at the end.
 */
export function fitSms(answer: string, link: string, opts: { needsLink?: boolean; maxSegments?: number } = {}): string {
  const max = opts.maxSegments ?? SMS_REPLY_SEGMENTS;
  const flat = plainText(answer).replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
  const withLink = (body: string) => `${body} ${link}`.trim();
  if (!opts.needsLink && countSegments(flat).segments <= max) return flat;
  if (countSegments(withLink(flat)).segments <= max) return withLink(flat);
  let words = flat.split(" ");
  while (words.length > 1) {
    words = words.slice(0, Math.max(1, Math.floor(words.length * 0.9)));
    const cut = `${words.join(" ").replace(/[,.;:]$/, "")}… More:`;
    if (countSegments(withLink(cut)).segments <= max) return withLink(cut);
  }
  return withLink("Your answer is ready in Co-Work:");
}

export function fitTelegram(answer: string, link: string, needsLink: boolean): string {
  const text = plainText(answer);
  const tail = needsLink ? `\n\nReady for your yes in Co-Work: ${link}` : "";
  if (text.length + tail.length <= TELEGRAM_REPLY_MAX) return `${text}${tail}`;
  const more = `…\n\nThe rest is in Co-Work: ${link}`;
  return `${text.slice(0, TELEGRAM_REPLY_MAX - more.length).trimEnd()}${more}`;
}

/** Words that pause a text gateway (the owner can switch it back on in Co-Work). */
export function isPauseWord(text: string): boolean {
  return /^\s*(stop|pause|unsubscribe|stopall|cancel|end|quit)\s*[.!]?\s*$/i.test(text);
}

/** A Telegram command at the start of a message: /start CODE, /new, /stop, /help. */
export function telegramCommand(text: string): { command: "start" | "new" | "stop" | "help"; arg: string } | null {
  const m = /^\/(start|new|stop|help)(?:@\w+)?(?:\s+(\S+))?/i.exec(text.trim());
  return m ? { command: m[1]!.toLowerCase() as "start" | "new" | "stop" | "help", arg: m[2] ?? "" } : null;
}

/** The secret address an owner writes to: cowork-<token>@bookedsecure.com. */
export function gatewayEmailAddress(token: string): string {
  return `cowork-${token}@${EMAIL_DOMAIN}`;
}

/** The token of the first gateway address among the recipients, if any. */
export function gatewayTokenFrom(addresses: readonly string[]): string | null {
  for (const raw of addresses) {
    const m = /cowork-([a-z0-9]{16,40})@bookedsecure\.com/i.exec(raw);
    if (m) return m[1]!.toLowerCase();
  }
  return null;
}

/** Automatic mail (out of office, bounces, lists) is never answered, so two robots can't write to each other. */
export function isAutomaticEmail(from: string, headers: Record<string, string> | null | undefined): boolean {
  const h = Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["x-auto-response-suppress"] === "all" || h["list-id"] || h["list-unsubscribe"]) return true;
  if (["bulk", "junk", "list", "auto_reply"].includes(h["precedence"] ?? "")) return true;
  return /(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from);
}

/** A random lower-case token (base 32) of the given length. */
export function randomToken(length = 24): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** A six-digit verification code. */
export function randomCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function hashCode(gatewayId: string, code: string): Promise<string> {
  const data = new TextEncoder().encode(`${gatewayId}:${code.trim()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two secrets without leaking how much of them matched. */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
