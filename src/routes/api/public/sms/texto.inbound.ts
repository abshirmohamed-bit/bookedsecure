import { createFileRoute } from "@tanstack/react-router";

/**
 * Texto inbound-message (MO) webhook. Order is always: verify HMAC signature ->
 * resolve the tenant from the receiving number -> de-duplicate on the stable
 * message_id -> only then write.
 */
export const Route = createFileRoute("/api/public/sms/texto/inbound")({
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
        const { flattenTextoPayload } = await import("@/lib/sms/texto.server");
        const {
          recordWebhookEvent,
          markWebhookProcessed,
          markWebhookFailed,
          resolveEventId,
          logWebhook,
        } = await import("@/lib/sms/webhook.server");
        const { handleInboundMessage, findSenderByNumber } = await import(
          "@/lib/lead-engine.server"
        );

        const provider = getProvider("texto");
        const verification = await provider.verifyWebhook({
          url: request.url,
          params: payload,
          headers: request.headers,
          rawBody,
        });
        if (!verification.verified) {
          logWebhook("error", "texto", { outcome: "rejected", reason: verification.reason ?? null });
          return new Response("Unauthorized", { status: 401 });
        }

        const flat = flattenTextoPayload(payload);
        // message_id is stable across Texto retries; the delivery header and a
        // content hash are the fallbacks.
        const { eventId, source } = await resolveEventId({
          providerId: "texto",
          eventId: flat.messageId ?? request.headers.get("x-texto-delivery"),
          rawBody,
        });

        // Inbound replies arrive at our own number ("to").
        const sender = flat.to ? await findSenderByNumber(flat.to) : null;
        if (!sender) {
          await recordWebhookEvent({
            providerId: "texto",
            eventId: `unmatched:${eventId}`,
            eventType: "message.inbound_unmatched",
            payload,
            signatureVerified: true,
          });
          logWebhook("warn", "texto", { outcome: "unmatched_number", eventIdSource: source });
          return Response.json({ ok: false, error: "Unknown number" }, { status: 404 });
        }

        const { duplicate, failed, reason, state } = await recordWebhookEvent({
          providerId: "texto",
          eventId,
          eventType: "message.inbound",
          payload,
          businessId: sender.businessId,
          signatureVerified: true,
        });
        if (failed) {
          logWebhook("error", "texto", {
            outcome: "persist_failed",
            businessId: sender.businessId,
            reason: reason ?? null,
          });
          return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
        }
        if (duplicate) {
          const inProgress = state === "duplicate_in_progress";
          logWebhook(inProgress ? "warn" : "info", "texto", {
            outcome: inProgress ? "duplicate_in_progress" : "duplicate_processed",
            businessId: sender.businessId,
          });
          return inProgress
            ? Response.json({ ok: false, processing: true }, { status: 409 })
            : Response.json({ ok: true, duplicate: true });
        }

        try {
          const result = await handleInboundMessage({
            providerName: "texto",
            payload,
            sender,
          });
          const marked = await markWebhookProcessed("texto", eventId);
          if (!marked.ok) {
            logWebhook("error", "texto", {
              outcome: "mark_processed_failed",
              businessId: sender.businessId,
              reason: marked.reason ?? null,
            });
            return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
          }
          return Response.json(result as unknown as Record<string, unknown>, {
            status: result.handled ? 200 : 202,
          });
        } catch (error) {
          await markWebhookFailed("texto", eventId, error);
          logWebhook("error", "texto", {
            outcome: "processing_failed",
            businessId: sender.businessId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return Response.json({ ok: false, error: "Processing failed" }, { status: 503 });
        }
      },
    },
  },
});
