import { createFileRoute } from "@tanstack/react-router";

/**
 * Inbound SMS webhook (Twilio-compatible form body or JSON).
 * Order is: verify signature -> resolve the tenant from the receiving number ->
 * de-duplicate -> only then write anything.
 */
export const Route = createFileRoute("/api/public/sms/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { payload, rawBody } = await readPayload(request);
        const { getProvider } = await import("@/lib/sms/provider.server");
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
          logWebhook("error", "twilio", { outcome: "rejected", reason: verification.reason ?? null });
          return new Response("Unauthorized", { status: 401 });
        }

        const { eventId, source } = await resolveEventId({
          providerId: "twilio",
          eventId: String(payload["MessageSid"] ?? payload["message_id"] ?? "") || null,
          rawBody,
        });

        const toNumber = String(payload["To"] ?? payload["to"] ?? "");
        const sender = toNumber ? await findSenderByNumber(toNumber) : null;
        if (!sender) {
          await recordWebhookEvent({
            providerId: "twilio",
            eventId: `unmatched:${eventId}`,
            eventType: "inbound_unmatched",
            payload,
            signatureVerified: true,
          });
          logWebhook("warn", "twilio", { outcome: "unmatched_number", eventIdSource: source });
          return Response.json({ ok: false, error: "Unknown receiving number" }, { status: 404 });
        }

        // De-duplicate provider retries before doing any work.
        const { duplicate, failed, reason, state } = await recordWebhookEvent({
          providerId: "twilio",
          eventId,
          eventType: "inbound",
          payload,
          businessId: sender.businessId,
          signatureVerified: true,
        });
        // Never acknowledge an event that was not safely persisted.
        if (failed) {
          logWebhook("error", "twilio", {
            outcome: "persist_failed",
            eventType: "inbound",
            eventIdSource: source,
            businessId: sender.businessId,
            reason: reason ?? null,
          });
          return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
        }

        if (duplicate) {
          // An event still being processed elsewhere is never acknowledged as done.
          const inProgress = state === "duplicate_in_progress";
          logWebhook(inProgress ? "warn" : "info", "twilio", {
            outcome: inProgress ? "duplicate_in_progress" : "duplicate_processed",
            eventType: "inbound",
            eventIdSource: source,
            businessId: sender.businessId,
          });
          return inProgress
            ? Response.json({ ok: false, processing: true }, { status: 409 })
            : Response.json({ ok: true, duplicate: true });
        }

        // processed_at is written only after all downstream work succeeded.
        try {
          const result = await handleInboundMessage({
            providerName: sender.provider,
            payload: payload as never,
            sender,
          });
          const marked = await markWebhookProcessed("twilio", eventId);
          if (!marked.ok) {
            logWebhook("error", "twilio", {
              outcome: "mark_processed_failed",
              eventType: "inbound",
              eventIdSource: source,
              businessId: sender.businessId,
              reason: marked.reason ?? null,
            });
            return Response.json({ ok: false, error: "Persistence failed" }, { status: 503 });
          }
          return Response.json(result, { status: result.handled ? 200 : 202 });
        } catch (error) {
          await markWebhookFailed("twilio", eventId, error);
          logWebhook("error", "twilio", {
            outcome: "processing_failed",
            eventType: "inbound",
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
