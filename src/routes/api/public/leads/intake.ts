import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

async function readBody(request: Request): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  const raw = await request.text();
  if (type.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw.trim() === "" ? null : JSON.parse(raw);
}

/**
 * Public intake endpoint for external website forms, embeds and Meta lead
 * forwarding (Zapier, n8n or raw Meta Lead Ads payloads).
 *
 * - Payloads are normalised leniently (see lead-intake.ts); only a lead with no
 *   usable phone number is refused, and refusals are recorded for diagnosis.
 * - `?business=<slug>` routes the lead to that business; without it the lead
 *   goes to the original default business, so existing scenarios keep working.
 * - A delivery with an external id is only marked handled after the lead is
 *   saved; a failure answers non-2xx and stays retryable instead of being
 *   reported as a duplicate on the next attempt.
 */
export const Route = createFileRoute("/api/public/leads/intake")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { normaliseIntakePayload } = await import("@/lib/lead-intake");
        const { normaliseSlug } = await import("@/lib/tenant-slug");

        const recordRejection = async (reason: string, payload: unknown) => {
          console.warn(`[lead-intake] rejected: ${reason}`);
          await supabaseAdmin.from("webhook_events").insert({
            provider: "lead_intake_rejected",
            event_id: crypto.randomUUID(),
            event_type: "lead_intake_rejected",
            payload: (payload && typeof payload === "object"
              ? payload
              : { raw: String(payload ?? "") }) as never,
            processing_error: reason.slice(0, 200),
          } as never);
        };

        let body: unknown;
        try {
          body = await readBody(request);
        } catch {
          await recordRejection("Body is not valid JSON", null);
          return Response.json(
            { ok: false, error: "Body is not valid JSON" },
            { status: 400, headers: CORS },
          );
        }

        const parsed = normaliseIntakePayload(body);
        if (!parsed.ok) {
          await recordRejection(parsed.error, body);
          return Response.json({ ok: false, error: parsed.error }, { status: 400, headers: CORS });
        }
        const { business_slug: bodySlug, external_id: externalId, ...lead } = parsed.lead;

        // Business routing: an explicit but unknown slug is refused, never
        // silently delivered to another business's inbox.
        let businessId: string | undefined;
        const requestedSlug = new URL(request.url).searchParams.get("business") ?? bodySlug;
        if (requestedSlug) {
          const slug = normaliseSlug(requestedSlug);
          const { data: business } = slug
            ? await supabaseAdmin.from("businesses").select("id").eq("slug", slug).maybeSingle()
            : { data: null };
          if (!business?.id) {
            await recordRejection(`Unknown business "${requestedSlug}"`, body);
            return Response.json(
              { ok: false, error: `Unknown business "${requestedSlug}"` },
              { status: 404, headers: CORS },
            );
          }
          businessId = business.id;
        }

        const webhook = await import("@/lib/sms/webhook.server");
        if (externalId) {
          const record = await webhook.recordWebhookEvent({
            providerId: lead.source_channel,
            eventId: externalId,
            eventType: "lead_intake",
            payload: { ...lead, external_id: externalId } as Record<string, unknown>,
            businessId: businessId ?? null,
            signatureVerified: false,
          });
          if (record.failed) {
            return Response.json(
              { ok: false, error: "Could not record lead, please retry" },
              { status: 503, headers: CORS },
            );
          }
          if (record.state === "duplicate_processed") {
            return Response.json({ ok: true, duplicate: true }, { headers: CORS });
          }
          if (record.state === "duplicate_in_progress") {
            return Response.json(
              { ok: false, error: "Lead is already being processed, retry shortly" },
              { status: 409, headers: CORS },
            );
          }
        }

        const { captureLead } = await import("@/lib/lead-engine.server");
        let result;
        try {
          result = await captureLead({
            ...lead,
            businessId,
            external_id: externalId,
            consent_text: lead.consent
              ? "Consent captured by the originating form."
              : "No explicit SMS consent supplied with this lead.",
          });
        } catch (error) {
          console.error(
            "[lead-intake] capture failed",
            error instanceof Error ? error.message : error,
          );
          if (externalId) await webhook.markWebhookFailed(lead.source_channel, externalId, error);
          return Response.json(
            { ok: false, error: "Could not save lead, please retry" },
            { status: 500, headers: CORS },
          );
        }

        if (externalId) await webhook.markWebhookProcessed(lead.source_channel, externalId);

        // Duplicate suppressed: nothing was created, so say so explicitly rather
        // than returning a lead id as if this submission had been accepted.
        if (result.duplicate) {
          const { duplicateQuoteResponse } = await import("@/lib/quote-duplicate");
          return Response.json(duplicateQuoteResponse(), { headers: CORS });
        }

        return Response.json(
          {
            ok: true,
            duplicate: false,
            leadId: result.leadId,
            acknowledgementSent: result.acknowledgementSent,
          },
          { headers: CORS },
        );
      },
    },
  },
});
