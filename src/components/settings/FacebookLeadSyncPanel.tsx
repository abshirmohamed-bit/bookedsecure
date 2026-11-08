import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Download, Link2, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getLeadSync, getRunItems } from '@/lib/lead-sync.functions';
import { LEAD_SYNC_LOOKBACK_OPTIONS } from '@/lib/lead-sync';
import { chooseMetaPage, disconnectDirectMeta, enableInstantLeads, importDirectMetaNow, listMetaForms, saveDirectMeta, saveMetaForms, startMetaConnect, testDirectMetaAccess } from '@/lib/meta-direct.functions';

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const TRIGGER: Record<string, string> = { manual: 'Manual', schedule: 'Automatic', webhook: 'Instant' };
const STATUS: Record<string, string> = { requested: 'Starting', running: 'Importing', completed: 'Done', partial: 'Done with problems', failed: 'Failed', expired: 'Stopped before finishing' };

function RunItems({ runId }: { runId: string }) {
  const load = useServerFn(getRunItems);
  const items = useQuery({ queryKey: ['lead-sync-items', runId], queryFn: () => load({ data: { runId } }) });
  if (items.isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (items.isError) return <p role="alert" className="text-xs">Details could not be loaded.</p>;
  const problems = (items.data ?? []).filter((i) => i.outcome === 'skipped' || i.outcome === 'failed');
  if (!problems.length) return <p className="text-xs text-muted-foreground">No skipped or failed leads in this import.</p>;
  return <ul className="space-y-1 text-xs">{problems.map((i) => <li key={i.id}><span className="font-medium">{i.display_name ?? `Lead …${i.meta_lead_id.slice(-4)}`}</span> · {i.form_name ?? 'form'} · {i.reason}</li>)}</ul>;
}

type DirectInfo = {
  available: boolean;
  setupError: string | null;
  page: { id: string; name: string | null; formCount: number; connectedAt: string | null } | null;
  pendingPages: { id: string; name: string }[];
  connection: { auto_sync_enabled: boolean; initial_lookback_days: number; status: string; last_success_at: string | null; next_check_at: string | null; last_error: string | null } | null;
};

const FACEBOOK_OUTCOME: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Facebook connected.' },
  choose: { ok: true, text: 'Facebook connected. Choose which Page to import leads from.' },
  denied: { ok: false, text: 'Facebook connection was cancelled.' },
  expired: { ok: false, text: 'That Facebook sign-in expired. Please connect again.' },
  nopage: { ok: false, text: 'No Facebook Page was shared. Connect again and tick your business Page.' },
  failed: { ok: false, text: 'Facebook could not be connected. Please try again.' },
};

/** Shows the result of the Facebook sign-in redirect once, then tidies the address bar. */
function useFacebookOutcome(onChange: () => Promise<unknown>) {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get('facebook');
    if (!outcome) return;
    const msg = FACEBOOK_OUTCOME[outcome] ?? FACEBOOK_OUTCOME['failed']!;
    const why = params.get('why')?.replace(/[^a-z0-9_-]/gi, '').slice(0, 60);
    // The reference shows exactly which connection step stopped (and Facebook's error code).
    if (msg.ok) toast.success(msg.text); else toast.error(why ? `${msg.text} (reference: ${why})` : msg.text, { duration: 30000 });
    params.delete('facebook'); params.delete('why');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    void onChange();
  }, [onChange]);
}

function FormPicker({ onDone }: { onDone: () => Promise<unknown> }) {
  const load = useServerFn(listMetaForms); const save = useServerFn(saveMetaForms);
  const q = useQuery({ queryKey: ['meta-forms'], queryFn: () => load() });
  const [picked, setPicked] = useState<string[] | null>(null);
  const selected = picked ?? q.data?.selected ?? [];
  const saveM = useMutation({ mutationFn: (formIds: string[]) => save({ data: { formIds } }), onSuccess: async () => { toast.success('Form selection saved.'); await onDone(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save.') });
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading your lead forms…</p>;
  if (q.isError) return <p role="alert" className="text-xs text-destructive">{q.error instanceof Error ? q.error.message : 'Forms could not be loaded.'}</p>;
  const forms = q.data?.forms ?? [];
  const toggle = (id: string, on: boolean) => setPicked(on ? [...selected, id] : selected.filter((x) => x !== id));
  return <div className="space-y-2 rounded-md border border-border bg-background p-3 text-sm">
    <label className="flex items-center gap-2"><input type="radio" checked={selected.length === 0} onChange={() => setPicked([])} />All active forms (new forms are included automatically)</label>
    <label className="flex items-center gap-2"><input type="radio" checked={selected.length > 0} onChange={() => setPicked(forms.filter((f) => f.status === 'ACTIVE').map((f) => f.id).slice(0, 1))} />Only these forms:</label>
    {selected.length > 0 ? <ul className="ml-6 space-y-1">{forms.map((f) => <li key={f.id}><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />{f.name}{f.status !== 'ACTIVE' ? <span className="text-xs text-muted-foreground">({f.status.toLowerCase()})</span> : null}</label></li>)}</ul> : null}
    {!forms.length ? <p className="text-xs text-muted-foreground">No lead forms were found on this Page.</p> : null}
    <Button size="sm" disabled={saveM.isPending} onClick={() => saveM.mutate(selected)}>Save form selection</Button>
  </div>;
}

/** BookedSecure reads the business's own Facebook lead forms directly. */
function DirectImportCard({ direct, active, onChange }: { direct: DirectInfo; active: boolean; onChange: () => Promise<unknown> }) {
  const connect = useServerFn(startMetaConnect); const choose = useServerFn(chooseMetaPage);
  const instant = useServerFn(enableInstantLeads);
  const test = useServerFn(testDirectMetaAccess); const save = useServerFn(saveDirectMeta); const run = useServerFn(importDirectMetaNow); const off = useServerFn(disconnectDirectMeta);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [showForms, setShowForms] = useState(false);
  useFacebookOutcome(onChange);
  const connectM = useMutation({ mutationFn: () => connect(), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not start the Facebook connection.') });
  const chooseM = useMutation({ mutationFn: (pageId: string) => choose({ data: { pageId } }), onSuccess: async () => { toast.success('Page connected.'); await onChange(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not use that Page.') });
  const testM = useMutation({ mutationFn: () => test(), onSuccess: (r) => setCheck(r.healthy ? { ok: true, text: `Facebook access works: ${r.formCount} form${r.formCount === 1 ? '' : 's'} readable (checked ${when(r.checkedAt)}). Instant leads: ${r.instant === true ? 'on' : r.instant === false ? 'off. Click Turn on instant leads.' : 'could not be checked'}.` } : { ok: false, text: r.reason }), onError: (e) => setCheck({ ok: false, text: e instanceof Error ? e.message : 'Could not check access.' }) });
  const instantM = useMutation({ mutationFn: () => instant(), onSuccess: (r) => setCheck(r.on ? { ok: true, text: 'Instant leads are on: Facebook now tells BookedSecure about each new lead the moment it is submitted. The five-minute check stays on as a backup.' } : { ok: false, text: 'Facebook did not confirm instant leads. The five-minute check still imports every lead.' }), onError: (e) => setCheck({ ok: false, text: e instanceof Error ? e.message : 'Could not turn on instant leads.' }) });
  const saveM = useMutation({ mutationFn: (d: { auto_sync_enabled?: boolean; initial_lookback_days?: number }) => save({ data: d }), onSuccess: async () => { toast.success('Saved.'); await onChange(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not save.') });
  const runM = useMutation({ mutationFn: () => run(), onSuccess: async (r) => { if (r.started) toast.success('Import finished.'); else toast.error(r.reason); await onChange(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not run the import.') });
  const offM = useMutation({ mutationFn: () => off(), onSuccess: async () => { toast.success('Facebook disconnected.'); await onChange(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not disconnect.') });
  const c = direct.connection;
  const connected = Boolean(direct.page);
  const auto = Boolean(connected && c && c.status !== 'disconnected' && c.auto_sync_enabled);

  return <div className="space-y-3">
    {!direct.available ? <p role="status" className="rounded-md border border-border bg-background p-3 text-sm">{direct.setupError ?? 'Facebook connections aren’t switched on for BookedSecure yet (META_APP_ID / META_APP_SECRET). Please contact BookedSecure support.'}</p> : null}

    {direct.available && direct.pendingPages.length ? <div className="space-y-2 rounded-md border border-border bg-background p-3 text-sm">
      <p className="font-medium">Which Page are your lead forms on?</p>
      <ul className="space-y-1">{direct.pendingPages.map((p) => <li key={p.id} className="flex items-center justify-between gap-2"><span>{p.name || p.id}</span><Button size="sm" variant="outline" disabled={chooseM.isPending} onClick={() => chooseM.mutate(p.id)}>Use this Page</Button></li>)}</ul>
    </div> : null}

    {direct.available && !connected && !direct.pendingPages.length ? <Button disabled={connectM.isPending} onClick={() => connectM.mutate()}><Link2 className="mr-2 h-4 w-4" />{connectM.isPending ? 'Opening Facebook…' : 'Connect Facebook'}</Button> : null}

    {connected ? <>
      <p className="text-sm">Connected to <span className="font-medium">{direct.page!.name || direct.page!.id}</span> · {direct.page!.formCount ? `${direct.page!.formCount} selected form${direct.page!.formCount === 1 ? '' : 's'}` : 'all active forms'}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={testM.isPending} onClick={() => testM.mutate()}><ShieldCheck className="mr-2 h-4 w-4" />{testM.isPending ? 'Checking…' : 'Test Facebook access'}</Button>
        <Button disabled={runM.isPending || active} onClick={() => runM.mutate()}><RefreshCw className="mr-2 h-4 w-4" />{runM.isPending || active ? 'Importing…' : 'Import new leads now'}</Button>
        <Button variant="outline" disabled={instantM.isPending} onClick={() => instantM.mutate()}><Zap className="mr-2 h-4 w-4" />{instantM.isPending ? 'Turning on…' : 'Turn on instant leads'}</Button>
        <Button variant="ghost" onClick={() => setShowForms((v) => !v)}>{showForms ? 'Hide forms' : 'Choose forms'}</Button>
        <Button variant="ghost" disabled={connectM.isPending} onClick={() => connectM.mutate()}>Reconnect / change Page</Button>
        <Button variant="ghost" disabled={offM.isPending} onClick={() => { if (window.confirm('Disconnect Facebook? The saved access is deleted and automatic checks stop. Import history is kept.')) offM.mutate(); }}>Disconnect</Button>
      </div>
      {showForms ? <FormPicker onDone={async () => { setShowForms(false); await onChange(); }} /> : null}
      {check ? <p role="status" className={check.ok ? 'text-sm' : 'text-sm text-destructive'}>{check.text}</p> : null}
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
          <span>Check for new leads every 5 minutes</span>
          <Switch checked={auto} disabled={saveM.isPending} onCheckedChange={(v) => saveM.mutate({ auto_sync_enabled: v })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
          <span>First import looks back</span>
          <select className="h-9 rounded-md border border-input bg-background px-2" value={c?.initial_lookback_days ?? 7} disabled={saveM.isPending} onChange={(e) => saveM.mutate({ initial_lookback_days: Number(e.target.value) })}>
            {LEAD_SYNC_LOOKBACK_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? '1 day' : `${d} days`}</option>)}
          </select>
        </label>
        <p className="text-muted-foreground">Last successful import: <span className="text-foreground">{when(c?.last_success_at)}</span></p>
        <p className="text-muted-foreground">Next automatic check: <span className="text-foreground">{auto ? when(c?.next_check_at) : 'Off'}</span></p>
      </div>
      {c?.last_error && c.status !== 'disconnected' ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{c.last_error}</p> : null}
    </> : null}
  </div>;
}

export function FacebookLeadSyncPanel({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const load = useServerFn(getLeadSync);
  const running = (r: { status: string }) => r.status === 'requested' || r.status === 'running';
  const q = useQuery({ queryKey: ['lead-sync'], enabled, queryFn: () => load(), refetchInterval: (query) => (query.state.data?.runs.some(running) ? 5000 : false) });
  const [open, setOpen] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['lead-sync'] });
  const runs = q.data?.runs ?? [];
  const active = runs.some(running);
  const forms = q.data?.forms ?? [];

  return <section className="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    <h2 className="flex items-center gap-2 font-heading text-lg font-semibold"><Download className="h-5 w-5 text-primary" />Facebook lead import</h2>
    <p className="text-sm text-muted-foreground">Connect your Facebook Page and BookedSecure brings quote requests from your lead forms into your leads every five minutes. Each lead is saved once and never texted unless they agreed to be contacted.</p>
    {q.isError ? <p role="alert" className="text-sm">This could not be loaded: {q.error instanceof Error ? q.error.message : 'unknown error'}</p> : null}

    {q.data?.direct ? <DirectImportCard direct={q.data.direct} active={active} onChange={refresh} /> : null}

    {forms.length ? <p className="text-xs text-muted-foreground">Forms imported: {forms.map((f) => `${f.form_name ?? f.form_id} (up to ${when(f.last_submitted_at)})`).join(' · ')}</p> : null}

    {runs.length ? <div className="space-y-2">
      <h3 className="text-sm font-medium">Import history</h3>
      <ul className="divide-y divide-border text-sm">
        {runs.map((r) => <li key={r.id} className="py-2">
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
            <span>{when(r.requested_at)} · {TRIGGER[r.trigger_kind] ?? 'Automatic'} · {STATUS[r.status] ?? r.status}</span>
            <span className="text-xs text-muted-foreground">{r.created_count} new · {r.duplicate_count} already in{r.enriched_count ? ` · ${r.enriched_count} updated` : ''} · {r.skipped_count} skipped · {r.failed_count} failed</span>
          </button>
          {r.error ? <p className="text-xs text-muted-foreground">{r.error}</p> : null}
          {open === r.id ? <div className="mt-2"><RunItems runId={r.id} /></div> : null}
        </li>)}
      </ul>
    </div> : null}
  </section>;
}
