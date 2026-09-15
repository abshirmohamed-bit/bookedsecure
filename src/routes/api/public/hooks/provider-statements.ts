import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/**
 * Scheduled rebuild of the platform's per-tenant cost/margin statements for
 * the current and previous month. Derived entirely from the cost ledger, so
 * running it twice changes nothing. Also re-checks the provider balance so a
 * low balance is noticed even in a quiet month.
 *
 * Platform-private: authenticated by the managed cron secret only.
 */
export const Route = createFileRoute("/api/public/hooks/provider-statements")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;

        const { monthKey, rebuildAllStatements, checkProviderBalance } = await import(
          "@/lib/provider-costs.server"
        );
        const now = new Date();
        const thisMonth = monthKey(now);
        const previous = monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));

        const current = await rebuildAllStatements(thisMonth);
        const prior = await rebuildAllStatements(previous);
        const balance = await checkProviderBalance();

        return Response.json({
          months: { [thisMonth]: current.rebuilt, [previous]: prior.rebuilt },
          providerBalance: balance,
        });
      },
    },
  },
});
