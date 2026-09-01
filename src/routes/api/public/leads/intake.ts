import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const IntakeSchema = z.object({
  name: z.string().min(2).max(80),
  mobile_number: z.string().min(8).max(20),
  email: z.string().email().max(120).optional().nullable(),
  suburb: z.string().max(80).optional().nullable(),
  vehicle_type: z.string().max(60).optional().nullable(),
  last_cleaned_at: z.string().max(60).optional().nullable(),
  main_concerns: z.string().max(500).optional().nullable(),
  service_intent: z.string().max(120).optional().nullable(),
  source_channel: z.enum(["meta", "website", "hosted_page", "manual", "unknown"]).default("website"),
  source_campaign: z.string().max(80).optional().nullable(),
  source_form: z.string().max(80).optional().nullable(),
  utm_source: z.string().max(80).optional().nullable(),
  utm_campaign: z.string().max(80).optional().nullable(),
  consent: z.boolean().default(false),
  external_id: z.string().max(120).optional().nullable(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

/** Public intake endpoint for external website forms, embeds and Meta lead forwarding. */
export const Route = createFileRoute("/api/public/leads/intake")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = IntakeSchema.parse(await request.json());
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "Invalid payload" },
            { status: 400, headers: CORS },
          );
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { captureLead } = await import("@/lib/lead-engine.server");

        if (parsed.external_id) {
          const { error: dedupeError } = await supabaseAdmin.from("webhook_events").insert({
            provider: parsed.source_channel,
            event_id: parsed.external_id,
            event_type: "lead_intake",
            payload: parsed as never,
          });
          if (dedupeError) return Response.json({ ok: true, duplicate: true }, { headers: CORS });
        }

        const { external_id: _externalId, ...lead } = parsed;
        const result = await captureLead({
          ...lead,
          consent_text: parsed.consent
            ? "Consent captured by the originating form."
            : "No explicit SMS consent supplied with this lead.",
        });

        // Duplicate suppressed: nothing was created, so say so explicitly rather
        // than returning a lead id as if this submission had been accepted.
        if (result.duplicate) {
          const { duplicateQuoteResponse } = await import("@/lib/quote-duplicate");
          return Response.json(duplicateQuoteResponse(), { headers: CORS });
        }

        return Response.json(
          { ok: true, duplicate: false, leadId: result.leadId, acknowledgementSent: result.acknowledgementSent },
          { headers: CORS },
        );
      },
    },
  },
});
