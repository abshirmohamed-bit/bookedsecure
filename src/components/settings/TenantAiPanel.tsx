import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { KeyRound, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getTenantAiConnection, connectTenantAi, removeTenantAi, restoreLovableAi } from '@/lib/tenant-ai.functions';
import { AI_PROVIDER_LABELS, type TenantAiProvider } from '@/lib/tenant-ai';
import { useAuth } from '@/hooks/useAuth';

export function TenantAiPanel() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const read = useServerFn(getTenantAiConnection);
  const connect = useServerFn(connectTenantAi);
  const disconnect = useServerFn(removeTenantAi);
  const restore = useServerFn(restoreLovableAi);
  const queryKey = ['tenant-ai-connection', session?.user.id];
  const status = useQuery({ queryKey, queryFn: () => read(), enabled: Boolean(session), retry: false });
  const [provider, setProvider] = useState<TenantAiProvider>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({ mutationFn: async () => {
    const input = { provider, model, apiKey };
    setApiKey(''); setError(null);
    return connect({ data: input });
  }, onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); }, onError: (e) => setError(e instanceof Error ? e.message : 'Could not connect your AI account.') });
  const remove = useMutation({ mutationFn: () => disconnect(), onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); }, onError: () => setError('Could not remove your connection.') });
  const resume = useMutation({ mutationFn: () => restore(), onSuccess: () => { void queryClient.invalidateQueries({ queryKey }); }, onError: () => setError('Could not restore Lovable AI.') });
  const busy = save.isPending || remove.isPending || resume.isPending;
  return <section className="space-y-5 border-b border-border pb-8">
    <h2 className="flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-primary" />Backup AI account</h2>
    <p className="text-sm text-muted-foreground">Lovable AI stays first. If its credits run out, your connected AI account powers Cowork, quote conversations and AI drafts instead.</p>
    {status.isError ? <p role="alert" className="text-sm text-muted-foreground">Only business owners can manage backup AI accounts. If you are an owner, try loading this page again.</p> : null}
    {status.data?.connected ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm"><span className="font-medium">Connected</span> · {AI_PROVIDER_LABELS[status.data.provider as TenantAiProvider]} · {status.data.model}</p><Button variant="outline" disabled={busy} onClick={() => { if (window.confirm('Remove your backup AI account? AI will stop if Lovable credits run out.')) remove.mutate(); }}><Unplug className="h-4 w-4" />Remove connection</Button></div> : null}
    {status.data?.gatewayPaused ? <div className="space-y-3"><p className="text-sm">Lovable AI is paused after running out of credits. {status.data.connected ? 'Your backup account is in use.' : 'Connect a backup account to keep using AI.'}</p>{status.data.canRestoreGateway ? <Button variant="outline" disabled={busy} onClick={() => resume.mutate()}>Resume Lovable AI after top-up</Button> : null}</div> : null}
    {status.isSuccess ? <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="ai-provider">Provider</Label><Select value={provider} onValueChange={value => { setProvider(value as TenantAiProvider); setApiKey(''); setModel(''); }} disabled={busy}><SelectTrigger id="ai-provider"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(AI_PROVIDER_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="ai-model">Model ID</Label><Input id="ai-model" value={model} onChange={e => setModel(e.target.value)} placeholder="Model from your provider account" maxLength={150} required disabled={busy} /></div></div>
      <div className="space-y-2"><Label htmlFor="ai-key">API key</Label><Input id="ai-key" type="password" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={status.data.connected ? 'Enter a new key to replace your connection' : 'Paste your provider API key'} required disabled={busy} /></div>
      <p className="text-xs text-muted-foreground">The key is encrypted and never displayed again. A connection test uses your provider’s API. Chat subscriptions do not include API usage; your provider bills you directly. Your business and customer information is processed by that provider, with the same BookedSecure permissions and approval rules.</p>
      <Button type="submit" disabled={busy || !model.trim() || !apiKey.trim()}><KeyRound className="h-4 w-4" />{save.isPending ? 'Testing connection…' : status.data.connected ? 'Test and replace key' : 'Test and connect'}</Button>
    </form> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </section>;
}