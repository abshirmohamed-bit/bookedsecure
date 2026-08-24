import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

const CONSENT_TEXT =
  "I agree to Glocast contacting me by SMS about this enquiry. Reply STOP at any time to opt out.";

const QuoteSchema = z.object({
  name: z.string().min(2).max(80),
  mobile_number: z.string().min(8).max(20),
  email: z.string().email().max(120).optional().nullable(),
  suburb: z.string().min(2).max(80),
  vehicle_type: z.string().min(2).max(60),
  last_cleaned_at: z.string().max(60).optional().nullable(),
  main_concerns: z.string().min(2).max(500),
  service_intent: z.string().min(2).max(120),
  consent: z.literal(true),
  source_channel: z.enum(["hosted_page", "website", "meta", "manual", "unknown"]).default("hosted_page"),
  source_form: z.string().max(80).optional().nullable(),
  utm_source: z.string().max(80).optional().nullable(),
  utm_campaign: z.string().max(80).optional().nullable(),
  form_url: z.string().max(300).optional().nullable(),
  // Honeypot: real customers never see or fill this field.
  company: z.string().max(200).optional().nullable(),
});

export const submitQuoteRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteSchema.parse(input))
  .handler(async ({ data }) => {
    const { normaliseAuMobile } = await import("@/lib/domain");

    // Silently accept honeypot hits so bots get no signal.
    if (data.company && data.company.trim().length > 0) {
      return { ok: true, acknowledgementSent: false, note: null };
    }

    const mobile = normaliseAuMobile(data.mobile_number);
    if (!mobile) {
      return { ok: false, error: "Please enter a valid Australian mobile number." };
    }

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const { allowPublicFormAttempt } = await import("@/lib/rate-limit.server");
    const allowed = await allowPublicFormAttempt(ip);
    if (!allowed) {
      return { ok: false, error: "Too many enquiries from this device. Please try again shortly." };
    }

    try {
      const { captureLead } = await import("@/lib/lead-engine.server");
      const { company: _company, form_url: formUrl, ...lead } = data;
      const result = await captureLead({
        ...lead,
        mobile_number: mobile,
        consent_text: CONSENT_TEXT,
        consent_source_url: formUrl ?? null,
      });
      return {
        ok: true as const,
        acknowledgementSent: result.acknowledgementSent,
        note: result.note ?? null,
      };
    } catch (error) {
      console.error("[quote] capture failed", error);
      return { ok: false as const, error: "We couldn't send your enquiry. Please try again shortly." };
    }
  });
