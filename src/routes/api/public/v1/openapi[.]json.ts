import { createFileRoute } from '@tanstack/react-router';
import { buildOpenApiSpec } from '@/lib/api-openapi';

export const Route = createFileRoute('/api/public/v1/openapi.json')({
  server: {
    handlers: {
      GET: async ({ request }) => Response.json(buildOpenApiSpec(new URL(request.url).origin), { headers: { 'Access-Control-Allow-Origin': '*' } }),
    },
  },
});
