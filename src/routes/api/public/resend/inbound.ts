import { createFileRoute } from "@tanstack/react-router";

/**
 * Resend inbound webhook (event email.received). Verified with the Svix
 * signature (RESEND_WEBHOOK_SECRET); customer replies to campaign emails are
 * matched by their reply+<recipient id> address and stored for Campaigns → Replies.
 */
export const Route = createFileRoute("/api/public/resend/inbound")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleResendWebhook } = await import("@/lib/email-inbound.server");
        return handleResendWebhook(request);
      },
    },
  },
});
