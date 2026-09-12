import { createFileRoute } from "@tanstack/react-router";

/**
 * Stripe webhook for the paid pilot.
 *
 * Every request must carry a valid `stripe-signature`; unsigned or stale
 * payloads are rejected before any database write. Event ids are stored in
 * `stripe_events`, so redelivery has no additional effect.
 */
export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env") ?? "sandbox";
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          return Response.json({ received: true, ignored: "invalid env" });
        }

        const { verifyWebhook } = await import("@/lib/stripe.server");
        let event: { id: string; type: string; created: number; data: { object: any } };
        try {
          event = await verifyWebhook(request, rawEnv);
        } catch (error) {
          console.error("[stripe-webhook] rejected:", error);
          return new Response("Invalid signature", { status: 400 });
        }

        try {
          const { processStripeEvent } = await import("@/lib/billing.server");
          const result = await processStripeEvent(event, rawEnv);
          return Response.json(result);
        } catch (error) {
          console.error("[stripe-webhook] processing error:", error);
          return new Response("Webhook processing error", { status: 500 });
        }
      },
    },
  },
});
