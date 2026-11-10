import { createFileRoute } from '@tanstack/react-router';

/** Packages, sizes, add-ons and booking rules for a website's own booking screens. */
export const Route = createFileRoute('/api/public/v1/booking/options')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'bookings:write', 'booking_options');
        if (caller instanceof Response) return caller;
        try {
          const { bookingOptions } = await import('@/lib/booking-engine.server');
          const options = await bookingOptions(caller.businessId);
          await logApiRequest(caller, 'booking_options', 200);
          return apiOk(options);
        } catch (e) {
          console.error('[booking-api] options failed', e instanceof Error ? e.message : e);
          await logApiRequest(caller, 'booking_options', 500, 'read_failed');
          return apiError(500, 'server_error', 'Could not read the booking options.');
        }
      },
    },
  },
});
