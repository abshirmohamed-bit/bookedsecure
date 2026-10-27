// Operational booking-confirmation EMAIL: sent next to the SMS confirmation
// after a booking is committed.
//
// Runs only after a booking has been committed (confirmed offer + job). It
// never creates, moves or cancels a booking, never starts a sequence, never
// sends anything promotional, and never composes its own copy — the body comes
// from the versioned template in `booking-confirmation-email.ts`.
//
// Failures here NEVER affect the booking or the SMS confirmation. Default is
// OFF (BOOKING_CONFIRM_EMAIL_ENABLED != "true"). Customer sends require an
// explicit BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER=true AND no test override —
// otherwise BOOKING_CONFIRM_EMAIL_TEST_TO receives every send (or nothing
// leaves). Secrets (RESEND_API_KEY) are read from env only — never committed.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID,
  BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER_ENV,
  BOOKING_CONFIRM_EMAIL_ENABLED_ENV,
  BOOKING_CONFIRM_EMAIL_HERO_URL_ENV,
  BOOKING_CONFIRM_EMAIL_LOGO_URL_ENV,
  BOOKING_CONFIRM_EMAIL_TEST_TO_ENV,
  bookingConfirmationEmailIdempotencyKey,
  defaultEmailAssetUrls,
  evaluateBookingConfirmationEmailGate,
  renderBookingConfirmationEmailHtml,
  renderBookingConfirmationEmailSubject,
  type EmailConfirmationOutcome,
} from "@/lib/booking-confirmation-email";
import { resolveTenantCallbackNumber } from "@/lib/booking-confirmation";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM_ADDRESS = "Glocast <info@glocast.com.au>";
const AUDIT_EVENT = "booking_confirmation_email";

export type EmailConfirmationResult = {
  outcome: EmailConfirmationOutcome;
  sent: boolean;
  reason: string;
  to: string | null;
  testOverride: boolean;
  messageId?: string | undefined;
  templateId: typeof BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID;
  idempotencyKey: string;
};

async function record(input: {
  businessId: string;
  leadId: string;
  offerId: string;
  outcome: EmailConfirmationOutcome;
  reason: string;
  to?: string | null;
  testOverride?: boolean;
  resendId?: string | null;
}) {
  try {
    await supabaseAdmin.from("audit_events").insert({
      business_id: input.businessId,
      event_type: AUDIT_EVENT,
      entity_type: "lead",
      entity_id: input.leadId,
      metadata: {
        offer_id: input.offerId,
        outcome: input.outcome,
        reason: input.reason,
        template_id: BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID,
        to: input.to ?? null,
        test_override: input.testOverride ?? false,
        resend_id: input.resendId ?? null,
      } as never,
    });
  } catch {
    // Audit must never break the booking path.
  }
}

function displayAuPhone(e164OrLocal: string | null | undefined): { display: string; tel: string } {
  const raw = (e164OrLocal ?? "").trim();
  // Known Glocast fallback used only when the tenant has no configured number.
  if (!raw) return { display: "0447 852 565", tel: "+61447852565" };
  if (raw.startsWith("+61") && raw.length === 12) {
    const national = `0${raw.slice(3)}`;
    const display =
      national.length === 10
        ? `${national.slice(0, 4)} ${national.slice(4, 7)} ${national.slice(7)}`
        : national;
    return { display, tel: raw };
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("04")) {
    return {
      display: `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`,
      tel: `+61${digits.slice(1)}`,
    };
  }
  return { display: raw, tel: raw.startsWith("+") ? raw : raw };
}

/**
 * Evaluates one confirmation-email event and either sends it via Resend or
 * records exactly why it was skipped. Never throws to the booking finalize path.
 */
export async function deliverBookingConfirmationEmail(input: {
  businessId: string;
  leadId: string;
  offerId: string;
}): Promise<EmailConfirmationResult> {
  const idempotencyKey = bookingConfirmationEmailIdempotencyKey(input.offerId);
  const base = {
    templateId: BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID,
    sent: false,
    to: null as string | null,
    testOverride: false,
    idempotencyKey,
  };

  try {
    const [{ data: lead }, { data: business }, { data: offer }] = await Promise.all([
      supabaseAdmin
        .from("leads")
        .select(
          "id, name, email, service_address, suburb, vehicle_type, service_name_snapshot, public_token",
        )
        .eq("id", input.leadId)
        .eq("business_id", input.businessId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabaseAdmin
        .from("businesses")
        .select(
          "name, timezone, phone_number, owner_notification_number, website_url",
        )
        .eq("id", input.businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("booking_offers")
        .select("id, status, job_id, slot_start, timezone, service_name_snapshot")
        .eq("id", input.offerId)
        .eq("business_id", input.businessId)
        .eq("lead_id", input.leadId)
        .maybeSingle(),
    ]);

    if (!lead || !business || !offer) {
      const result: EmailConfirmationResult = {
        ...base,
        outcome: "skipped_no_booking",
        reason: "Booking, customer or business record not found for this tenant.",
      };
      await record({ ...input, outcome: result.outcome, reason: result.reason });
      return result;
    }

    // Soft idempotency via prior successful audit — Resend Idempotency-Key is
    // the hard guarantee; this avoids a second attempt when audit already shows sent.
    const { data: prior } = await supabaseAdmin
      .from("audit_events")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("event_type", AUDIT_EVENT)
      .eq("entity_id", input.leadId)
      .contains("metadata", { offer_id: input.offerId, outcome: "sent" } as never)
      .limit(1)
      .maybeSingle();
    if (prior) {
      const result: EmailConfirmationResult = {
        ...base,
        outcome: "duplicate_suppressed",
        reason: "A confirmation email was already recorded as sent for this offer.",
      };
      await record({ ...input, outcome: result.outcome, reason: result.reason });
      return result;
    }

    const gate = evaluateBookingConfirmationEmailGate({
      enabledEnv: process.env[BOOKING_CONFIRM_EMAIL_ENABLED_ENV],
      allowCustomerEnv: process.env[BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER_ENV],
      testToEnv: process.env[BOOKING_CONFIRM_EMAIL_TEST_TO_ENV],
      leadEmail: lead.email,
      offerStatus: offer.status,
      jobId: offer.job_id,
    });

    if (!gate.sendable || !gate.to) {
      const outcome = gate.outcome === "eligible" ? "skipped_disabled" : gate.outcome;
      const result: EmailConfirmationResult = {
        ...base,
        outcome,
        reason: gate.reason,
        to: gate.to,
        testOverride: gate.testOverride,
      };
      await record({
        ...input,
        outcome: result.outcome,
        reason: result.reason,
        to: result.to,
        testOverride: result.testOverride,
      });
      return result;
    }

    const apiKey = (process.env["RESEND_API_KEY"] ?? "").trim();
    if (!apiKey) {
      const result: EmailConfirmationResult = {
        ...base,
        outcome: "skipped_no_api_key",
        reason: "RESEND_API_KEY is not set in the BookedSecure environment.",
        to: gate.to,
        testOverride: gate.testOverride,
      };
      await record({
        ...input,
        outcome: result.outcome,
        reason: result.reason,
        to: result.to,
        testOverride: result.testOverride,
      });
      return result;
    }

    const defaults = defaultEmailAssetUrls(process.env["PUBLIC_APP_URL"]);
    const logoUrl =
      (process.env[BOOKING_CONFIRM_EMAIL_LOGO_URL_ENV] ?? "").trim() || defaults.logoUrl;
    const heroUrl =
      (process.env[BOOKING_CONFIRM_EMAIL_HERO_URL_ENV] ?? "").trim() || defaults.heroUrl;

    const callback = resolveTenantCallbackNumber({
      phone_number: business.phone_number,
      owner_notification_number: business.owner_notification_number,
    });
    const phone = displayAuPhone(callback);
    const publicOrigin = (process.env["PUBLIC_APP_URL"] ?? "https://bookedsecure.com").replace(
      /\/$/,
      "",
    );
    const websiteUrl = (business.website_url ?? "").trim() || "https://glocast.com.au";
    const rescheduleUrl = lead.public_token
      ? `${publicOrigin}/b/${lead.public_token}`
      : websiteUrl;
    const address =
      (lead.service_address ?? "").trim() ||
      (lead.suburb ?? "").trim() ||
      null;

    const rendered = renderBookingConfirmationEmailHtml({
      customerName: lead.name,
      businessName: business.name || "Glocast",
      serviceName: offer.service_name_snapshot ?? lead.service_name_snapshot,
      vehicleLabel: lead.vehicle_type,
      address,
      totalLabel: null,
      slotStart: offer.slot_start,
      timezone: offer.timezone ?? business.timezone ?? "Australia/Sydney",
      phoneDisplay: phone.display,
      phoneTel: phone.tel,
      websiteUrl,
      instagramUrl: "https://www.instagram.com/glocast.au",
      reviewsUrl: websiteUrl,
      rescheduleUrl,
      logoUrl,
      heroUrl,
    });
    const subject = renderBookingConfirmationEmailSubject({
      customerName: lead.name,
      serviceName: offer.service_name_snapshot ?? lead.service_name_snapshot,
    });

    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [gate.to],
        subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
          { name: "template_id", value: BOOKING_CONFIRMATION_EMAIL_TEMPLATE_ID },
          { name: "offer_id", value: input.offerId },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const result: EmailConfirmationResult = {
        ...base,
        outcome: "failed",
        reason: `Resend HTTP ${response.status}: ${body.slice(0, 240)}`,
        to: gate.to,
        testOverride: gate.testOverride,
      };
      await record({
        ...input,
        outcome: result.outcome,
        reason: result.reason,
        to: result.to,
        testOverride: result.testOverride,
      });
      return result;
    }

    const payload = (await response.json().catch(() => null)) as { id?: string } | null;
    const result: EmailConfirmationResult = {
      ...base,
      outcome: "sent",
      sent: true,
      reason: gate.testOverride
        ? "Sent to test override recipient (customer address unused)."
        : "Sent to customer email via Resend.",
      to: gate.to,
      testOverride: gate.testOverride,
      messageId: payload?.id,
    };
    await record({
      ...input,
      outcome: result.outcome,
      reason: result.reason,
      to: result.to,
      testOverride: result.testOverride,
      resendId: payload?.id ?? null,
    });
    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown email confirmation failure.";
    const result: EmailConfirmationResult = {
      ...base,
      outcome: "failed",
      reason,
    };
    await record({ ...input, outcome: result.outcome, reason: result.reason });
    return result;
  }
}
