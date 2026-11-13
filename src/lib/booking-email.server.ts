/**
 * Booking confirmations by email (and the send log both channels share).
 *
 * Every new booking reaches confirmNewBooking, whichever way it was made:
 * the quote page, the website booking API, web chat, a text conversation,
 * the owner's own scheduling, Co-Work, ChatGPT/Claude, or a Facebook lead
 * form. It sends the business's own HTML email (merge fields filled, values
 * escaped) through BookedSecure's one email sender, records the text
 * confirmation the booking path already sent (or sends it, for bookings
 * nobody texted), and writes both to booking_confirmations. That row is also
 * the claim: one per booking per channel, so a retried request or a second
 * tab never emails a customer twice.
 *
 * jobs.notify_customer is the per-booking switch. Until migration 0061 is
 * applied nothing is emailed (there is nowhere to record the claim), and
 * texting carries on exactly as before.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type BookingEmailSettings,
  type BookingEmailValues,
  type ConfirmationLogRow,
  DEFAULT_BOOKING_EMAIL,
  fillBookingEmail,
  formatAddress,
  formatPrice,
  htmlToText,
  readBookingEmailSettings,
} from "@/lib/booking-email";
import { formatConfirmationDateTime, resolveTenantCallbackNumber } from "@/lib/booking-confirmation";
import { firstName } from "@/lib/domain";

/** The address confirmations come from: the verified BookedSecure domain, under the business's name. */
export const BOOKING_FROM_ADDRESS = "bookings@bookedsecure.com";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MISSING = new Set(["42P01", "PGRST205", "42703", "PGRST204"]);
const now = () => new Date().toISOString();

type Channel = "email" | "sms";
type Status = "sending" | "sent" | "skipped" | "failed";
type Trigger = "auto" | "manual";
export type ConfirmationOutcome = { channel: Channel; status: Status; reason: string };

/** True once migration 0061 is applied. Cached per isolate; a missing table is re-checked after a minute. */
let readyAt: { ok: boolean; at: number } | null = null;
export async function confirmationsReady(): Promise<boolean> {
  if (readyAt && (readyAt.ok || Date.now() - readyAt.at < 60_000)) return readyAt.ok;
  const { error } = await supabaseAdmin.from("booking_confirmations").select("id").limit(1);
  const ok = !error || !MISSING.has(error.code ?? "");
  if (!ok) console.warn("booking_confirmations is missing: apply drizzle/migrations/0061_booking_confirmations.sql; confirmation emails are off until then");
  readyAt = { ok, at: Date.now() };
  return ok;
}

// ------------------------------------------------------------------ facts

type Facts = {
  job: { id: string; lead_id: string; scheduled_at: string | null; quoted_price: number | null; booking_details: unknown; notify_customer: boolean; created_at: string; service_id: string | null; completion_status: string };
  lead: { id: string; name: string | null; email: string | null; mobile_number: string | null; service_address: string | null; suburb: string | null; deleted_at: string | null; service_name_snapshot: string | null };
  business: { name: string; timezone: string; phone_number: string | null; owner_notification_number: string | null; booking_email: unknown };
  serviceName: string | null;
};

async function loadFacts(businessId: string, jobId: string): Promise<Facts | null> {
  const jobRes = await supabaseAdmin.from("jobs")
    .select("id, lead_id, scheduled_at, quoted_price, booking_details, notify_customer, created_at, service_id, completion_status, services(name)")
    .eq("id", jobId).eq("business_id", businessId).maybeSingle();
  let job = jobRes.data as (Facts["job"] & { services?: { name?: string | null } | null }) | null;
  if (jobRes.error && MISSING.has(jobRes.error.code ?? "")) {
    // notify_customer not there yet: every booking counts as switched on.
    const { data } = await supabaseAdmin.from("jobs")
      .select("id, lead_id, scheduled_at, quoted_price, booking_details, created_at, service_id, completion_status, services(name)")
      .eq("id", jobId).eq("business_id", businessId).maybeSingle();
    job = data ? ({ ...(data as object), notify_customer: true } as never) : null;
  }
  if (!job) return null;
  const [{ data: lead }, businessRes, { data: offer }] = await Promise.all([
    supabaseAdmin.from("leads").select("id, name, email, mobile_number, service_address, suburb, deleted_at, service_name_snapshot")
      .eq("id", job.lead_id).eq("business_id", businessId).maybeSingle(),
    supabaseAdmin.from("businesses").select("name, timezone, phone_number, owner_notification_number, booking_email").eq("id", businessId).maybeSingle(),
    supabaseAdmin.from("booking_offers").select("service_name_snapshot").eq("business_id", businessId).eq("job_id", jobId).maybeSingle(),
  ]);
  let business = businessRes.data as Facts["business"] | null;
  if (businessRes.error && MISSING.has(businessRes.error.code ?? "")) {
    const { data } = await supabaseAdmin.from("businesses").select("name, timezone, phone_number, owner_notification_number").eq("id", businessId).maybeSingle();
    business = data ? ({ ...data, booking_email: null } as Facts["business"]) : null;
  }
  if (!lead || !business) return null;
  const details = (job.booking_details ?? {}) as { service?: unknown; service_name?: unknown };
  const serviceName = job.services?.name ?? offer?.service_name_snapshot ?? lead.service_name_snapshot
    ?? (typeof details.service_name === "string" ? details.service_name : typeof details.service === "string" ? details.service : null);
  return { job, lead: lead as Facts["lead"], business, serviceName };
}

/** The price a booking was made at: the job's own figure, else the booking's quote. */
function bookingPrice(job: Facts["job"]): number | null {
  if (job.quoted_price !== null && job.quoted_price !== undefined && Number(job.quoted_price) > 0) return Number(job.quoted_price);
  const d = (job.booking_details ?? {}) as { price?: unknown; total?: unknown };
  const v = Number(d.price ?? d.total);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function bookingEmailValues(f: Facts): BookingEmailValues {
  const when = f.job.scheduled_at ? formatConfirmationDateTime(f.job.scheduled_at, f.business.timezone) : { date: "To be confirmed", time: "To be confirmed" };
  const name = (f.lead.name ?? "").trim();
  const phone = resolveTenantCallbackNumber(f.business) ?? f.business.phone_number ?? "";
  return {
    name: name || "there", first_name: name ? firstName(name) : "there",
    service: (f.serviceName ?? "").trim() || "Your booking",
    date: when.date, time: when.time,
    address: formatAddress(f.lead.service_address, f.lead.suburb),
    price: formatPrice(bookingPrice(f.job)),
    business_name: f.business.name, business_phone: phone.replace(/^\+61/, "0"),
  };
}

/** Where customers' replies go when the owner set no reply-to: the business's inbox address, else the owner's login email. */
async function defaultReplyTo(businessId: string): Promise<string | null> {
  const { mailboxSender } = await import("@/lib/email-inbox.server");
  return (await mailboxSender(businessId))?.address ?? (await ownerEmail(businessId));
}

async function ownerEmail(businessId: string): Promise<string | null> {
  const { data: owners } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "owner");
  const ids = (owners ?? []).map((r) => r.user_id as string);
  if (!ids.length) return null;
  const { data } = await supabaseAdmin.from("profiles").select("email").eq("business_id", businessId).eq("active", true).in("id", ids).limit(1);
  const email = data?.[0]?.email ?? null;
  return email && EMAIL_RE.test(email) ? email : null;
}

// ------------------------------------------------------------------ the log

async function readRow(jobId: string, channel: Channel) {
  const { data } = await supabaseAdmin.from("booking_confirmations").select("*").eq("job_id", jobId).eq("channel", channel).maybeSingle();
  return data as { id: string; status: Status; attempts: number } | null;
}

/** Records a settled outcome, never overwriting a confirmation that was already sent. */
async function settle(businessId: string, f: Pick<Facts, "job">, channel: Channel, status: Exclude<Status, "sending">, reason: string, extra: { recipient?: string | null; subject?: string | null; providerId?: string | null; trigger?: Trigger } = {}) {
  const row = {
    business_id: businessId, job_id: f.job.id, lead_id: f.job.lead_id, channel, status, reason: reason.slice(0, 500),
    recipient: extra.recipient ?? null, subject: extra.subject ?? null, provider_message_id: extra.providerId ?? null,
    trigger: extra.trigger ?? "auto", updated_at: now(),
  };
  const existing = await readRow(f.job.id, channel);
  if (!existing) {
    const { error } = await supabaseAdmin.from("booking_confirmations").insert(row);
    if (!error) return;
  }
  await supabaseAdmin.from("booking_confirmations").update(row).eq("job_id", f.job.id).eq("channel", channel).neq("status", "sent");
}

/**
 * Takes the right to send on one channel. An automatic send claims only a
 * booking nobody has touched; a manual one may retry anything not sent and
 * not already sending.
 */
async function claim(businessId: string, f: Facts, channel: Channel, trigger: Trigger, recipient: string, subject: string | null): Promise<boolean> {
  const base = { business_id: businessId, job_id: f.job.id, lead_id: f.job.lead_id, channel, status: "sending" as const, reason: null, recipient, subject, trigger, updated_at: now() };
  const { error } = await supabaseAdmin.from("booking_confirmations").insert({ ...base, attempts: 1 });
  if (!error) return true;
  if (error.code !== "23505") throw new Error(error.message);
  const existing = await readRow(f.job.id, channel);
  if (!existing || existing.status === "sending") return false;
  if (trigger === "auto" && existing.status !== "failed") return false;
  if (existing.status === "sent" && trigger === "auto") return false;
  const { data } = await supabaseAdmin.from("booking_confirmations")
    .update({ ...base, attempts: (existing.attempts ?? 1) + 1 })
    .eq("id", existing.id).eq("status", existing.status).select("id").maybeSingle();
  return Boolean(data);
}

// ------------------------------------------------------------------ email

export async function bookingEmailSettings(businessId: string): Promise<BookingEmailSettings> {
  const { data, error } = await supabaseAdmin.from("businesses").select("booking_email").eq("id", businessId).maybeSingle();
  if (error) return { ...DEFAULT_BOOKING_EMAIL };
  return readBookingEmailSettings((data as { booking_email?: unknown } | null)?.booking_email);
}

/** Renders and sends one email from settings and values. Returns the provider id. */
export async function deliverRenderedEmail(input: { businessId: string; to: string; businessName: string; settings: BookingEmailSettings; values: BookingEmailValues; replyTo: string | null }) {
  const { sendEmailViaResend, loadEmailBranding } = await import("@/lib/email-campaigns.server");
  const { DEFAULT_BOOKING_EMAIL_HTML } = await import("@/lib/booking-email");
  const { themeDefaultBookingHtml } = await import("@/lib/email-theme");
  const { branding } = await loadEmailBranding(input.businessId);
  const subject = fillBookingEmail(input.settings.subject, input.values, "text").slice(0, 250);
  // The built-in confirmation follows the business's email template; custom HTML is left as written.
  const html = fillBookingEmail(themeDefaultBookingHtml(input.settings.html, DEFAULT_BOOKING_EMAIL_HTML, branding.theme), input.values, "html");
  const text = htmlToText(html);
  const fromName = input.businessName.replace(/[<>"\r\n]/g, "").trim() || "Bookings";
  const sent = await sendEmailViaResend({ from: `${fromName} <${BOOKING_FROM_ADDRESS}>`, to: input.to, subject, html, text, replyTo: input.replyTo });
  return { id: sent.id, subject };
}

/** Sends (or records why not) the confirmation email for one booking. */
export async function sendBookingConfirmationEmail(businessId: string, jobId: string, trigger: Trigger = "auto"): Promise<ConfirmationOutcome> {
  const out = (status: Status, reason: string): ConfirmationOutcome => ({ channel: "email", status, reason });
  if (!(await confirmationsReady())) return out("skipped", "Confirmation emails aren't set up yet.");
  const f = await loadFacts(businessId, jobId);
  if (!f) return out("skipped", "That booking no longer exists.");
  const settings = readBookingEmailSettings(f.business.booking_email);
  const email = (f.lead.email ?? "").trim().toLowerCase();
  const skip = async (reason: string) => { await settle(businessId, f, "email", "skipped", reason, { recipient: email || null, trigger }); return out("skipped", reason); };
  if (f.lead.deleted_at) return skip("The customer has been deleted.");
  if (trigger === "auto" && f.job.notify_customer === false) return skip("Turned off for this booking.");
  if (trigger === "auto" && !settings.enabled) return skip("Confirmation emails are switched off.");
  if (!EMAIL_RE.test(email)) return skip("No email address for this customer.");
  if (f.job.completion_status === "cancelled") return skip("The booking was cancelled.");

  const values = bookingEmailValues(f);
  const subjectPreview = fillBookingEmail(settings.subject, values, "text").slice(0, 250);
  if (!(await claim(businessId, f, "email", trigger, email, subjectPreview))) {
    const existing = await readRow(jobId, "email");
    return out(existing?.status ?? "skipped", existing?.status === "sent" ? "Already sent." : "Already being sent.");
  }
  try {
    const replyTo = settings.replyTo || (await defaultReplyTo(businessId));
    const sent = await deliverRenderedEmail({ businessId, to: email, businessName: f.business.name, settings, values, replyTo });
    await supabaseAdmin.from("booking_confirmations").update({ status: "sent", reason: null, subject: sent.subject, provider_message_id: sent.id, updated_at: now() })
      .eq("job_id", jobId).eq("channel", "email").eq("status", "sending");
    return out("sent", `Emailed ${email}.`);
  } catch (e) {
    const reason = e instanceof Error ? e.message : "The email couldn't be sent.";
    await supabaseAdmin.from("booking_confirmations").update({ status: "failed", reason: reason.slice(0, 500), updated_at: now() })
      .eq("job_id", jobId).eq("channel", "email").eq("status", "sending");
    return out("failed", reason);
  }
}

// ------------------------------------------------------------------ both channels

export type SmsAlreadyHandled = { status: "sent" | "skipped" | "failed"; reason: string; recipient?: string | null };

const SMS_REASONS: Record<string, string> = {
  sent: "Text sent.", duplicate_suppressed: "Text already sent.", failed: "The text could not be sent.",
  blocked_consent_missing: "No consent to text this customer.", blocked_opted_out: "The customer has opted out of texts.",
  blocked_suppressed: "This number is suppressed.", blocked_invalid_number: "No valid mobile number.",
  blocked_missing_callback_number: "Your business has no callback number set.", blocked_cancelled: "The booking was cancelled.",
  blocked_no_booking: "No booking to confirm.", queued_quiet_hours: "Held until quiet hours end.", already_handled: "Handled by the booking.",
};

/** What a booking path's own confirmation text did, in log form. */
export function smsOutcome(r: { outcome: string; sent: boolean; reason?: string | undefined }): SmsAlreadyHandled {
  const reason = SMS_REASONS[r.outcome] ?? r.reason ?? r.outcome;
  if (r.sent || r.outcome === "sent" || r.outcome === "duplicate_suppressed") return { status: "sent", reason };
  return { status: r.outcome === "failed" ? "failed" : "skipped", reason };
}

/**
 * For paths that move or create (owner scheduling, Facebook lead forms): a
 * booking is new when its job was created in the last few minutes. Moving an
 * existing booking sends nothing.
 */
export async function confirmIfNewBooking(input: { businessId: string; jobId: string; leadId: string; notifyCustomer?: boolean | undefined; sms?: SmsAlreadyHandled | undefined }) {
  try {
    if (!(await confirmationsReady())) return [];
    const { data: job } = await supabaseAdmin.from("jobs").select("created_at").eq("id", input.jobId).eq("business_id", input.businessId).maybeSingle();
    if (!job || Date.now() - Date.parse(job.created_at) > 5 * 60_000) return [];
    if (input.notifyCustomer === false) await setBookingNotify(input.businessId, input.jobId, false).catch(() => undefined);
    return await confirmNewBooking({ businessId: input.businessId, jobId: input.jobId, leadId: input.leadId, sms: input.sms });
  } catch (e) {
    console.error("[booking-confirmations]", e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * The one hook every new booking passes through, after it is saved.
 *
 * `sms` is what the booking path already did about the text (customer-made
 * bookings send it inside the booking itself, through the approved template
 * and its consent checks); it is only recorded. Without it the text is sent
 * here, through the same template and checks, keyed to the job so it goes once.
 * Never throws: a confirmation problem must not undo a booking.
 */
export async function confirmNewBooking(input: { businessId: string; jobId: string; leadId?: string | null | undefined; sms?: SmsAlreadyHandled | undefined }): Promise<ConfirmationOutcome[]> {
  try {
    // Until the migration is applied there is no per-booking switch and no
    // log, so nothing new is sent: bookings behave exactly as they did.
    if (!(await confirmationsReady())) return [];
    const f = await loadFacts(input.businessId, input.jobId);
    if (!f) return [];
    const results: ConfirmationOutcome[] = [];
    if (input.sms) {
      await settle(input.businessId, f, "sms", input.sms.status, input.sms.reason, { recipient: input.sms.recipient ?? f.lead.mobile_number });
      results.push({ channel: "sms", status: input.sms.status, reason: input.sms.reason });
    } else {
      results.push(await sendBookingConfirmationSms(input.businessId, input.jobId, "auto", f));
    }
    results.push(await sendBookingConfirmationEmail(input.businessId, input.jobId, "auto"));
    return results;
  } catch (e) {
    console.error("[booking-confirmations]", e instanceof Error ? e.message : e);
    return [];
  }
}

/** The text for one booking: the offer's own confirmation when there is one, else the job's. */
export async function sendBookingConfirmationSms(businessId: string, jobId: string, trigger: Trigger, facts?: Facts | null): Promise<ConfirmationOutcome> {
  const out = (status: Status, reason: string): ConfirmationOutcome => ({ channel: "sms", status, reason });
  const f = facts ?? (await loadFacts(businessId, jobId));
  if (!f) return out("skipped", "That booking no longer exists.");
  if (trigger === "auto" && f.job.notify_customer === false) {
    await settle(businessId, f, "sms", "skipped", "Turned off for this booking.", { recipient: f.lead.mobile_number });
    return out("skipped", "Turned off for this booking.");
  }
  const { data: offer } = await supabaseAdmin.from("booking_offers").select("id").eq("business_id", businessId).eq("job_id", jobId).eq("status", "confirmed").maybeSingle();
  let sent: boolean;
  let reason: string;
  if (offer) {
    const { deliverBookingConfirmation } = await import("@/lib/booking-confirmation.server");
    const r = await deliverBookingConfirmation({ businessId, leadId: f.job.lead_id, offerId: offer.id });
    sent = r.sent || r.outcome === "duplicate_suppressed";
    reason = r.reason;
  } else {
    const { deliverJobConfirmationSms } = await import("@/lib/booking-confirmation.server");
    const r = await deliverJobConfirmationSms({ businessId, jobId, leadId: f.job.lead_id });
    sent = r.sent;
    reason = r.reason;
  }
  const status = sent ? "sent" : /could not|failed|error/i.test(reason) ? "failed" : "skipped";
  await settle(businessId, f, "sms", status, reason, { recipient: f.lead.mobile_number, trigger });
  return out(status, reason);
}

/** Emails that failed on the provider's side get two more tries, from the follow-ups hook. */
export async function retryFailedBookingEmails(limit = 20): Promise<{ retried: number }> {
  if (!(await confirmationsReady())) return { retried: 0 };
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const before = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data } = await supabaseAdmin.from("booking_confirmations").select("business_id, job_id, attempts")
    .eq("channel", "email").eq("status", "failed").lt("attempts", 3).gte("created_at", since).lte("updated_at", before).limit(limit);
  let retried = 0;
  for (const row of data ?? []) {
    const r = await sendBookingConfirmationEmail(row.business_id as string, row.job_id as string, "auto").catch(() => null);
    if (r) retried += 1;
  }
  return { retried };
}

// ------------------------------------------------------------------ owner views

export async function bookingConfirmationState(businessId: string, jobId: string) {
  const { data: job } = await supabaseAdmin.from("jobs").select("id, notify_customer").eq("id", jobId).eq("business_id", businessId).maybeSingle();
  if (!job) throw new Error("That booking no longer exists.");
  const ready = await confirmationsReady();
  const { data } = ready
    ? await supabaseAdmin.from("booking_confirmations").select("channel, status, reason, recipient, updated_at, attempts, trigger").eq("business_id", businessId).eq("job_id", jobId)
    : { data: [] };
  const rows: ConfirmationLogRow[] = (data ?? []).map((r) => ({
    channel: r.channel as Channel, status: r.status as Status, reason: r.reason as string | null, recipient: r.recipient as string | null,
    updatedAt: r.updated_at as string, attempts: Number(r.attempts ?? 1), trigger: (r.trigger as Trigger) ?? "auto",
  }));
  return { ready, notifyCustomer: (job as { notify_customer?: boolean }).notify_customer !== false, rows };
}

export async function setBookingNotify(businessId: string, jobId: string, notify: boolean) {
  const { data, error } = await supabaseAdmin.from("jobs").update({ notify_customer: notify } as never).eq("id", jobId).eq("business_id", businessId).select("id").maybeSingle();
  if (error) throw new Error(MISSING.has(error.code ?? "") ? "Per-booking confirmations aren't set up yet." : error.message);
  if (!data) throw new Error("That booking no longer exists.");
  return { notifyCustomer: notify };
}

/** The send log for the settings page: newest first, with the customer and the booking time. */
export async function listBookingConfirmations(businessId: string, limit = 40) {
  if (!(await confirmationsReady())) return { ready: false, rows: [] as Array<ConfirmationLogRow & { jobId: string; customer: string | null; scheduledAt: string | null }> };
  const { data } = await supabaseAdmin.from("booking_confirmations").select("job_id, lead_id, channel, status, reason, recipient, updated_at, attempts, trigger")
    .eq("business_id", businessId).order("updated_at", { ascending: false }).limit(limit);
  const rows = data ?? [];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))] as string[];
  const jobIds = [...new Set(rows.map((r) => r.job_id))] as string[];
  const [{ data: leads }, { data: jobs }] = await Promise.all([
    leadIds.length ? supabaseAdmin.from("leads").select("id, name").eq("business_id", businessId).in("id", leadIds) : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    jobIds.length ? supabaseAdmin.from("jobs").select("id, scheduled_at").eq("business_id", businessId).in("id", jobIds) : Promise.resolve({ data: [] as { id: string; scheduled_at: string | null }[] }),
  ]);
  const nameOf = new Map((leads ?? []).map((l) => [l.id, l.name]));
  const whenOf = new Map((jobs ?? []).map((j) => [j.id, j.scheduled_at]));
  return {
    ready: true,
    rows: rows.map((r) => ({
      jobId: r.job_id as string, customer: (nameOf.get(r.lead_id as string) ?? null) as string | null, scheduledAt: (whenOf.get(r.job_id as string) ?? null) as string | null,
      channel: r.channel as Channel, status: r.status as Status, reason: r.reason as string | null, recipient: r.recipient as string | null,
      updatedAt: r.updated_at as string, attempts: Number(r.attempts ?? 1), trigger: (r.trigger as Trigger) ?? "auto",
    })),
  };
}

/** Sends the business's email, with sample values, to the owner. Nothing is logged. */
export async function sendTestBookingEmail(businessId: string, to: string, settings: BookingEmailSettings) {
  const { data: business } = await supabaseAdmin.from("businesses").select("name, phone_number, owner_notification_number").eq("id", businessId).maybeSingle();
  if (!business) throw new Error("Your business could not be read.");
  const { sampleBookingEmailValues } = await import("@/lib/booking-email");
  const phone = (resolveTenantCallbackNumber(business) ?? business.phone_number ?? "").replace(/^\+61/, "0");
  const values = sampleBookingEmailValues(business.name, phone);
  const { mailboxSender } = await import("@/lib/email-inbox.server");
  const replyTo = settings.replyTo || (await mailboxSender(businessId))?.address || to;
  await deliverRenderedEmail({ businessId, to, businessName: business.name, settings, values, replyTo });
  return { sentTo: to };
}
