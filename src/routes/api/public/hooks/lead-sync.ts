import { createFileRoute } from '@tanstack/react-router';
import { authenticateCronRequest } from '@/integrations/supabase/cron-auth';

/** Every five minutes: asks each opted-in business's Make scenario for new Facebook leads. */
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
