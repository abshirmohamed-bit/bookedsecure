import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWebMCP } from 'use-webmcp-tool';
import { useState } from 'react';
import { Ban, Bot, CheckCircle2, Copy, Link2, Plug, ShieldCheck, Sparkles, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { runWebMCPTool } from '@/lib/webmcp-telemetry';
import { TenantAiPanel } from '@/components/settings/TenantAiPanel';
import { McpConnectionTest } from '@/components/settings/McpConnectionTest';
import { ApiKeysPanel } from '@/components/settings/ApiKeysPanel';
import { FacebookLeadSyncPanel } from '@/components/settings/FacebookLeadSyncPanel';

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
  const [tab, setTab] = useState('assistants');
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
  const connectedCount = grants.data?.length ?? 0;
  const copyEndpoint = async () => { try { await navigator.clipboard.writeText(endpoint); toast.success('Connection address copied.'); } catch { toast.error('Could not copy. Select the address instead.'); } };
  const tiles = [
    { value: 'assistants', icon: Bot, title: 'AI assistants', text: grants.isSuccess ? `${connectedCount} connected` : 'ChatGPT, Claude, Grok' },
    { value: 'backup', icon: ShieldCheck, title: 'Backup AI', text: 'Keeps Cowork running' },
    { value: 'apps', icon: Plug, title: 'Apps & leads', text: 'Facebook, API keys' },
  ];
  return <AppShell title="AI connections"><div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
    <header className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-6 sm:p-10">
      <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/10 blur-3xl" aria-hidden />
      <div className="relative space-y-3">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><Sparkles className="h-3.5 w-3.5" />Connections</span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">AI connections</h1>
        <p className="max-w-xl text-muted-foreground">Connect your AI assistants and apps to BookedSecure. You stay in control: every reply and campaign still needs your Confirm.</p>
      </div>
    </header>
    <Tabs value={tab} onValueChange={setTab} className="space-y-6">
      <TabsList className="grid h-auto w-full grid-cols-1 gap-3 bg-transparent p-0 sm:grid-cols-3">
        {tiles.map(t => <TabsTrigger key={t.value} value={t.value} className="group h-auto justify-start gap-3 whitespace-normal rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 data-[state=active]:border-primary data-[state=active]:bg-primary/5 data-[state=active]:shadow-md">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground"><t.icon className="h-5 w-5" /></span>
          <span className="min-w-0"><span className="block font-semibold text-foreground">{t.title}</span><span className="block text-xs text-muted-foreground">{t.text}</span></span>
        </TabsTrigger>)}
      </TabsList>

      <TabsContent value="assistants" className="mt-0 space-y-6">
        <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 className="h-5 w-5" /></span>
            <div><h2 className="font-heading text-lg font-semibold">Your BookedSecure connection</h2><p className="text-sm text-muted-foreground">Paste this address into your assistant's custom connector settings.</p></div></div>
          <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/50 p-2 pl-4"><code className="min-w-0 flex-1 break-all font-mono text-sm">{endpoint}</code><Button size="sm" onClick={copyEndpoint}><Copy className="h-4 w-4" />Copy</Button></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[{ icon: CheckCircle2, title: 'Can do', text: 'Read records, manage customers, bookings, services and settings.' }, { icon: ShieldCheck, title: 'Needs your Confirm', text: 'Customer replies. Campaigns, imports and deletions go through Cowork.' }, { icon: Ban, title: 'Never', text: 'Payments are not available through this connection.' }].map(i => <div key={i.title} className="rounded-xl border border-border p-4"><i.icon className="mb-2 h-4 w-4 text-primary" /><p className="text-sm font-medium">{i.title}</p><p className="mt-1 text-xs text-muted-foreground">{i.text}</p></div>)}
          </div>
          <p className="text-xs text-muted-foreground">Works with assistants that support custom MCP connections with OAuth. Availability depends on the assistant, plan and rollout; ChatGPT, Claude or Grok support is not guaranteed.</p>
        </section>
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
          <div className="flex items-center justify-between gap-3"><h2 className="font-heading text-lg font-semibold">Connected assistants</h2>{grants.isSuccess ? <Badge variant="secondary">{connectedCount}</Badge> : null}</div>
          {grants.isPending && session ? <p className="text-sm text-muted-foreground">Loading connections…</p> : null}
          {grants.isError ? <div role="alert" className="space-y-2 text-sm"><p>Connections could not be loaded.</p><Button variant="outline" onClick={() => grants.refetch()}>Try again</Button></div> : null}
          {grants.isSuccess && !grants.data?.length ? <div className="rounded-xl border border-dashed border-border p-8 text-center"><Bot className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No assistants connected yet</p><p className="text-xs text-muted-foreground">Copy the address above into ChatGPT, Claude or Grok to start.</p></div> : null}
          <div className="divide-y divide-border">{(grants.data ?? []).map(grant => <div key={grant.client.id} className="flex items-center justify-between gap-4 py-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary">{grant.client.name.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><h3 className="break-words font-medium">{grant.client.name}</h3><p className="break-all text-xs text-muted-foreground">{grant.client.uri}</p></div></div><Button variant="outline" size="sm" disabled={revoke.isPending} onClick={() => { if (window.confirm(`Disconnect ${grant.client.name}? Previously shared data will not be removed from that assistant.`)) revoke.mutate(grant.client.id); }}><Unplug className="h-4 w-4" />Disconnect</Button></div>)}</div>
          <p className="text-xs text-muted-foreground">Disconnecting revokes access. An already-issued token may stay valid until it expires.</p>
        </section>
        <McpConnectionTest key={session?.user.id ?? 'signed-out'} signedIn={Boolean(session)} accountId={session?.user.id} />
      </TabsContent>

      <TabsContent value="backup" className="mt-0"><TenantAiPanel /></TabsContent>

      <TabsContent value="apps" className="mt-0 space-y-6">
        <FacebookLeadSyncPanel enabled={Boolean(session)} />
        <ApiKeysPanel enabled={Boolean(session)} />
      </TabsContent>
    </Tabs>
  </div></AppShell>;
}