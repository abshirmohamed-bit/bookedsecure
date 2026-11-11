import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { Megaphone, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { AdsCampaignTable } from '@/components/ads/AdsCampaignTable';
import { chooseAdAccountFn, getAdPerformance, syncAdSpendNow } from '@/lib/meta-direct.functions';

type Range = 7 | 30 | 90;
const RANGES: Range[] = [7, 30, 90];
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'never');

/** Cost per lead, booking and completed job for each Facebook campaign. */
export function FacebookAdsPerformance() {
  const qc = useQueryClient();
  const load = useServerFn(getAdPerformance); const sync = useServerFn(syncAdSpendNow); const choose = useServerFn(chooseAdAccountFn);
  const [days, setDays] = useState<Range>(30);
  const q = useQuery({ queryKey: ['fb-ad-performance', days], queryFn: () => load({ data: { days } }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['fb-ad-performance'] });
  const syncM = useMutation({ mutationFn: () => sync(), onSuccess: async (r) => { if (r.ok) toast.success(`Ad spend updated (${r.rows} day${r.rows === 1 ? '' : 's'} of campaign data).`); else toast.error(r.reason); await refresh(); } });
  const chooseM = useMutation({ mutationFn: (accountId: string) => choose({ data: { accountId } }), onSuccess: async () => { toast.success('Ad account changed. Loading its spend…'); syncM.mutate(); }, onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not change the ad account.') });

  // Owner-only report: staff accounts simply don't see this panel.
  if (q.isError && /owner/i.test(q.error instanceof Error ? q.error.message : '')) return null;
  const d = q.data;
  const currency = d?.account?.currency ?? 'AUD';
  const expiresSoon = d?.account?.tokenExpiresAt ? new Date(d.account.tokenExpiresAt).getTime() - Date.now() < 10 * 86400_000 : false;

  return <section className="rounded-lg border border-border bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="h-4 w-4 text-primary" />Facebook ads: cost per lead and per job</h3>
      <div className="flex items-center gap-1" role="group" aria-label="Date range">
        {RANGES.map((r) => <Button key={r} size="sm" variant={r === days ? 'default' : 'ghost'} onClick={() => setDays(r)}>{r} days</Button>)}
      </div>
    </div>

    {q.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading ad performance…</p> : null}
    {q.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{q.error instanceof Error ? q.error.message : 'Ad performance could not be loaded.'}</p> : null}

    {d ? <>
      {d.setupMissing ? <p className="mt-3 text-sm text-muted-foreground">Ad spend is waiting for a database update (migration 0024_meta_ad_spend).</p> : null}
      {!d.setupMissing && !d.account ? <p className="mt-3 text-sm text-muted-foreground">To see ad spend, reconnect Facebook in Setup → Connections (Reconnect / change Page). Leads below are still grouped by campaign.</p> : null}
      {d.account ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>Ad account: {d.account.choices.length > 1
          ? <select aria-label="Ad account" className="h-7 rounded border border-input bg-background px-1 text-foreground" value={d.account.id ?? ''} disabled={chooseM.isPending} onChange={(e) => chooseM.mutate(e.target.value)}>
              {d.account.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          : <span className="text-foreground">{d.account.name ?? 'none found'}</span>}</span>
        <span>Spend updated: {when(d.account.lastSyncAt)}</span>
        <Button size="sm" variant="ghost" disabled={syncM.isPending} onClick={() => syncM.mutate()}><RefreshCw className="mr-1 h-3 w-3" />{syncM.isPending ? 'Updating…' : 'Update now'}</Button>
      </div> : null}
      {d.account?.lastError ? <p role="alert" className="mt-2 text-xs text-destructive">{d.account.lastError}</p> : null}
      {expiresSoon ? <p className="mt-2 text-xs text-destructive">Facebook ad access expires {new Date(d.account!.tokenExpiresAt!).toLocaleDateString()}. Reconnect Facebook before then to keep spend up to date.</p> : null}

      <AdsCampaignTable campaigns={d.campaigns} total={d.total} currency={currency} platform="Facebook" days={days} />
    </> : null}
  </section>;
}
