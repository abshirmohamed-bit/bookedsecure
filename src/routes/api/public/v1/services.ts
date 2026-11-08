import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/services')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, null, 'list_services');
        if (caller instanceof Response) return caller;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { data, error } = await supabaseAdmin.from('services').select('id, name, price_guidance')
          .eq('business_id', caller.businessId).eq('active', true).order('name').limit(200);
        if (error) { await logApiRequest(caller, 'list_services', 500, 'read_failed'); return apiError(500, 'server_error', 'Could not read services.'); }
        await logApiRequest(caller, 'list_services', 200);
        return apiOk({ services: data ?? [] });
      },
    },
  },
});
