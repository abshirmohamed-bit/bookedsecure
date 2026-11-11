// The booking confirmation email: the business's own HTML, filled in per booking.
//
// Pure: no I/O, so the server, the settings preview and the tests share one
// renderer. The owner writes HTML with {{merge fields}}; every value put into
// it is escaped, so a customer named "<b>Sam</b>" cannot change the email.

import { escapeHtml } from "@/lib/email-template";

/** The merge fields an owner can use, with what each becomes. */
export const BOOKING_EMAIL_FIELDS = [
  { key: "name", label: "Customer's name", sample: "Sam Taylor" },
  { key: "first_name", label: "Customer's first name", sample: "Sam" },
  { key: "service", label: "Service booked", sample: "Full detail" },
  { key: "date", label: "Date", sample: "Friday 14 November" },
  { key: "time", label: "Time", sample: "9:30 am" },
  { key: "address", label: "Address", sample: "12 Example Street, Parramatta" },
  { key: "price", label: "Price", sample: "$280" },
  { key: "business_name", label: "Your business name", sample: "Your Business" },
  { key: "business_phone", label: "Your phone number", sample: "0400 000 000" },
] as const;
export type BookingEmailField = (typeof BOOKING_EMAIL_FIELDS)[number]["key"];
export type BookingEmailValues = Record<BookingEmailField, string>;

export const BOOKING_EMAIL_LIMITS = { subject: 200, html: 100_000 } as const;
export const DEFAULT_BOOKING_EMAIL_SUBJECT = "You're booked in: {{service}} on {{date}}";

/** The built-in template: a clean, mobile-friendly card any business can use as it is. */
export const DEFAULT_BOOKING_EMAIL_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Booking confirmed</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0b2a5b;padding:24px 28px;color:#ffffff;font-size:20px;font-weight:bold;">{{business_name}}</td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:bold;">You're booked in, {{first_name}}</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#334155;">Thanks for booking with {{business_name}}. Here are your details.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;">
            <tr><td style="padding:12px 16px;color:#64748b;font-size:13px;width:35%;">Service</td><td style="padding:12px 16px;font-size:15px;font-weight:bold;">{{service}}</td></tr>
            <tr><td style="padding:12px 16px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Date</td><td style="padding:12px 16px;font-size:15px;border-top:1px solid #e2e8f0;">{{date}}</td></tr>
            <tr><td style="padding:12px 16px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Time</td><td style="padding:12px 16px;font-size:15px;border-top:1px solid #e2e8f0;">{{time}}</td></tr>
            <tr><td style="padding:12px 16px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Address</td><td style="padding:12px 16px;font-size:15px;border-top:1px solid #e2e8f0;">{{address}}</td></tr>
            <tr><td style="padding:12px 16px;color:#64748b;font-size:13px;border-top:1px solid #e2e8f0;">Price</td><td style="padding:12px 16px;font-size:15px;border-top:1px solid #e2e8f0;">{{price}}</td></tr>
          </table>
          <p style="margin:20px 0 0;font-size:14px;line-height:1.5;color:#334155;">Need to change anything? Call us on {{business_phone}} or reply to this email.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;">You're receiving this because you booked with {{business_name}}.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

export type BookingEmailSettings = {
  /** Off and no confirmation email goes out for any booking. */
  enabled: boolean;
  subject: string;
  html: string;
  /** Where replies go. Empty means the business owner's sign-in email. */
  replyTo: string;
};

export const DEFAULT_BOOKING_EMAIL: BookingEmailSettings = {
  enabled: true,
  subject: DEFAULT_BOOKING_EMAIL_SUBJECT,
  html: DEFAULT_BOOKING_EMAIL_HTML,
  replyTo: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A stored jsonb value as settings: anything missing or malformed falls back to the built-in. */
export function readBookingEmailSettings(value: unknown): BookingEmailSettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_BOOKING_EMAIL };
  const v = value as Record<string, unknown>;
  const subject = typeof v["subject"] === "string" && v["subject"].trim() ? v["subject"].slice(0, BOOKING_EMAIL_LIMITS.subject) : DEFAULT_BOOKING_EMAIL_SUBJECT;
  const html = typeof v["html"] === "string" && v["html"].trim() ? v["html"].slice(0, BOOKING_EMAIL_LIMITS.html) : DEFAULT_BOOKING_EMAIL_HTML;
  const replyTo = typeof v["replyTo"] === "string" && EMAIL_RE.test(v["replyTo"].trim()) ? v["replyTo"].trim().toLowerCase() : "";
  return { enabled: v["enabled"] !== false, subject, html, replyTo };
}

/** Problems with what the owner wrote, in their words. Empty when it can be saved. */
export function checkBookingEmail(settings: BookingEmailSettings): string[] {
  const problems: string[] = [];
  if (!settings.subject.trim()) problems.push("Give the email a subject.");
  if (settings.subject.length > BOOKING_EMAIL_LIMITS.subject) problems.push("The subject is too long.");
  if (!settings.html.trim()) problems.push("The email has no content.");
  if (settings.html.length > BOOKING_EMAIL_LIMITS.html) problems.push("The email is too long (100,000 characters at most).");
  if (/<script[\s>]/i.test(settings.html)) problems.push("Email can't run scripts: remove the <script> tags.");
  if (settings.replyTo && !EMAIL_RE.test(settings.replyTo)) problems.push("The reply-to address isn't a valid email.");
  const unknown = unknownFields(settings.subject + settings.html);
  if (unknown.length) problems.push(`Unknown merge field${unknown.length > 1 ? "s" : ""}: ${unknown.map((f) => `{{${f}}}`).join(", ")}.`);
  return problems;
}

const FIELD_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;
const KNOWN = new Set<string>(BOOKING_EMAIL_FIELDS.map((f) => f.key));

export function unknownFields(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(FIELD_RE)) {
    const key = m[1]!.toLowerCase();
    if (!KNOWN.has(key)) out.add(key);
  }
  return [...out];
}

/** Fills the merge fields. In HTML every value is escaped; in the subject it is plain text. */
export function fillBookingEmail(text: string, values: BookingEmailValues, mode: "html" | "text"): string {
  return text.replace(FIELD_RE, (_m, key: string) => {
    const k = key.toLowerCase();
    if (!KNOWN.has(k)) return "";
    const value = values[k as BookingEmailField] ?? "";
    return mode === "html" ? escapeHtml(value) : value.replace(/[\r\n]+/g, " ");
  });
}

/** A plain-text twin of an HTML email, for clients that don't show HTML. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, "\n")
    .replace(/<\/td>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n").trim();
}

/** Sample values for the settings preview and test sends. */
export function sampleBookingEmailValues(businessName: string, businessPhone: string): BookingEmailValues {
  const out = Object.fromEntries(BOOKING_EMAIL_FIELDS.map((f) => [f.key, f.sample])) as BookingEmailValues;
  return { ...out, business_name: businessName || out.business_name, business_phone: businessPhone || out.business_phone };
}

/** "$280", "$1,250.50". Null and zero read "To be confirmed" so a template never shows "Price: ". */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return "To be confirmed";
  return `$${value.toLocaleString("en-AU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** "12 Example Street, Parramatta", or "To be confirmed" when nothing is known. */
export function formatAddress(street: string | null | undefined, suburb: string | null | undefined): string {
  const s = (street ?? "").trim();
  const sub = (suburb ?? "").trim();
  if (s && sub && !s.toLowerCase().includes(sub.toLowerCase())) return `${s}, ${sub}`;
  return s || sub || "To be confirmed";
}

/** What the per-booking and send-log views show for one channel. */
export type ConfirmationLogRow = {
  channel: "email" | "sms";
  status: "sending" | "sent" | "skipped" | "failed";
  reason: string | null;
  recipient: string | null;
  updatedAt: string;
  attempts: number;
  trigger: "auto" | "manual";
};

export function confirmationStatusText(row: Pick<ConfirmationLogRow, "status" | "channel">): string {
  const what = row.channel === "email" ? "Email" : "Text";
  switch (row.status) {
    case "sent": return `${what} sent`;
    case "sending": return `${what} sending`;
    case "failed": return `${what} failed`;
    default: return `${what} not sent`;
  }
}

/** Email images: what can be uploaded and where it lives. */
export const EMAIL_IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" } as const;
export type EmailImageType = keyof typeof EMAIL_IMAGE_TYPES;
export const MAX_EMAIL_IMAGE_BYTES = 2 * 1024 * 1024;
export const EMAIL_IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|gif|webp)$/;

/** True when the bytes really are the image type claimed (first bytes of the file). */
export function imageBytesMatch(type: EmailImageType, bytes: Uint8Array): boolean {
  const b = bytes;
  if (type === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (type === "image/gif") return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;
  return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
}
