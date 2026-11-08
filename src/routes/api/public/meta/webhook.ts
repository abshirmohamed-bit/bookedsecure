import { createFileRoute } from '@tanstack/react-router';

/**
 * Facebook Lead Ads webhook. GET answers Facebook's subscription check; POST
 * receives "new lead" events, verified by the app-secret signature, and imports
 * each lead at once through the normal pipeline. A valid delivery is always
 * acknowledged with 200: anything that fails here is picked up by the five-minute
 * check, so Facebook never needs to retry (and can't cause duplicates).
 */
export const Route = createFileRoute('/api/public/meta/webhook')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { verifySubscription } = await import('@/lib/meta-webhook.server');
        const challenge = verifySubscription(new URL(request.url).searchParams);
        return challenge ? new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } }) : new Response('Forbidden', { status: 403 });
      },
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 200_000) return new Response('Too large', { status: 413 });
        const { validSignature, parseLeadgenEvents } = await import('@/lib/meta-webhook.server');
        const { readMetaAppConfig } = await import('@/lib/meta-oauth.server');
        if (!validSignature(raw, request.headers.get('x-hub-signature-256'), readMetaAppConfig().appSecret)) {
          return new Response('Invalid signature', { status: 401 });
        }
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }
        const events = parseLeadgenEvents(body);
        if (!events.length) return new Response('ok', { status: 200 });

        const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
        const { importWebhookLead } = await import('@/lib/lead-sync.server');
        const pageIds = [...new Set(events.map((e) => e.pageId))];
        const { data: accounts, error } = await supabaseAdmin.from('meta_lead_accounts').select('business_id, page_id').in('page_id', pageIds);
        if (error) { console.error('facebook webhook: account lookup failed', error.code); return new Response('ok', { status: 200 }); }
        for (const event of events) {
          for (const acct of (accounts ?? []).filter((a) => a.page_id === event.pageId)) {
            try {
              const { outcome } = await importWebhookLead(acct.business_id, event.leadgenId);
              console.log('facebook webhook lead', outcome);
            } catch (e) {
              // Controlled messages only; the five-minute check will retry this lead.
              console.error('facebook webhook import failed', e instanceof Error ? e.message : 'unknown');
            }
          }
        }
        return new Response('ok', { status: 200 });
      },
    },
  },
});
