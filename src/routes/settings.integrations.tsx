import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWebMCP } from 'use-webmcp-tool';
import { Copy, Link2, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { runWebMCPTool } from '@/lib/webmcp-telemetry';

export const Route = createFileRoute('/settings/integrations')({
  head: () => ({ meta: [
    { title: 'AI connections | BookedSecure' }, { name: 'description', content: 'Manage secure assistant connections to your BookedSecure business.' },
    { property: 'og:title', content: 'AI connections | BookedSecure' }, { property: 'og:description', content: 'Review connected assistants and revoke their account access.' },
    { property: 'og:type', content: 'website' }, { name: 'twitter:card', content: 'summary' },
  ] }),
  component: Connections,
});
const endpoint = 'https://bookedsecure.com/mcp';
function Connections() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['oauth-grants', session?.user.id];
  const grants = useQuery({ queryKey, enabled: Boolean(session), queryFn: async () => {
    const { data, error } = await supabase.auth.oauth.listGrants();
    if (error) throw error;
    return data;
  } });
  const revoke = useMutation({ mutationFn: async (clientId: string) => {
    const { error } = await supabase.auth.oauth.revokeGrant({ clientId });
    if (error) throw error;
  }, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey }); toast.success('Connection revoked.'); }, onError: () => toast.error('Could not disconnect. Please try again.') });
  useWebMCP({ name: 'read_ai_connections', description: 'Read the connected assistants currently shown on the AI connections page.', enabled: Boolean(session) && grants.isSuccess,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: () => runWebMCPTool('read_ai_connections', () => (grants.data ?? []).map(g => g.client.name).join(', ') || 'No connected assistants.'),
  });
  return <AppShell title="AI connections"><div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
    <header><h1 className="font-heading text-2xl font-semibold">AI connections</h1><p className="mt-2 text-sm text-muted-foreground">Your account, your business, your permissions.</p></header>
    <section className="space-y-4 border-b border-border pb-8"><h2 className="flex items-center gap-2 font-semibold"><Link2 className="h-5 w-5 text-primary" />Book​edSecure connection</h2>
      <div className="flex min-w-0 items-center gap-3"><code className="min-w-0 flex-1 break-all rounded-md bg-muted p-3 text-sm">{endpoint}</code><Button variant="outline" size="icon" aria-label="Copy connection address" title="Copy connection address" onClick={async () => { try { await navigator.clipboard.writeText(endpoint); toast.success('Connection address copied.'); } catch { toast.error('Could not copy. Select the address instead.'); } }}><Copy className="h-4 w-4" /></Button></div>
      <p className="text-sm text-muted-foreground">For assistants that support custom MCP connections with OAuth. Availability depends on the assistant, account plan and rollout; support in ChatGPT, Claude or Grok is not guaranteed.</p>
      <p className="text-sm">Enabled access: read leads and bookings; update lead notes; schedule or move owner-entered bookings. No messages, deletions or payments.</p>
    </section>
    <section className="space-y-4"><h2 className="font-semibold">Connected assistants</h2>
      {grants.isPending && session ? <p className="text-sm text-muted-foreground">Loading connections…</p> : null}
      {grants.isError ? <div role="alert" className="space-y-2 text-sm"><p>Connections could not be loaded.</p><Button variant="outline" onClick={() => grants.refetch()}>Try again</Button></div> : null}
      {grants.isSuccess && !grants.data?.length ? <p className="text-sm text-muted-foreground">No assistants connected yet.</p> : null}
      {(grants.data ?? []).map(grant => <div key={grant.client.id} className="flex items-center justify-between gap-4 border-b border-border py-4"><div className="min-w-0"><h3 className="break-words font-medium">{grant.client.name}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{grant.client.uri}</p></div><Button variant="outline" disabled={revoke.isPending} onClick={() => { if (window.confirm(`Disconnect ${grant.client.name}? Previously shared data will not be removed from that assistant.`)) revoke.mutate(grant.client.id); }}><Unplug className="h-4 w-4" />Disconnect</Button></div>)}
      <p className="text-xs text-muted-foreground">Disconnecting revokes the grant. An already-issued access token may remain valid until it expires.</p>
    </section>
  </div></AppShell>;
}