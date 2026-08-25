import { createFileRoute } from "@tanstack/react-router";

/** Delivery status callback webhook, scoped to the business owning the number. */
export const Route = createFileRoute("/api/public/sms/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        const rawBody = await request.text();
        const payload: Record<string, unknown> = contentType.includes("application/json")
          ? (JSON.parse(rawBody || "{}") as Record<string, unknown>)
          : Object.fromEntries(new URLSearchParams(rawBody).entries());

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getProvider } = await import("@/lib/sms/provider.server");
        const { handleDeliveryStatus, findSenderByNumber } = await import(
          "@/lib/lead-engine.server"
        );

        // This route is the Twilio-format endpoint, so it verifies with the Twilio
        // scheme; the message handlers below use the matched sender's provider.
        const provider = getProvider("twilio");
        const verification = await provider.verifyWebhook({
          url: request.url,
          params: payload,
          headers: request.headers,
          rawBody,
        });
        if (!verification.verified) {
          console.error(`[sms:status] rejected: ${verification.reason}`);
          return new Response("Unauthorized", { status: 401 });
        }

        const eventId = `${String(payload["MessageSid"] ?? "")}:${String(payload["MessageStatus"] ?? payload["SmsStatus"] ?? "")}`;
        if (eventId === ":") {
          return Response.json({ ok: false, error: "Missing message id" }, { status: 400 });
        }

        // On a status callback the sending number is "From".
        const fromNumber = String(payload["From"] ?? payload["from"] ?? "");
        const sender = fromNumber ? await findSenderByNumber(fromNumber) : null;
        if (!sender) {
          await supabaseAdmin.from("webhook_events").insert({
            provider: "twilio",
            event_id: `unmatched:${eventId}`,
            event_type: "status_unmatched",
            payload: payload as never,
            signature_verified: true,
          });
          return Response.json({ ok: false, error: "Unknown sending number" }, { status: 404 });
        }

        const { error: dedupeError } = await supabaseAdmin.from("webhook_events").insert({
          provider: "twilio",
          event_id: eventId,
          event_type: "status",
          payload: payload as never,
          business_id: sender.businessId,
          signature_verified: true,
        });
        if (dedupeError) return Response.json({ ok: true, duplicate: true });

        const result = await handleDeliveryStatus({
          providerName: sender.provider,
          payload: payload as never,
          sender,
        });
        return Response.json(result);
      },
    },
  },
});
