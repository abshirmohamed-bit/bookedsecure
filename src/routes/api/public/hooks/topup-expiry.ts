import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled sweep: pending SMS credit top-ups whose checkout was abandoned
 * more than 24 hours ago are marked expired. Safe to run repeatedly; a late
 * Stripe payment still settles the row.
 *
 * Authentication is the managed server-side cron secret (Authorization:
 * Bearer …). The publishable key must never authorise this route.
 */
export const Route = createFileRoute("/api/public/hooks/topup-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { expireAbandonedTopups } = await import("@/lib/sms/credit-topups.server");
        const result = await expireAbandonedTopups(24);

        // Also top up any opted-in business whose balance has run low, so
        // credits recover even when no message is being sent right now.
        const { sweepAutoTopups } = await import("@/lib/sms/auto-topup.server");
        const autoTopups = await sweepAutoTopups();
        return Response.json({ ...result, autoTopups });
      },
    },
  },
});
