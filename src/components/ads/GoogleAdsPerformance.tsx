import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { AdsCampaignTable } from "@/components/ads/AdsCampaignTable";
import { Button } from "@/components/ui/button";
import { chooseGoogleAdsAccountFn, disconnectGoogleAdsFn, getGoogleAdPerformance, startGoogleAdsConnect, syncGoogleAdsNow } from "@/lib/google-ads.functions";

type Range = 7 | 30 | 90;
const RANGES: Range[] = [7, 30, 90];
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "never");
const OUTCOMES: Record<string, string> = {
  connected: "Google Ads connected. Loading its figures…",
  choose: "Google Ads connected. Choose which account to report on.",
  denied: "Google Ads wasn't connected.",
  expired: "That sign-in link expired. Connect again.",
  setup: "Google Ads is waiting for a one-time database update (migration 0062).",
  scope: "Allow access to Google Ads when Google asks. BookedSecure only reads figures.",
  failed: "Google Ads couldn't be connected. Try again.",
};

/** Google Ads: spend and clicks from Google, joined to the leads, bookings and revenue they brought. */
export function GoogleAdsPerformance({ outcome }: { outcome?: string | undefined }) {
  const qc = useQueryClient();
  const load = useServerFn(getGoogleAdPerformance);
  const connect = useServerFn(startGoogleAdsConnect);
  const sync = useServerFn(syncGoogleAdsNow);
  const choose = useServerFn(chooseGoogleAdsAccountFn);
  const disconnect = useServerFn(disconnectGoogleAdsFn);
  const [days, setDays] = useState<Range>(30);
  const q = useQuery({ queryKey: ["google-ad-performance", days], queryFn: () => load({ data: { days } }), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["google-ad-performance"] });

  useEffect(() => {
    if (!outcome || !OUTCOMES[outcome]) return;
    (outcome === "connected" || outcome === "choose" ? toast.success : toast.error)(OUTCOMES[outcome]);
  }, [outcome]);

  const connectM = useMutation({ mutationFn: () => connect(), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => toast.error(e instanceof Error ? e.message : "Google Ads couldn't be connected.") });
  const syncM = useMutation({ mutationFn: () => sync(), onSuccess: async (r) => { if (r.ok) toast.success(`Google Ads figures updated (${r.rows} campaign-days).`); else toast.error(r.reason); await refresh(); } });
  const chooseM = useMutation({ mutationFn: (customerId: string) => choose({ data: { customerId } }), onSuccess: async (p) => { toast.success(`Reporting on ${p.name}.`); await refresh(); }, onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change the account.") });
  const disconnectM = useMutation({ mutationFn: () => disconnect(), onSuccess: async () => { toast.success("Google Ads disconnected. Past figures are kept."); await refresh(); } });

  if (q.isError && /owner/i.test(q.error instanceof Error ? q.error.message : "")) return null;
  const d = q.data;
  const currency = d?.account?.currency ?? "AUD";

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Search className="h-4 w-4 text-primary" />Google Ads: cost per lead and per job</h3>
        <div className="flex items-center gap-1" role="group" aria-label="Date range">
          {RANGES.map((r) => <Button key={r} size="sm" variant={r === days ? "default" : "ghost"} onClick={() => setDays(r)}>{r} days</Button>)}
        </div>
      </div>
      {q.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading Google Ads results…</p> : null}
      {q.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Google Ads results could not be loaded."}</p> : null}
      {d ? <>
        {d.setupMissing ? <p className="mt-3 text-sm text-muted-foreground">Google Ads is waiting for a one-time database update (migration 0062).</p> : null}
        {!d.setupMissing && d.platformMissing.length ? <p className="mt-3 text-sm text-muted-foreground">Google Ads needs setting up on BookedSecure first ({d.platformMissing.join(", ")}). Leads from Google ads below are still counted.</p> : null}
        {!d.setupMissing && !d.platformMissing.length && !d.account ? (
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Connect Google Ads to see spend, clicks and cost per booking. BookedSecure only reads figures; it never changes your ads.</span>
            <Button size="sm" disabled={connectM.isPending} onClick={() => connectM.mutate()}>Connect Google Ads</Button>
          </div>
        ) : null}
        {d.account ? <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span>Account: {d.account.choices.length > 1 || !d.account.id
            ? <select aria-label="Google Ads account" className="h-7 rounded border border-input bg-background px-1 text-foreground" value={d.account.id ?? ""} disabled={chooseM.isPending} onChange={(e) => e.target.value && chooseM.mutate(e.target.value)}>
                {!d.account.id ? <option value="">Choose an account…</option> : null}
                {d.account.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            : <span className="text-foreground">{d.account.name}</span>}</span>
          <span>Figures updated: {when(d.account.lastSyncAt)}</span>
          {d.account.id ? <Button size="sm" variant="ghost" disabled={syncM.isPending} onClick={() => syncM.mutate()}><RefreshCw className="mr-1 h-3 w-3" />{syncM.isPending ? "Updating…" : "Update now"}</Button> : null}
          <Button size="sm" variant="ghost" disabled={connectM.isPending} onClick={() => connectM.mutate()}>Reconnect</Button>
          <Button size="sm" variant="ghost" disabled={disconnectM.isPending} onClick={() => { if (window.confirm("Disconnect Google Ads? Past figures are kept.")) disconnectM.mutate(); }}>Disconnect</Button>
          {d.googleConversions ? <span>Google-counted conversions: {d.googleConversions}</span> : null}
        </div> : null}
        {d.account?.lastError ? <p role="alert" className="mt-2 text-xs text-destructive">{d.account.lastError}</p> : null}
        <AdsCampaignTable campaigns={d.campaigns} total={d.total} currency={currency} platform="Google Ads" days={days} />
        <p className="mt-1 text-xs text-muted-foreground">A lead counts as from Google Ads when the visit to your quote page carried a Google ad click. Add utm_campaign={"{campaignid}"} to your ads' tracking template to see leads per campaign.</p>
      </> : null}
    </section>
  );
}
