import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { disconnectLeadSync, getLeadSync, getRunItems, importLeadsNow, saveLeadSync } from '@/lib/lead-sync.functions';
import { LEAD_SYNC_LOOKBACK_OPTIONS, isAllowedTriggerUrl } from '@/lib/lead-sync';

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const STATUS: Record<string, string> = { requested: 'Waiting for Make', running: 'Importing', completed: 'Done', partial: 'Done with problems', failed: 'Failed', expired: 'No reply from Make' };

function RunItems({ runId }: { runId: string }) {
  const load = useServerFn(getRunItems);
  const items = useQuery({ queryKey: ['lead-sync-items', runId], queryFn: () => load({ data: { runId } }) });
  if (items.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (items.isError) return <p role="alert" className="text-xs">Details could not be loaded.</p>;
  const problems = (items.data ?? []).filter((i) => i.outcome === 'skipped' || i.outcome === 'failed');
  if (!problems.length) return <p className="text-xs text-muted-foreground">No skipped or failed leads in this import.</p>;
  return <ul className="space-y-1 text-xs">{problems.map((i) => <li key={i.id}><span className="font-medium">{i.display_name ?? `Lead …${i.meta_lead_id.slice(-4)}`}</span> · {i.form_name ?? 'form'} · {i.reason}</li>)}</ul>;
}

export function FacebookLeadSyncPanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(getLeadSync); const save = useServerFn(saveLeadSync); const run = useServerFn(importLeadsNow); const disconnect = useServerFn(disconnectLeadSync);
  const q = useQuery({ queryKey: ['lead-sync'], enabled, queryFn: () => load(), refetchInterval: (query) => (query.state.data?.runs.some((r) => r.status === 'requested' || r.status === 'running') ? 5000 : false) });
  const [url, setUrl] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead-sync'] });
  const saveM = useMutation({ mutationFn: (d: { trigger_url?: string; auto_sync_enabled?: boolean; initial_lookback_days?: number }) => save({ data: d }), onSuccess: async () => { setUrl(''); toast.success('Saved.'); await refresh(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save.') });
  const runM = useMutation({ mutationFn: () => run(), onSuccess: async (r) => { if (r.started) toast.success('Import started. New leads will appear shortly.'); else toast.error(r.reason); await refresh(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not start the import.') });
  const discM = useMutation({ mutationFn: () => disconnect(), onSuccess: async () => { toast.success('Disconnected.'); await refresh(); } });

  const c = q.data?.connection;
  const connected = Boolean(c?.has_trigger) && c?.status !== 'disconnected';
  const active = q.data?.runs.some((r) => r.status === 'requested' || r.status === 'running');

  return <section className="space-y-4 border-b border-border pb-8">
    <h2 className="flex items-center gap-2 font-semibold"><Download className="h-5 w-5 text-primary" />Facebook lead import</h2>
    <p className="text-sm text-muted-foreground">Bring quote requests from your Facebook lead forms into your leads. Your Make scenario fetches them; BookedSecure saves each one once and never texts them unless they agreed to be contacted.</p>
    {q.isError ? <p role="alert" className="text-sm">This could not be loaded.</p> : null}

    <form className="grid gap-2 sm:grid-cols-[1fr_auto]" onSubmit={(e) => { e.preventDefault(); saveM.mutate({ trigger_url: url.trim() }); }}>
      <Input aria-label="Make webhook address" placeholder={connected ? `Connected (${c?.trigger_hint}) — paste a new address to replace` : 'Make webhook address (https://hook.…make.com/…)'} value={url} onChange={(e) => setUrl(e.target.value)} />
      <Button type="submit" disabled={saveM.isPending || !isAllowedTriggerUrl(url)}>{connected ? 'Reconnect' : 'Connect'}</Button>
    </form>

    {c ? <div className="grid gap-3 text-sm sm:grid-cols-2">
      <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <span>Check for new leads every 5 minutes</span>
        <Switch checked={c.auto_sync_enabled} disabled={!connected || saveM.isPending} onCheckedChange={(v) => saveM.mutate({ auto_sync_enabled: v })} />
      </label>
      <label className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <span>First import looks back</span>
        <select className="h-9 rounded-md border border-input bg-background px-2" value={c.initial_lookback_days} onChange={(e) => saveM.mutate({ initial_lookback_days: Number(e.target.value) })}>
          {LEAD_SYNC_LOOKBACK_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
        </select>
      </label>
      <p className="text-muted-foreground">Last successful import: <span className="text-foreground">{when(c.last_success_at)}</span></p>
      <p className="text-muted-foreground">Next automatic check: <span className="text-foreground">{c.auto_sync_enabled && connected ? when(c.next_check_at) : 'Off'}</span></p>
    </div> : null}

    {c?.last_error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{c.last_error}</p> : null}

    <div className="flex flex-wrap gap-2">
      <Button disabled={!connected || runM.isPending || active} onClick={() => runM.mutate()}><RefreshCw className="mr-2 h-4 w-4" />{active ? 'Importing…' : 'Import new leads now'}</Button>
      {connected ? <Button variant="outline" disabled={discM.isPending} onClick={() => { if (window.confirm('Disconnect Facebook lead import? Automatic checks will stop.')) discM.mutate(); }}>Disconnect</Button> : null}
    </div>

    {q.data?.forms.length ? <p className="text-xs text-muted-foreground">Forms seen: {q.data.forms.map((f) => `${f.form_name ?? f.form_id} (up to ${when(f.last_submitted_at)})`).join(' · ')}</p> : null}

    {q.data?.runs.length ? <div className="space-y-2">
      <h3 className="text-sm font-medium">Import history</h3>
      <ul className="divide-y divide-border text-sm">
        {q.data.runs.map((r) => <li key={r.id} className="py-2">
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span>{when(r.requested_at)} · {r.trigger_kind === 'manual' ? 'Manual' : 'Automatic'} · {STATUS[r.status] ?? r.status}</span>
            <span className="text-xs text-muted-foreground">{r.created_count} new · {r.duplicate_count} already in · {r.skipped_count} skipped · {r.failed_count} failed</span>
          </button>
          {r.error ? <p className="text-xs text-muted-foreground">{r.error}</p> : null}
          {open === r.id ? <div className="mt-2"><RunItems runId={r.id} /></div> : null}
        </li>)}
      </ul>
    </div> : null}

    <details className="rounded-md border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">How to set up the Make scenario</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>Create a scenario that starts with a <b>Custom webhook</b>. Paste its address above.</li>
        <li>Add Facebook Lead Ads <b>list leads</b> for your form, filtered to leads after <code>since</code> (sent by BookedSecure).</li>
        <li>Send them with an HTTP POST to <code>callback_url</code> using a BookedSecure “Add leads only” key in the <code>X-API-Key</code> header. Body: <code>{'{"leads":[{"meta_lead_id","form_id","form_name","page_id","created_time","field_data"}],"final":true}'}</code>. Send up to 100 leads per request; set <code>final</code> true on the last one.</li>
        <li>Turn the scenario ON.</li>
      </ol>
    </details>
  </section>;
}
