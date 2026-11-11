import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BOOKING_EMAIL_LIMITS, EMAIL_IMAGE_TYPES } from "@/lib/booking-email";

const SETTINGS = z.object({
  enabled: z.boolean(),
  subject: z.string().max(BOOKING_EMAIL_LIMITS.subject),
  html: z.string().max(BOOKING_EMAIL_LIMITS.html),
  replyTo: z.string().max(200),
});

/** The confirmation email settings, the business details the preview needs, and the send log. */
export const getBookingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { bookingEmailSettings, confirmationsReady, listBookingConfirmations } = await import("@/lib/booking-email.server");
    const { resolveTenantCallbackNumber } = await import("@/lib/booking-confirmation");
    const app = await requireAppContext(context.supabase, context.userId);
    const [settings, ready, log, { data: business }] = await Promise.all([
      bookingEmailSettings(app.businessId), confirmationsReady(), listBookingConfirmations(app.businessId, 30),
      supabaseAdmin.from("businesses").select("name, phone_number, owner_notification_number").eq("id", app.businessId).maybeSingle(),
    ]);
    const phone = business ? (resolveTenantCallbackNumber(business) ?? business.phone_number ?? "") : "";
    return {
      ready, settings, log: log.rows, canEdit: app.role !== "staff",
      business: { name: business?.name ?? "", phone: phone.replace(/^\+61/, "0") },
      myEmail: app.email ?? null,
    };
  });

export const saveBookingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SETTINGS.parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { checkBookingEmail, readBookingEmailSettings } = await import("@/lib/booking-email");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const settings = readBookingEmailSettings(data);
    const problems = checkBookingEmail({ ...settings, replyTo: data.replyTo.trim() });
    if (problems.length) throw new Error(problems.join(" "));
    const { error } = await supabaseAdmin.from("businesses").update({ booking_email: settings as never }).eq("id", app.businessId);
    if (error) throw new Error(/booking_email/.test(error.message) ? "Confirmation emails aren't set up yet. Ask for migration 0061 to be applied." : error.message);
    return { settings };
  });

/** Sends the email being edited, with sample details, to the signed-in owner. */
export const sendTestBookingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SETTINGS.parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { checkBookingEmail, readBookingEmailSettings } = await import("@/lib/booking-email");
    const { sendTestBookingEmail: send } = await import("@/lib/booking-email.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    if (!app.email) throw new Error("Your account has no email address to send the test to.");
    const settings = readBookingEmailSettings(data);
    const problems = checkBookingEmail({ ...settings, replyTo: data.replyTo.trim() });
    if (problems.length) throw new Error(problems.join(" "));
    return send(app.businessId, app.email, settings);
  });

/** Stores one picture for the email and returns its public address, for an <img> tag. */
export const uploadBookingEmailImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    contentType: z.enum(Object.keys(EMAIL_IMAGE_TYPES) as [keyof typeof EMAIL_IMAGE_TYPES, ...(keyof typeof EMAIL_IMAGE_TYPES)[]]),
    dataBase64: z.string().min(100).max(3_000_000),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { storeEmailImage } = await import("@/lib/booking-email-images.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    return storeEmailImage(app.businessId, data.contentType, data.dataBase64);
  });

/** One booking's confirmations: what was sent on each channel, and its auto-send switch. */
export const getBookingConfirmations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { bookingConfirmationState } = await import("@/lib/booking-email.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return bookingConfirmationState(app.businessId, data.jobId);
  });

/** The per-booking switch: off and nothing is sent to the customer automatically. */
export const setBookingAutoSend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid(), notify: z.boolean() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { setBookingNotify } = await import("@/lib/booking-email.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return setBookingNotify(app.businessId, data.jobId, data.notify);
  });

/** Sends one booking's confirmation now: the email, or the text if it hasn't gone. */
export const sendBookingConfirmationNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid(), channel: z.enum(["email", "sms"]) }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { confirmationsReady, sendBookingConfirmationEmail, sendBookingConfirmationSms } = await import("@/lib/booking-email.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    if (!(await confirmationsReady())) throw new Error("Confirmations aren't set up yet. Ask for migration 0061 to be applied.");
    return data.channel === "email"
      ? sendBookingConfirmationEmail(app.businessId, data.jobId, "manual")
      : sendBookingConfirmationSms(app.businessId, data.jobId, "manual");
  });
