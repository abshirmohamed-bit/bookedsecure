import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/.lovable/oauth/consent')({
  ssr: false,
  head: () => ({ meta: [
    { title: 'Connect your account | BookedSecure' },
    { name: 'description', content: 'Review and approve an assistant connection to your BookedSecure account.' },
    { property: 'og:title', content: 'Connect your account | BookedSecure' },
    { property: 'og:description', content: 'Securely authorize an assistant to work in your business.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' }, { name: 'robots', content: 'noindex' },
  ] }),
  validateSearch: (s: Record<string, unknown>) => ({ authorization_id: typeof s['authorization_id'] === 'string' ? s['authorization_id'] : '' }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error('This connection request is missing or expired. Start again from your assistant.');
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!data.session) throw redirect({ to: '/auth', search: { next: location.pathname + location.searchStr + location.hash } });
  },
  loader: async ({ location }) => {
    const id = new URLSearchParams(location.searchStr).get('authorization_id');
    if (!id) throw new Error('Missing connection request.');
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
    if (error) throw new Error('This connection request could not be loaded. It may have expired; start again from your assistant.');
    if (!data) throw new Error('No connection request was returned.');
    if ('redirect_url' in data) throw redirect({ href: data.redirect_url });
    return data;
  },
  pendingComponent: () => <main className="mx-auto max-w-lg p-8">Loading connection request…</main>,
  errorComponent: ({ error }) => <main className="mx-auto max-w-lg space-y-4 p-8"><h1 className="text-xl font-semibold">Could not connect to BookedSecure</h1><p role="alert">{error instanceof Error ? error.message : 'Could not load this connection. Please start again.'}</p><Button asChild variant="outline"><a href="/settings/integrations">Back to AI connections</a></Button></main>,
  component: Consent,
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(true); setError(null);
    try {
      const result = approve ? await supabase.auth.oauth.approveAuthorization(authorization_id) : await supabase.auth.oauth.denyAuthorization(authorization_id);
      if (result.error) throw result.error;
      if (!result.data?.redirect_url) throw new Error('The connection did not return a destination. Please try again.');
      window.location.assign(result.data.redirect_url);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete your decision.'); setBusy(false); }
  }
  return <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center space-y-6 px-6 py-10">
    <p className="font-semibold text-primary">BookedSecure</p>
    <h1 className="font-heading text-2xl font-semibold">Connect {details.client.name} to BookedSecure</h1>
    <p className="text-sm text-muted-foreground">This lets {details.client.name} use this app as you.</p>
    <dl className="space-y-3 text-sm"><div><dt className="text-muted-foreground">Signed in as</dt><dd>{details.user.email}</dd></div><div><dt className="text-muted-foreground">Client destination</dt><dd className="break-all">{details.redirect_uri}</dd></div></dl>
    <ul className="list-inside list-disc space-y-2 text-sm">{details.scope.split(/\s+/).filter(Boolean).map(scope => <li key={scope}>{({ openid: 'Identify your account', email: 'Share your email address', profile: 'Share your basic profile' } as Record<string, string>)[scope] ?? `Additional permission requested: ${scope}`}</li>)}</ul>
    <p className="text-sm">Read your leads and bookings. Owners with current access can update lead notes and schedule or move bookings. Sending messages, deleting records and payments are not enabled.</p>
    <p className="text-xs text-muted-foreground">Your business permissions still apply. You can disconnect this client in AI connections. Previously shared data remains with the client.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3"><Button disabled={busy} onClick={() => decide(true)}>Approve connection</Button><Button variant="outline" disabled={busy} onClick={() => decide(false)}>Cancel connection</Button></div>
    <Button variant="link" disabled={busy} onClick={async () => { await supabase.auth.signOut(); window.location.reload(); }}>Use another account</Button>
  </main>;
}