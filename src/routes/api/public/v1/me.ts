import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/me')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, logApiRequest, apiError } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, null, 'me');
        if (caller instanceof Response) return caller;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data, error } = await supabaseAdmin.from('businesses').select('name').eq('id', caller.businessId).maybeSingle();
        if (error || !data) return apiError(500, 'server_error', 'Could not load the business.');
        await logApiRequest(caller, 'me', 200);
        return apiOk({ business: { name: data.name }, scopes: caller.scopes });
      },
    },
  },
});
