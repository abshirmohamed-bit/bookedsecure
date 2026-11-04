import { createFileRoute } from '@tanstack/react-router';

/**
 * Make posts the Facebook leads it fetched for a BookedSecure import run here.
 * The caller's API key decides the business; the run must belong to that business.
 */
export const Route = createFileRoute('/api/public/v1/lead-sync/runs/$runId')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      POST: async ({ request, params }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest, API_CORS } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'leads:write', 'lead_sync_batch');
        if (caller instanceof Response) return caller;
        if (!/^[0-9a-f-]{36}$/i.test(params.runId)) return apiError(404, 'run_not_found', 'Import run not found.');
        const { syncBatchSchema } = await import('@/lib/lead-sync');
        let body: unknown;
        try { body = await request.json(); } catch { body = null; }
        const parsed = syncBatchSchema.safeParse(body);
        if (!parsed.success) {
          await logApiRequest(caller, 'lead_sync_batch', 400, 'invalid_body');
          return Response.json({ ok: false, error: { code: 'invalid_body', message: 'Check the batch fields.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: API_CORS });
        }
        try {
          const { applyRunBatch } = await import('@/lib/lead-sync.server');
          const result = await applyRunBatch(caller.businessId, params.runId, parsed.data);
          if ('notFound' in result) { await logApiRequest(caller, 'lead_sync_batch', 404, 'run_not_found'); return apiError(404, 'run_not_found', 'Import run not found.'); }
          if ('closed' in result) { await logApiRequest(caller, 'lead_sync_batch', 409, 'run_closed'); return apiError(409, 'run_closed', `This import run is already ${result.status}.`); }
          await logApiRequest(caller, 'lead_sync_batch', 200, result.status);
          return apiOk(result);
        } catch (e) {
          console.error('lead sync batch failed', e instanceof Error ? e.message : e);
          await logApiRequest(caller, 'lead_sync_batch', 500, 'batch_failed');
          return apiError(500, 'server_error', 'The batch could not be processed. Please retry.');
        }
      },
    },
  },
});
