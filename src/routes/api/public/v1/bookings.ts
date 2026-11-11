import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/bookings')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { listBookingsResponse } = await import('@/lib/api-records.server');
        return listBookingsResponse(request);
      },
    },
  },
});
