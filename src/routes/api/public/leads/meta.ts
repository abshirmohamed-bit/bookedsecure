import { createFileRoute } from "@tanstack/react-router";
import { fetchMetaLead, mapMetaLead, metaLeadEvents, verifyMetaSignature } from "@/lib/meta-leads.server";

/** Meta leadgen subscription. Configure this URL in the Meta app's Page webhook. */
export const Route = createFileRoute("/api/public/leads/meta")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = process.env["META_WEBHOOK_VERIFY_TOKEN"];
        if (
          token &&
          url.searchParams.get("hub.mode") === "subscribe" &&
          url.searchParams.get("hub.verify_token") === token
        ) return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request }) => {
        const appSecret = process.env["META_APP_SECRET"];
        const pageId = process.env["META_PAGE_ID"];
        const formId = process.env["META_FORM_ID"];
        const pageToken = process.env["META_PAGE_ACCESS_TOKEN"];
        const graphVersion = process.env["META_GRAPH_API_VERSION"];
        const businessId = process.env["META_BUSINESS_ID"];
        if (!appSecret || !pageId || !formId || !pageToken || !graphVersion || !businessId)
          return new Response("Meta integration is not configured", { status: 503 });

        const body = await request.text();
        if (!verifyMetaSignature(body, request.headers.get("x-hub-signature-256"), appSecret))
          return new Response("Forbidden", { status: 403 });

        let payload;
        try { payload = JSON.parse(body); }
        catch { return new Response("Invalid JSON", { status: 400 }); }

        const events = metaLeadEvents(payload, pageId, formId);
        const { captureLead } = await import("@/lib/lead-engine.server");
        try {
          for (const event of events) {
            const lead = await fetchMetaLead(event.leadId, pageToken, graphVersion);
            if (lead.id !== event.leadId || lead.form_id !== formId) throw new Error("Meta lead form mismatch");
            const mapped = mapMetaLead(lead, process.env["META_SMS_CONSENT_FIELD"], process.env["META_SMS_CONSENT_VALUE"]);
            await captureLead({
              businessId,
              ...mapped,
              source_channel: "meta",
              source_form: formId,
              lead_origin: "inbound_form",
              external_id: `meta:${event.leadId}`,
              source_metadata: { page_id: pageId, form_id: formId, ad_id: event.adId },
              consent_text: mapped.consent
                ? `Explicit Meta form answer: ${process.env["META_SMS_CONSENT_FIELD"]} = ${process.env["META_SMS_CONSENT_VALUE"]}`
                : "No verified SMS consent from Meta form.",
            });
          }
        } catch (error) {
          console.error("[meta-leads] processing failed", error);
          return new Response("Retry lead delivery", { status: 500 });
        }
        return new Response("OK", { status: 200 });
      },
    },
  },
});
