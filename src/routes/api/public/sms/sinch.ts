import { createFileRoute } from "@tanstack/react-router";

/**
 * Sinch Engage webhook. PLACEHOLDER, fails closed.
 *
 * The route exists so the webhook URL can be reserved and reviewed, but it
 * rejects every request until the official Sinch webhook payload and signature
 * documentation is implemented in src/lib/sms/sinch.server.ts.
 *
 * TODO(sinch): once documented -
 *   1. verify the signature (fail closed on missing key/header),
 *   2. normalize the payload via the Sinch adapter,
 *   3. resolve the tenant from the receiving/sending number,
 *   4. de-duplicate with recordWebhookEvent (provider event id, hash fallback),
 *   5. dispatch to handleInboundMessage / handleDeliveryStatus.
 */
export const Route = createFileRoute("/api/public/sms/sinch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text();
        const { getProvider } = await import("@/lib/sms/provider.server");
        const { resolveEventId, recordWebhookEvent, logWebhook } = await import(
          "@/lib/sms/webhook.server"
        );

        const verification = await getProvider("sinch").verifyWebhook({
          url: request.url,
          params: {},
          headers: request.headers,
          rawBody,
        });

        // Always false today. Recorded (payload only, unverified) so that any
        // early provider traffic is visible for diagnosis, never acted on.
        const { eventId } = await resolveEventId({ providerId: "sinch", rawBody });
        await recordWebhookEvent({
          providerId: "sinch",
          eventId: `unverified:${eventId}`,
          eventType: "sinch_not_implemented",
          payload: {},
          signatureVerified: false,
        });
        logWebhook("error", "sinch", {
          outcome: "rejected_not_implemented",
          reason: verification.reason ?? null,
        });

        return new Response("Sinch webhook handling is not implemented yet", { status: 501 });
      },
    },
  },
});
