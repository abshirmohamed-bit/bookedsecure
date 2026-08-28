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

        const { getProvider } = await import("@/lib/sms/provider.server");
        const { recordWebhookEvent, resolveEventId, logWebhook } = await import(
          "@/lib/sms/webhook.server"
        );
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
          logWebhook("error", "twilio", { outcome: "rejected", reason: verification.reason ?? null });
          return new Response("Unauthorized", { status: 401 });
        }

        const messageSid = String(payload["MessageSid"] ?? "");
        const statusValue = String(payload["MessageStatus"] ?? payload["SmsStatus"] ?? "");
        const { eventId, source } = await resolveEventId({
          providerId: "twilio",
          eventId: messageSid ? `${messageSid}:${statusValue}` : null,
          rawBody,
        });

        // On a status callback the sending number is "From".
        const fromNumber = String(payload["From"] ?? payload["from"] ?? "");
        const sender = fromNumber ? await findSenderByNumber(fromNumber) : null;
        if (!sender) {
          await recordWebhookEvent({
            providerId: "twilio",
            eventId: `unmatched:${eventId}`,
            eventType: "status_unmatched",
            payload,
            signatureVerified: true,
          });
          logWebhook("warn", "twilio", { outcome: "unmatched_number", eventIdSource: source });
          return Response.json({ ok: false, error: "Unknown sending number" }, { status: 404 });
        }

        const { duplicate } = await recordWebhookEvent({
          providerId: "twilio",
          eventId,
          eventType: "status",
          payload,
          businessId: sender.businessId,
          signatureVerified: true,
        });
        if (duplicate) {
          logWebhook("info", "twilio", {
            outcome: "duplicate_suppressed",
            eventType: "status",
            eventIdSource: source,
            businessId: sender.businessId,
          });
          return Response.json({ ok: true, duplicate: true });
        }

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
