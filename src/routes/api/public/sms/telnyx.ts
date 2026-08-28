import { createFileRoute } from "@tanstack/react-router";

/**
 * Telnyx webhook. Order is always: verify signature -> resolve the tenant from
 * the receiving/sending number -> de-duplicate -> only then write.
 *
 * Event dispatch:
 *   message.received  -> inbound handler
 *   message.sent      -> delivery status handler
 *   message.finalized -> final delivery handler (carries final cost)
 */
export const Route = createFileRoute("/api/public/sms/telnyx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody || "{}") as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
        }

        const { getProvider } = await import("@/lib/sms/provider.server");
        const { flattenTelnyxPayload } = await import("@/lib/sms/telnyx.server");
        const { recordWebhookEvent, resolveEventId, logWebhook } = await import(
          "@/lib/sms/webhook.server"
        );
        const { handleInboundMessage, handleDeliveryStatus, findSenderByNumber } = await import(
          "@/lib/lead-engine.server"
        );

        const provider = getProvider("telnyx");
        const verification = await provider.verifyWebhook({
          url: request.url,
          params: payload,
          headers: request.headers,
          rawBody,
        });
        if (!verification.verified) {
          logWebhook("error", "telnyx", { outcome: "rejected", reason: verification.reason ?? null });
          return new Response("Unauthorized", { status: 401 });
        }

        const flat = flattenTelnyxPayload(payload);
        // Provider event id when present, content hash otherwise.
        const { eventId, source } = await resolveEventId({
          providerId: "telnyx",
          eventId: flat.eventId,
          rawBody,
        });

        const inbound = flat.eventType === "message.received";
        // Inbound arrives at our number ("to"); status callbacks come from it ("from").
        const tenantNumber = inbound ? flat.to : flat.from;
        const sender = tenantNumber ? await findSenderByNumber(tenantNumber) : null;
        if (!sender) {
          await recordWebhookEvent({
            providerId: "telnyx",
            eventId: `unmatched:${eventId}`,
            eventType: `${flat.eventType ?? "unknown"}_unmatched`,
            payload,
            signatureVerified: true,
          });
          logWebhook("warn", "telnyx", {
            outcome: "unmatched_number",
            eventType: flat.eventType,
            eventIdSource: source,
          });
          return Response.json({ ok: false, error: "Unknown number" }, { status: 404 });
        }

        const { duplicate } = await recordWebhookEvent({
          providerId: "telnyx",
          eventId,
          eventType: flat.eventType ?? "unknown",
          payload,
          businessId: sender.businessId,
          signatureVerified: true,
        });
        if (duplicate) {
          logWebhook("info", "telnyx", {
            outcome: "duplicate_suppressed",
            eventType: flat.eventType,
            eventIdSource: source,
            businessId: sender.businessId,
          });
          return Response.json({ ok: true, duplicate: true });
        }

        if (inbound) {
          const result = await handleInboundMessage({
            providerName: "telnyx",
            payload,
            sender,
          });
          return Response.json(result, { status: result.handled ? 200 : 202 });
        }

        if (flat.eventType === "message.sent" || flat.eventType === "message.finalized") {
          const result = await handleDeliveryStatus({
            providerName: "telnyx",
            payload,
            sender,
            ...(flat.eventType === "message.finalized" && flat.cost !== null
              ? { providerCost: flat.cost }
              : {}),
          });
          return Response.json(result);
        }

        return Response.json({ ok: true, ignored: flat.eventType });
      },
    },
  },
});
