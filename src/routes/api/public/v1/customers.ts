import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/customers')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { listCustomersResponse } = await import('@/lib/api-records.server');
        return listCustomersResponse(request);
      },
    },
  },
});
