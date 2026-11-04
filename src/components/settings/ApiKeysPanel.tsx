import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Copy, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/api-keys.functions';
import type { ApiAccessLevel } from '@/lib/api-keys';

const BASE = 'https://bookedsecure.com/api/public/v1';

async function copy(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); toast.success(`${label} copied.`); } catch { toast.error('Could not copy. Select the text instead.'); }
}

export function ApiKeysPanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listApiKeys); const create = useServerFn(createApiKey); const revoke = useServerFn(revokeApiKey);
  const keys = useQuery({ queryKey: ['api-keys'], enabled, queryFn: () => list() });
  const [name, setName] = useState('Make.com – Meta leads');
  const [access, setAccess] = useState<ApiAccessLevel>('leads_only');
  const [newKey, setNewKey] = useState<string | null>(null);
  const createM = useMutation({ mutationFn: () => create({ data: { name, access } }), onSuccess: async (r) => { setNewKey(r.key); await qc.invalidateQueries({ queryKey: ['api-keys'] }); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not create the key.') });
  const revokeM = useMutation({ mutationFn: (id: string) => revoke({ data: { id } }), onSuccess: async () => { toast.success('Key revoked.'); await qc.invalidateQueries({ queryKey: ['api-keys'] }); }, onError: () => toast.error('Could not revoke the key.') });

  return <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><KeyRound className="h-5 w-5 text-primary" />API keys</h2>
    <p className="text-sm text-muted-foreground">Connect Make.com, Zapier, n8n or any tool that supports API keys. Use these for sending leads in (for example Meta Lead Ads through Make.com). AI assistants use the connection above instead.</p>

    <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={(e) => { e.preventDefault(); createM.mutate(); }}>
      <Input aria-label="Key name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <select aria-label="Access" className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={access} onChange={(e) => setAccess(e.target.value as ApiAccessLevel)}>
        <option value="leads_only">Add leads only</option>
        <option value="read_write">Add leads + read customers & bookings</option>
        <option value="social_comments">Facebook comment inbox only</option>
        <option value="full">Leads, records + comment inbox</option>
      </select>
      <Button type="submit" disabled={createM.isPending || name.trim().length < 2}>Create key</Button>
    </form>

    {newKey ? <div role="status" className="space-y-2 rounded-md border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-medium">Copy this key now. It won't be shown again.</p>
      <div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-muted p-2 text-xs">{newKey}</code><Button variant="outline" size="icon" aria-label="Copy API key" onClick={() => copy(newKey, 'API key')}><Copy className="h-4 w-4" /></Button></div>
      <Button variant="ghost" size="sm" onClick={() => setNewKey(null)}>Done</Button>
    </div> : null}

    {keys.isError ? <p role="alert" className="text-sm">API keys could not be loaded.</p> : null}
    {keys.isSuccess && !keys.data.length ? <p className="text-sm text-muted-foreground">No API keys yet.</p> : null}
    <ul className="divide-y divide-border">
      {(keys.data ?? []).map((k) => <li key={k.id} className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0">
          <p className="break-words font-medium">{k.name} {k.revoked_at ? <span className="text-xs text-muted-foreground">(revoked)</span> : null}</p>
          <p className="text-xs text-muted-foreground">{k.key_prefix}…{k.key_last4} · {k.scopes.includes('records:read') ? 'Leads + read' : 'Add leads only'} · {k.request_count} requests · {k.last_used_at ? `last used ${new Date(k.last_used_at).toLocaleString()}` : 'never used'}</p>
        </div>
        {!k.revoked_at ? <Button variant="outline" size="sm" disabled={revokeM.isPending} onClick={() => { if (window.confirm(`Revoke "${k.name}"? Anything using it will stop working immediately.`)) revokeM.mutate(k.id); }}>Revoke</Button> : null}
      </li>)}
    </ul>

    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Set up Make.com with Meta Lead Ads</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted-foreground">
        <li>In Make.com, start a scenario with <b>Facebook Lead Ads → Watch Leads</b> and pick your page and form.</li>
        <li>Add <b>HTTP → Make a request</b>. Method <b>POST</b>, URL <code className="break-all">{BASE}/leads</code>.</li>
        <li>Add a header <b>Authorization</b> with value <code>Bearer</code> followed by a space and your key.</li>
        <li>Body type <b>Raw</b>, content type <b>JSON</b>, and map the lead fields, for example:
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{`{
  "name": "{{full_name}}",
  "mobile": "{{phone_number}}",
  "email": "{{email}}",
  "service": "{{your service question}}",
  "source": "Meta (via Make.com)",
  "campaign": "{{campaign_name}}",
  "ad_name": "{{ad_name}}",
  "form_name": "{{form_name}}",
  "external_id": "{{leadgen_id}}"
}`}</pre></li>
        <li>Run once. A new lead appears in BookedSecure and gets your normal instant reply.</li>
      </ol>
      <p className="mt-3 text-muted-foreground">Developers: <button type="button" className="underline" onClick={() => copy(`${BASE}/openapi.json`, 'API description link')}>copy the API description link</button>.</p>
    </details>
  </section>;
}
