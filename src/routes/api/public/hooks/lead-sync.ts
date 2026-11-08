import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

/** Every five minutes: imports new Facebook leads for each business with direct import switched on. */
export const Route = createFileRoute('/api/public/hooks/lead-sync')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauthorized = await authenticateCronRequest(request);
        if (unauthorized) return unauthorized;
        const { sweepScheduledSyncs } = await import('@/lib/lead-sync.server');
        return Response.json(await sweepScheduledSyncs());
      },
    },
  },
});
