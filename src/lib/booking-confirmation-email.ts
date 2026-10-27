// Shared operational booking-confirmation EMAIL policy — pure, no I/O.
//
// Companion to the SMS confirmation. Sends nothing promotional. The AI never
// authors confirmation HTML. All tenant-specific values are passed in.
//
// Safety gates (all must pass for a customer-facing send):
//   1. BOOKING_CONFIRM_EMAIL_ENABLED === "true"
//   2. BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER === "true"  (otherwise only the
//      optional BOOKING_CONFIRM_EMAIL_TEST_TO override may receive mail)
//   3. Lead has a usable email (otherwise SMS-only)
//
// Default: every gate is OFF → no email leaves.

import { firstName } from "@/lib/domain";
import { formatConfirmationDateTime } from "@/lib/booking-confirmation";

export const BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID = "booking_confirmation_email.v1" as const;

export const BOOKING_CONFIRM_EMAIL_ENABLED_ENV = "BOOKING_CONFIRM_EMAIL_ENABLED";
export const BOOKING_CONFIRM_EMAIL_TEST_TO_ENV = "BOOKING_CONFIRM_EMAIL_TEST_TO";
export const BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER_ENV = "BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER";
export const BOOKING_CONFIRM_EMAIL_LOGO_URL_ENV = "BOOKING_CONFIRM_EMAIL_LOGO_URL";
export const BOOKING_CONFIRM_EMAIL_HERO_URL_ENV = "BOOKING_CONFIRM_EMAIL_HERO_URL";

/** Deterministic Resend Idempotency-Key — a replay never sends twice. */
export function bookingConfirmationEmailIdempotencyKey(offerId: string): string {
  return `booking_confirm_email:${offerId}`;
}

export type EmailConfirmationOutcome =
  | "eligible"
  | "sent"
  | "duplicate_suppressed"
  | "skipped_disabled"
  | "skipped_no_email"
  | "skipped_customer_send_blocked"
  | "skipped_no_api_key"
  | "skipped_no_booking"
  | "failed";

export type EmailGateDecision = {
  outcome: EmailConfirmationOutcome;
  sendable: boolean;
  reason: string;
  /** Where the message would go — test override or customer. */
  to: string | null;
  /** True when the destination is the test override, not the customer. */
  testOverride: boolean;
};

function truthyEnv(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === "true";
}

function validEmail(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw || raw.length > 254) return null;
  // Practical check — not a full RFC parser.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return null;
  return raw.toLowerCase();
}

/**
 * Pure gate: whether an email may leave, and to whom.
 * Never looks at network or secrets beyond the env strings passed in.
 *
 * Safety:
 * - Flag OFF → skip (default).
 * - Flag ON + TEST_TO set → send only to TEST_TO (never customer).
 * - Flag ON + no TEST_TO → customer send only if ALLOW_CUSTOMER=true AND lead has email.
 * - No email on lead → SMS-only.
 */
export function evaluateBookingConfirmationEmailGate(input: {
  enabledEnv?: string | null | undefined;
  allowCustomerEnv?: string | null | undefined;
  testToEnv?: string | null | undefined;
  leadEmail?: string | null | undefined;
  offerStatus?: string | null | undefined;
  jobId?: string | null | undefined;
}): EmailGateDecision {
  if (!truthyEnv(input.enabledEnv)) {
    return {
      outcome: "skipped_disabled",
      sendable: false,
      reason: "BOOKING_CONFIRM_EMAIL_ENABLED is not true.",
      to: null,
      testOverride: false,
    };
  }
  if (input.offerStatus !== "confirmed" || !input.jobId) {
    return {
      outcome: "skipped_no_booking",
      sendable: false,
      reason: "No committed booking and job exist for this confirmation email.",
      to: null,
      testOverride: false,
    };
  }

  const testTo = validEmail(input.testToEnv);
  if (testTo) {
    return {
      outcome: "eligible",
      sendable: true,
      reason: "Test override recipient configured — customer address is never used.",
      to: testTo,
      testOverride: true,
    };
  }

  if (!truthyEnv(input.allowCustomerEnv)) {
    return {
      outcome: "skipped_customer_send_blocked",
      sendable: false,
      reason:
        "No BOOKING_CONFIRM_EMAIL_TEST_TO set and BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER is not true — refusing customer send.",
      to: null,
      testOverride: false,
    };
  }

  const leadEmail = validEmail(input.leadEmail);
  if (!leadEmail) {
    return {
      outcome: "skipped_no_email",
      sendable: false,
      reason: "Customer has no usable email — SMS-only confirmation.",
      to: null,
      testOverride: false,
    };
  }

  return {
    outcome: "eligible",
    sendable: true,
    reason: "Eligible to send to the customer email.",
    to: leadEmail,
    testOverride: false,
  };
}

export type BookingConfirmationEmailFacts = {
  customerName: string | null | undefined;
  businessName: string;
  serviceName: string | null | undefined;
  vehicleLabel: string | null | undefined;
  address: string | null | undefined;
  totalLabel: string | null | undefined;
  slotStart: string;
  timezone: string;
  phoneDisplay: string;
  phoneTel: string;
  websiteUrl: string;
  instagramUrl: string;
  reviewsUrl: string;
  rescheduleUrl: string;
  logoUrl: string;
  heroUrl: string;
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fill(template: string, map: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(map)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/** Subject line — never model output. */
export function renderBookingConfirmationEmailSubject(input: {
  customerName: string | null | undefined;
  serviceName: string | null | undefined;
}): string {
  const first = firstName((input.customerName ?? "").trim() || "there");
  const service = (input.serviceName ?? "").trim() || "your booking";
  return `You're booked in, ${first} — ${service} confirmed`;
}

/**
 * Minimal HTML body built from the approved Glocast v4 layout, with public
 * absolute image URLs (never CID). Placeholders are escaped.
 */
export function renderBookingConfirmationEmailHtml(input: BookingConfirmationEmailFacts): {
  html: string;
  text: string;
  templateId: typeof BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID;
} {
  const { date, time } = formatConfirmationDateTime(input.slotStart, input.timezone);
  const customer = esc((input.customerName ?? "").trim() || "there");
  const business = esc(input.businessName);
  const service = esc((input.serviceName ?? "").trim() || "your booking");
  const vehicle = esc((input.vehicleLabel ?? "").trim() || "—");
  const address = esc((input.address ?? "").trim() || "—");
  const total = esc((input.totalLabel ?? "").trim() || "—");
  const phone = esc(input.phoneDisplay);
  const phoneTel = esc(input.phoneTel);
  const website = esc(input.websiteUrl);
  const instagram = esc(input.instagramUrl);
  const reviews = esc(input.reviewsUrl);
  const reschedule = esc(input.rescheduleUrl);
  const logo = esc(input.logoUrl);
  const hero = esc(input.heroUrl);
  const dateEsc = esc(date);
  const timeEsc = esc(time);

  const html = fill(EMAIL_HTML_V1, {
    "Customer Name": customer,
    "Business Name": business,
    Service: service,
    Vehicle: vehicle,
    Date: dateEsc,
    Time: timeEsc,
    Address: address,
    Total: total,
    Phone: phone,
    "Phone Tel": phoneTel,
    Website: website,
    Instagram: instagram,
    Reviews: reviews,
    "Reschedule URL": reschedule,
    "Logo URL": logo,
    "Hero URL": hero,
  });

  const text = [
    `Hi ${firstName((input.customerName ?? "").trim() || "there")},`,
    ``,
    `Your ${input.businessName} booking is confirmed.`,
    `Service: ${(input.serviceName ?? "").trim() || "your booking"}`,
    `When: ${date} at ${time} (${input.timezone})`,
    `Where: ${(input.address ?? "").trim() || "—"}`,
    ``,
    `Questions? Call or text ${input.phoneDisplay}.`,
    `Reply STOP on SMS to opt out of texts.`,
  ].join("\n");

  return { html, text, templateId: BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID };
}

/** Default public asset paths once this branch (or main) is deployed. */
export function defaultEmailAssetUrls(publicAppUrl: string | null | undefined): {
  logoUrl: string;
  heroUrl: string;
} {
  const origin = (publicAppUrl ?? "https://bookedsecure.com").replace(/\/$/, "");
  return {
    logoUrl: `${origin}/email/glocast-logo-gc-transparent-email560.png`,
    heroUrl: `${origin}/email/glocast-hero-smiling.jpg`,
  };
}

const EMAIL_HTML_V1 = `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your booking is confirmed – {Business Name}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<style>table,td{font-family:Arial,sans-serif!important}</style>
<![endif]-->
</head>
<body style="margin:0;padding:0;background:#F2F2F0;">
<div style="display:none;max-height:0;overflow:hidden;">You're booked in for {Service} on {Date} at {Time}. Here's everything you need to know.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F2F2F0" style="background:#F2F2F0;"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:12px;overflow:hidden;">
 <tr><td align="left" bgcolor="#111827" style="padding:20px 40px;border-bottom:1px solid #0B1220;background:#111827;">
  <img src="{Logo URL}" width="280" height="59" alt="{Business Name}" style="display:block;border:0;width:280px;height:auto;max-width:280px;">
 </td></tr>
 <tr><td bgcolor="#D9DCDF">
  <img src="{Hero URL}" width="600" height="400" alt="Glocast – thank you for booking" style="display:block;width:100%;max-width:600px;height:auto;border:0;">
 </td></tr>
 <tr><td bgcolor="#FFFFFF" style="padding:40px 40px 8px 40px;font-family:Helvetica,Arial,sans-serif;background:#FFFFFF;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#E7F4EC" style="background:#E7F4EC;color:#1E7B46;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:6px 12px;border-radius:20px;">&#10003;&nbsp; Booking confirmed</td></tr></table>
  <h1 style="margin:20px 0 12px 0;font-size:32px;line-height:38px;color:#111827;font-weight:bold;">You're all set, {Customer Name}.</h1>
  <p style="margin:0;font-size:16px;line-height:26px;color:#4B5563;">Thanks for booking with {Business Name}. We've locked in your appointment and we're looking forward to getting your vehicle looking its best.</p>
 </td></tr>
 <tr><td bgcolor="#FFFFFF" style="padding:32px 40px;background:#FFFFFF;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F7F7F5" style="background:#F7F7F5;border:1px solid #E5E5E2;border-radius:10px;font-family:Helvetica,Arial,sans-serif;">
   <tr><td style="padding:24px 24px 8px 24px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#6B7280;font-weight:bold;">Appointment summary</td></tr>
   <tr><td style="padding:0 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
     <tr><td width="50%" valign="top" style="padding:12px 12px 12px 0;"><div style="font-size:13px;color:#6B7280;">Service</div><div style="font-size:16px;color:#111827;font-weight:bold;padding-top:4px;">{Service}</div></td>
         <td width="50%" valign="top" style="padding:12px 0;"><div style="font-size:13px;color:#6B7280;">Vehicle</div><div style="font-size:16px;color:#111827;font-weight:bold;padding-top:4px;">{Vehicle}</div></td></tr>
     <tr><td width="50%" valign="top" style="padding:12px 12px 12px 0;border-top:1px solid #E5E5E2;"><div style="font-size:13px;color:#6B7280;">Date</div><div style="font-size:16px;color:#111827;font-weight:bold;padding-top:4px;">{Date}</div></td>
         <td width="50%" valign="top" style="padding:12px 0;border-top:1px solid #E5E5E2;"><div style="font-size:13px;color:#6B7280;">Time</div><div style="font-size:16px;color:#111827;font-weight:bold;padding-top:4px;">{Time}</div></td></tr>
     <tr><td colspan="2" style="padding:12px 0;border-top:1px solid #E5E5E2;"><div style="font-size:13px;color:#6B7280;">Location</div><div style="font-size:16px;color:#111827;font-weight:bold;padding-top:4px;">{Address}</div></td></tr>
    </table>
   </td></tr>
   <tr><td style="padding:16px 24px 24px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:2px solid #111827;"><tr>
     <td style="padding-top:14px;font-size:15px;color:#111827;font-weight:bold;">Total</td>
     <td align="right" style="padding-top:14px;font-size:20px;color:#111827;font-weight:bold;">{Total}</td></tr></table>
   </td></tr>
  </table>
 </td></tr>
 <tr><td bgcolor="#FFFFFF" style="padding:0 40px 8px 40px;font-family:Helvetica,Arial,sans-serif;background:#FFFFFF;">
  <h2 style="margin:0 0 16px 0;font-size:20px;line-height:26px;color:#111827;">What to expect &amp; how to prepare</h2>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
   <tr><td width="40" valign="top" style="padding:0 0 16px 0;">
    <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f9f3.png" width="26" height="26" alt="" style="display:block;border:0;">
   </td><td valign="top" style="padding:2px 0 16px 0;font-size:15px;line-height:23px;color:#4B5563;"><strong style="color:#111827;">Clear out personal items.</strong> Remove valuables, car seats and loose items so we can reach every surface.</td></tr>
   <tr><td width="40" valign="top" style="padding:0 0 16px 0;">
    <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4a7.png" width="26" height="26" alt="" style="display:block;border:0;">
   </td><td valign="top" style="padding:2px 0 16px 0;font-size:15px;line-height:23px;color:#4B5563;"><strong style="color:#111827;">Access, water &amp; power.</strong> Please make sure we can park near the vehicle. The water tap / power point needs to be within 25 metres or less of where the car is parked.</td></tr>
   <tr><td width="40" valign="top" style="padding:0 0 16px 0;">
    <img src="https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f697.png" width="26" height="26" alt="" style="display:block;border:0;">
   </td><td valign="top" style="padding:2px 0 16px 0;font-size:15px;line-height:23px;color:#4B5563;"><strong style="color:#111827;">On the day.</strong> We'll message you when we're on the way. Most services take 2–4 hours, and we'll walk you through the results at handover.</td></tr>
  </table>
 </td></tr>
 <tr><td align="center" bgcolor="#FFFFFF" style="padding:16px 40px 8px 40px;background:#FFFFFF;">
  <a href="{Reschedule URL}" style="display:inline-block;background:#111827;color:#FFFFFF;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;line-height:50px;width:280px;text-align:center;text-decoration:none;border-radius:8px;">Reschedule appointment</a>
 </td></tr>
 <tr><td align="center" bgcolor="#FFFFFF" style="padding:12px 40px 40px 40px;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:#6B7280;background:#FFFFFF;">Need to cancel or have a question? Call or text us on <a href="tel:{Phone Tel}" style="color:#111827;font-weight:bold;text-decoration:underline;">{Phone}</a>.<br>Please give us at least 24 hours' notice for changes.</td></tr>
 <tr><td align="center" bgcolor="#111827" style="background:#111827;padding:28px 40px;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:20px;color:#9CA3AF;">
  <strong style="color:#FFFFFF;font-size:14px;">{Business Name}</strong><br>
  <a href="tel:{Phone Tel}" style="color:#D1D5DB;text-decoration:none;">{Phone}</a><br>
  <a href="{Website}" style="color:#D1D5DB;">Website</a> &nbsp;&middot;&nbsp; <a href="{Instagram}" style="color:#D1D5DB;">Instagram</a> &nbsp;&middot;&nbsp; <a href="{Reviews}" style="color:#D1D5DB;">Reviews</a><br>
  <span style="color:#6B7280;">You're receiving this because you booked an appointment with {Business Name}.</span>
 </td></tr>
</table></td></tr></table>
</body></html>`;
