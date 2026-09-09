import { createFileRoute } from "@tanstack/react-router";

/**
 * Texto delivery-receipt (DLR) webhook. Texto's DLR body identifies the message
 * but not the sending number, so the tenant is resolved from the stored outbound
 * message: verify HMAC signature -> resolve the tenant by provider message id ->
 * de-duplicate -> only then write.
 */
export const Route = createFileRoute("/api/public/sms/texto/delivery")({
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
        const { handleDeliveryStatus } = await import("@/lib/lead-engine.server");

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
        const { eventId, source } = await resolveEventId({
          providerId: "texto",
          // One receipt per status change: the delivery UUID is stable on retries.
          eventId: request.headers.get("x-texto-delivery"),
          rawBody,
        });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: message } = flat.messageId
          ? await supabaseAdmin
              .from("messages")
              .select("business_id")
              .eq("provider_message_id", flat.messageId)
              .limit(1)
              .maybeSingle()
          : { data: null };

        if (!message?.business_id) {
          await recordWebhookEvent({
            providerId: "texto",
            eventId: `unmatched:${eventId}`,
            eventType: "message.dlr_unmatched",
            payload,
            signatureVerified: true,
          });
          logWebhook("warn", "texto", { outcome: "unmatched_message", eventIdSource: source });
          return Response.json({ ok: false, error: "Unknown message" }, { status: 404 });
        }
        const businessId = message.business_id;

        const { duplicate, failed, reason, state } = await recordWebhookEvent({
          providerId: "texto",
          eventId,
          eventType: "message.dlr",
          payload,
          businessId,
          signatureVerified: true,
        });
        if (failed) {
          logWebhook("error", "texto", {
            outcome: "persist_failed",
            businessId,
            reason: reason ?? null,
          });
          return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
        }
        if (duplicate) {
          const inProgress = state === "duplicate_in_progress";
          logWebhook(inProgress ? "warn" : "info", "texto", {
            outcome: inProgress ? "duplicate_in_progress" : "duplicate_processed",
            businessId,
          });
          return inProgress
            ? Response.json({ ok: false, processing: true }, { status: 409 })
            : Response.json({ ok: true, duplicate: true });
        }

        try {
          const result = await handleDeliveryStatus({
            providerName: "texto",
            payload,
            // Only the tenant scope is used here; the receipt carries no sender.
            sender: {
              id: "texto-dlr",
              businessId,
              phoneNumber: "",
              provider: "texto",
              credentialMode: "platform",
              subaccountSid: null,
              credentialSecretName: null,
            },
          });
          const marked = await markWebhookProcessed("texto", eventId);
          if (!marked.ok) {
            logWebhook("error", "texto", {
              outcome: "mark_processed_failed",
              businessId,
              reason: marked.reason ?? null,
            });
            return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
          }
          return Response.json(result as unknown as Record<string, unknown>);
        } catch (error) {
          await markWebhookFailed("texto", eventId, error);
          logWebhook("error", "texto", {
            outcome: "processing_failed",
            businessId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return Response.json({ ok: false, error: "Processing failed" }, { status: 503 });
        }
      },
    },
  },
});
