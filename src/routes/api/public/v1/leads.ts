import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/public/v1/leads')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      POST: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'leads:write', 'create_lead');
        if (caller instanceof Response) return caller;
        const { apiLeadSchema, apiSourceChannel } = await import('@/lib/api-keys');
        let body: unknown;
        try { body = await request.json(); } catch { body = null; }
        const parsed = apiLeadSchema.safeParse(body);
        if (!parsed.success) {
          await logApiRequest(caller, 'create_lead', 400, 'invalid_body');
          return Response.json({ ok: false, error: { code: 'invalid_body', message: 'Check the lead fields.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: (await import('@/lib/api-keys.server')).API_CORS });
        }
        const lead = parsed.data;
        const idem = lead.external_id || request.headers.get('idempotency-key')?.slice(0, 120) || null;
        const source = lead.source || 'API';
        try {
          const { captureLead } = await import('@/lib/lead-engine.server');
          const result = await captureLead({
            businessId: caller.businessId,
            name: lead.name,
            mobile_number: lead.mobile,
            email: lead.email || null,
            suburb: lead.suburb ?? null,
            service_address: lead.address ?? null,
            vehicle_type: lead.vehicle ?? null,
            main_concerns: lead.message ?? null,
            service_intent: lead.service ?? null,
            source_channel: apiSourceChannel(source),
            source_campaign: lead.campaign ?? null,
            source_form: lead.form_name ?? null,
            utm_source: source.slice(0, 80),
            utm_campaign: lead.ad_name ?? lead.campaign ?? null,
            consent: lead.consent,
            consent_text: lead.consent ? `Consent supplied by ${source} via the BookedSecure API.` : 'No explicit SMS consent supplied with this API lead.',
            lead_origin: 'api',
            source_metadata: { api_key_id: caller.keyId, source, ad_name: lead.ad_name ?? null },
            external_id: idem ? `api:${caller.keyId}:${idem}` : null,
          });
          await logApiRequest(caller, 'create_lead', result.duplicate ? 200 : 201, result.duplicate ? 'duplicate' : 'created');
          return apiOk({ lead_id: result.leadId, duplicate: result.duplicate, acknowledgement_sent: result.acknowledgementSent }, result.duplicate ? 200 : 201);
        } catch (e) {
          await logApiRequest(caller, 'create_lead', 500, 'capture_failed');
          console.error('API lead capture failed', e instanceof Error ? e.message : e);
          return apiError(500, 'server_error', 'The lead could not be saved. Please retry.');
        }
      },
    },
  },
});
