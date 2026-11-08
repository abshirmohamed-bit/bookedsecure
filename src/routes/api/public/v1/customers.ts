import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/customers')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'records:read', 'list_customers');
        if (caller instanceof Response) return caller;
        const { clampLimit } = await import('@/lib/api-keys');
        const url = new URL(request.url);
        const limit = clampLimit(url.searchParams.get('limit'));
        const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset')) || 0));
        const search = (url.searchParams.get('search') ?? '').trim().slice(0, 80).replace(/[,()%*\\]/g, ' ');
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        let q = supabaseAdmin.from('leads')
          .select('id, name, mobile_number, email, suburb, status, source_channel, created_at', { count: 'exact' })
          .eq('business_id', caller.businessId).is('deleted_at', null)
          .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
        if (search) {
          const digits = search.replace(/\D/g, '');
          const local = digits.startsWith('61') ? `0${digits.slice(2)}` : digits;
          const ors = [`name.ilike.%${search}%`, `email.ilike.%${search}%`];
          if (digits.length >= 6) ors.push(`mobile_number.ilike.%${local.slice(1)}%`);
          q = q.or(ors.join(','));
        }
        const { data, error, count } = await q;
        if (error) { await logApiRequest(caller, 'list_customers', 500, 'read_failed'); return apiError(500, 'server_error', 'Could not read customers.'); }
        await logApiRequest(caller, 'list_customers', 200);
        return apiOk({ customers: (data ?? []).map(({ mobile_number, ...r }) => ({ ...r, mobile: mobile_number })), total: count ?? 0, limit, offset });
      },
    },
  },
});
