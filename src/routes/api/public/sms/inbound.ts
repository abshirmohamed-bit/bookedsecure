import { createFileRoute } from "@tanstack/react-router";

/**
 * Inbound SMS webhook (Twilio-compatible form body or JSON).
 * Order is: verify signature -> resolve the tenant from the receiving number ->
 * only then write anything.
 */
export const Route = createFileRoute("/api/public/sms/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { payload, rawBody } = await readPayload(request);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { getProvider } = await import("@/lib/sms/provider.server");
        const { handleInboundMessage, findSenderByNumber } = await import(
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
          console.error(`[sms:inbound] rejected: ${verification.reason}`);
          return new Response("Unauthorized", { status: 401 });
        }

        const eventId = String(payload["MessageSid"] ?? payload["message_id"] ?? "");
        if (!eventId) return Response.json({ ok: false, error: "Missing message id" }, { status: 400 });

        const toNumber = String(payload["To"] ?? payload["to"] ?? "");
        const sender = toNumber ? await findSenderByNumber(toNumber) : null;
        if (!sender) {
          await supabaseAdmin.from("webhook_events").insert({
            provider: "twilio",
            event_id: `unmatched:${eventId}`,
            event_type: "inbound_unmatched",
            payload: payload as never,
            signature_verified: true,
          });
          return Response.json({ ok: false, error: "Unknown receiving number" }, { status: 404 });
        }

        // De-duplicate provider retries before doing any work.
        const { error: dedupeError } = await supabaseAdmin.from("webhook_events").insert({
          provider: "twilio",
          event_id: eventId,
          event_type: "inbound",
          payload: payload as never,
          business_id: sender.businessId,
          signature_verified: true,
        });
        if (dedupeError) return Response.json({ ok: true, duplicate: true });

        const result = await handleInboundMessage({
          providerName: sender.provider,
          payload: payload as never,
          sender,
        });
        return Response.json(result, { status: result.handled ? 200 : 202 });
      },
    },
  },
});

async function readPayload(
  request: Request,
): Promise<{ payload: Record<string, unknown>; rawBody: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  const rawBody = await request.text();
  if (contentType.includes("application/json")) {
    return { payload: JSON.parse(rawBody || "{}") as Record<string, unknown>, rawBody };
  }
  return {
    payload: Object.fromEntries(new URLSearchParams(rawBody).entries()),
    rawBody,
  };
}
