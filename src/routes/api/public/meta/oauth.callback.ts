import { createFileRoute } from '@tanstack/react-router';

/**
 * Facebook redirects here after an owner signs in to connect their Page for
 * direct lead import. The signed `state` identifies the business and owner.
 * Only a short outcome code is put in the return address, never tokens or reasons.
 */
export const Route = createFileRoute('/api/public/meta/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { readMetaAppConfig } = await import('@/lib/meta-oauth.server');
        const url = new URL(request.url);
        const back = (outcome: string, why?: string) => new Response(null, {
          status: 302,
          headers: { Location: `${readMetaAppConfig().appUrl}/settings/integrations?facebook=${outcome}${why ? `&why=${encodeURIComponent(why)}` : ''}`, 'Cache-Control': 'no-store' },
        });
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (url.searchParams.get('error') || !code) return back('denied');
        if (!state || code.length > 2048 || state.length > 1024) return back('failed');
        try {
          const { completeMetaConnect } = await import('@/lib/meta-connect.server');
          return back(await completeMetaConnect(code, state));
        } catch (e) {
          const message = e instanceof Error ? e.message : '';
          const { MetaConnectError } = await import('@/lib/meta-oauth.server');
          // Only a step name and Facebook's numeric codes leave the server; never tokens or provider text.
          const why = e instanceof MetaConnectError ? e.reason.replace(/[^a-z0-9_-]/gi, '').slice(0, 60) : 'unexpected';
          console.error('facebook connect failed', why, message);
          if (/expired/i.test(message) && !(e instanceof MetaConnectError)) return back('expired');
          if (/No Facebook Page/i.test(message)) return back('nopage');
          return back('failed', why);
        }
      },
    },
  },
});
