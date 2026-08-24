import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
});

export const submitQuoteRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => QuoteSchema.parse(input))
  .handler(async ({ data }) => {
    const { captureLead } = await import("@/lib/lead-engine.server");
    const result = await captureLead({
      ...data,
      consent_text: "I agree to be contacted by SMS about this enquiry.",
    });
    return {
      ok: true,
      acknowledgementSent: result.acknowledgementSent,
      note: result.note ?? null,
    };
  });
