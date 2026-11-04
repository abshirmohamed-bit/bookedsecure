import { createFileRoute } from "@tanstack/react-router";

/** Direct Meta Lead Ads webhook. Never trusts lead answers supplied by the callback. */
export const Route = createFileRoute("/api/public/meta/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { verifyMetaChallenge } = await import("@/lib/meta-leads.server");
        const challenge = verifyMetaChallenge(
          new URL(request.url), process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",
        );
        return challenge === null
          ? new Response("Forbidden", { status: 403 })
          : new Response(challenge, { headers: { "Content-Type": "text/plain" } });
      },
      POST: async ({ request }) => {
        const { verifyMetaSignature, extractMetaLeadEvents, fetchMetaLead, mapMetaLead } =
          await import("@/lib/meta-leads.server");
        const secret = process.env.META_APP_SECRET ?? "";
        const pageId = process.env.META_PAGE_ID ?? "";
        const businessId = process.env.META_BUSINESS_ID ?? "";
        const pageToken = process.env.META_PAGE_ACCESS_TOKEN ?? "";
        const version = process.env.META_GRAPH_API_VERSION ?? "";
        if (!secret || !/^\d+$/.test(pageId) || !businessId || !pageToken || !version) {
          return new Response("Webhook unavailable", { status: 503 });
        }
        const rawBody = await request.text();
        if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"), secret)) {
          return new Response("Unauthorized", { status: 401 });
        }
        let payload: unknown;
        try { payload = JSON.parse(rawBody); }
        catch { return new Response("Invalid JSON", { status: 400 }); }
        const events = extractMetaLeadEvents(payload, pageId);
        if (events.length === 0) return Response.json({ ok: true, ignored: true });

        const { recordWebhookEvent, markWebhookProcessed, markWebhookFailed } =
          await import("@/lib/sms/webhook.server");
        const { captureLead } = await import("@/lib/lead-engine.server");
        for (const event of events) {
          const eventId = `${pageId}:${event.leadId}`;
          const claim = await recordWebhookEvent({
            providerId: "meta_leadgen", eventId, eventType: "leadgen",
            payload: { page_id: pageId, form_id: event.formId, leadgen_id: event.leadId },
            businessId, signatureVerified: true,
          });
          if (claim.failed || claim.state === "duplicate_in_progress") {
            return new Response("Retry later", { status: 503 });
          }
          if (claim.state === "duplicate_processed") continue;
          try {
            const lead = mapMetaLead(await fetchMetaLead(event, pageToken, version), event);
            await captureLead({ ...lead, businessId, channel: "web" });
            const marked = await markWebhookProcessed("meta_leadgen", eventId);
            if (!marked.ok) return new Response("Retry later", { status: 503 });
          } catch {
            // Do not put lead answers or provider error bodies in event logs.
            await markWebhookFailed("meta_leadgen", eventId, "lead_intake_failed");
            console.error("[meta-leadgen] lead intake failed");
            return new Response("Retry later", { status: 503 });
          }
        }
        return Response.json({ ok: true });
      },
    },
  },
});
