import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/bookings')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'records:read', 'list_bookings');
        if (caller instanceof Response) return caller;
        const { clampLimit } = await import('@/lib/api-keys');
        const url = new URL(request.url);
        const limit = clampLimit(url.searchParams.get('limit'));
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        const fromRaw = url.searchParams.get('from'); const toRaw = url.searchParams.get('to');
        const from = fromRaw && !Number.isNaN(Date.parse(fromRaw)) ? new Date(fromRaw).toISOString() : new Date().toISOString();
        const to = toRaw && !Number.isNaN(Date.parse(toRaw)) ? new Date(toRaw).toISOString() : null;
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        let q = supabaseAdmin.from('jobs')
          .select('id, lead_id, scheduled_at, service_performed, completion_status, leads(name)', { count: 'exact' })
          .eq('business_id', caller.businessId).not('scheduled_at', 'is', null).gte('scheduled_at', from)
          .order('scheduled_at', { ascending: true }).range(offset, offset + limit - 1);
        if (to) q = q.lte('scheduled_at', to);
        const { data, error, count } = await q;
        if (error) { await logApiRequest(caller, 'list_bookings', 500, 'read_failed'); return apiError(500, 'server_error', 'Could not read bookings.'); }
        await logApiRequest(caller, 'list_bookings', 200);
        const bookings = (data ?? []).map((j) => ({
          id: j.id, customer_id: j.lead_id, customer_name: (j.leads as { name?: string } | null)?.name ?? null,
          scheduled_at: j.scheduled_at, service: j.service_performed, status: j.completion_status,
        }));
        return apiOk({ bookings, total: count ?? 0, limit, offset });
      },
    },
  },
});
