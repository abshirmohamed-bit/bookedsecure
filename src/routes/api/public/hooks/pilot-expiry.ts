import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled pilot expiry pass. Paid pilots whose 30-day window has elapsed
 * lose live-sending access immediately. Safe to run repeatedly.
 *
 * Authentication is the managed server-side cron secret (Authorization:
 * Bearer …). The publishable key must never authorise this route.
 */
export const Route = createFileRoute("/api/public/hooks/pilot-expiry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { processPilotExpiry } = await import("@/lib/billing.server");
        const result = await processPilotExpiry();
        return Response.json(result);
      },
    },
  },
});
