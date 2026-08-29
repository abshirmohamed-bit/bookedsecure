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
        const {
          recordWebhookEvent,
          markWebhookProcessed,
          markWebhookFailed,
          resolveEventId,
          logWebhook,
        } = await import("@/lib/sms/webhook.server");
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

        const { duplicate, failed, reason, state } = await recordWebhookEvent({
          providerId: "telnyx",
          eventId,
          eventType: flat.eventType ?? "unknown",
          payload,
          businessId: sender.businessId,
          signatureVerified: true,
        });
        // A real persistence failure must never be acknowledged: answer 503 so
        // Telnyx retries the delivery.
        if (failed) {
          logWebhook("error", "telnyx", {
            outcome: "persist_failed",
            eventType: flat.eventType,
            eventIdSource: source,
            businessId: sender.businessId,
            reason: reason ?? null,
          });
          return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
        }
        if (duplicate) {
          // Only a completed event may be acknowledged. An event another worker
          // is still processing must answer non-2xx so Telnyx redelivers later.
          const inProgress = state === "duplicate_in_progress";
          logWebhook(inProgress ? "warn" : "info", "telnyx", {
            outcome: inProgress ? "duplicate_in_progress" : "duplicate_processed",
            eventType: flat.eventType,
            eventIdSource: source,
            businessId: sender.businessId,
          });
          return inProgress
            ? Response.json({ ok: false, processing: true }, { status: 409 })
            : Response.json({ ok: true, duplicate: true });
        }

        // processed_at is only written once all downstream work succeeded; a
        // failure leaves the event durably retryable and answers non-2xx.
        try {
          let body: Record<string, unknown> = { ok: true, ignored: flat.eventType };
          let status = 200;

          if (inbound) {
            const result = await handleInboundMessage({
              providerName: "telnyx",
              payload,
              sender,
            });
            body = result as unknown as Record<string, unknown>;
            status = result.handled ? 200 : 202;
          } else if (flat.eventType === "message.sent" || flat.eventType === "message.finalized") {
            const result = await handleDeliveryStatus({
              providerName: "telnyx",
              payload,
              sender,
              ...(flat.eventType === "message.finalized" && flat.cost !== null
                ? { providerCost: flat.cost }
                : {}),
            });
            body = result as unknown as Record<string, unknown>;
          }

          const marked = await markWebhookProcessed("telnyx", eventId);
          if (!marked.ok) {
            logWebhook("error", "telnyx", {
              outcome: "mark_processed_failed",
              eventType: flat.eventType,
              eventIdSource: source,
              businessId: sender.businessId,
              reason: marked.reason ?? null,
            });
            return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
          }
          return Response.json(body, { status });
        } catch (error) {
          await markWebhookFailed("telnyx", eventId, error);
          logWebhook("error", "telnyx", {
            outcome: "processing_failed",
            eventType: flat.eventType,
            eventIdSource: source,
            businessId: sender.businessId,
            reason: error instanceof Error ? error.message : String(error),
          });
          return Response.json({ ok: false, error: "Processing failed" }, { status: 503 });
        }
      },
    },
  },
});
