import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { relativeTime } from "@/lib/notifications";
import { getYouTubeInsights, startYouTubeConnect, suggestYouTubeVideoTitles } from "@/lib/youtube.functions";

const fmt = (n: number | null) => (n === null ? "Hidden" : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString("en-AU"));
const avg = (vs: { views: number; form: "long" | "short" }[], form: "long" | "short") => { const xs = vs.filter((v) => v.form === form); return xs.length ? xs.reduce((n, v) => n + v.views, 0) / xs.length : 0; };
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tracking-[-0.02em]">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const viewsConfig = { views: { label: "Views", color: "var(--chart-1)" } } satisfies ChartConfig;
const shortDay = (day: string) => { const d = new Date(`${day}T00:00:00`); return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }); };

/** Daily views over the last 28 days. */
function DailyViews({ daily }: { daily: { day: string; views: number }[] }) {
  return (
    <ChartContainer config={viewsConfig} className="aspect-auto h-44 w-full" role="img" aria-label="Daily views over the last 28 days">
      <AreaChart data={daily} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="yt-views" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-views)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-views)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} minTickGap={28} tickFormatter={shortDay} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(v: number) => fmt(v)} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => shortDay(String(v))} />} />
        <Area dataKey="views" type="monotone" stroke="var(--color-views)" strokeWidth={2} fill="url(#yt-views)" />
      </AreaChart>
    </ChartContainer>
  );
}

const uploadsConfig = { long: { label: "Long-form", color: "var(--chart-1)" }, short: { label: "Short-form", color: "var(--chart-2)" } } satisfies ChartConfig;

/** Views of each recent upload, oldest to newest, coloured long or short. */
function UploadViews({ videos }: { videos: { id: string; title: string; views: number; form: "long" | "short" }[] }) {
  const data = [...videos].reverse().map((v) => ({ title: v.title, long: v.form === "long" ? v.views : 0, short: v.form === "short" ? v.views : 0 }));
  return (
    <ChartContainer config={uploadsConfig} className="aspect-auto h-44 w-full" role="img" aria-label="Views of each recent upload">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="title" tick={false} tickLine={false} axisLine={false} height={4} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(v: number) => fmt(v)} />
        <ChartTooltip content={<ChartTooltipContent hideIndicator={false} />} />
        <Bar dataKey="long" stackId="v" fill="var(--color-long)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="short" stackId="v" fill="var(--color-short)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}

export function YouTubeInsights({ isOwner }: { isOwner: boolean }) {
  const load = useServerFn(getYouTubeInsights);
  const q = useQuery({ queryKey: ["youtube-insights"], queryFn: () => load(), staleTime: 10 * 60_000 });
  const connect = useServerFn(startYouTubeConnect);
  const titlesFn = useServerFn(suggestYouTubeVideoTitles);
  const [form, setForm] = useState<"all" | "long" | "short">("all");
  const reconnect = useMutation({ mutationFn: () => connect(), onSuccess: (r) => { window.location.href = r.url; }, onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't start the Google sign-in.") });
  const longForm = useMemo(() => (q.data?.recent ?? []).filter((v) => v.form === "long").slice(0, 5), [q.data]);
  const titles = useMutation({
    mutationFn: () => titlesFn({ data: { videos: longForm.map((v) => ({ id: v.id, title: v.title, views: v.views })) } }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't suggest titles."),
  });

  if (q.isLoading) return <div className="glass grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <div className="glass p-6 text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Couldn't load YouTube insights."}</div>;
  const d = q.data;
  const shown = d.recent.filter((v) => form === "all" || v.form === form);
  const longCount = d.recent.filter((v) => v.form === "long").length;

  return (
    <div className="space-y-4">
      {(d.analyticsNeedsReconnect || d.commentsNeedReconnect) && isOwner && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
          <p className="text-muted-foreground">Reconnect YouTube once to see watch time and subscribers gained, and to reply to comments.</p>
          <Button size="sm" disabled={reconnect.isPending} onClick={() => reconnect.mutate()}>Reconnect YouTube</Button>
        </div>
      )}

      <section className="glass space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{d.channel.title}</p>
          <Button size="sm" variant="ghost" disabled={q.isFetching} onClick={() => void q.refetch()}><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh</Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Subscribers" value={fmt(d.channel.subscribers)} />
          <Stat label="Total views" value={fmt(d.channel.views)} />
          <Stat label="Videos" value={fmt(d.channel.videos)} />
          <Stat label="Views, 28 days" value={d.last28 ? fmt(d.last28.views) : "—"} />
          <Stat label="Watch hours, 28 days" value={d.last28 ? fmt(d.last28.watchHours) : "—"} />
          <Stat label="Subscribers, 28 days" value={d.last28 ? `${d.last28.subscribersGained - d.last28.subscribersLost >= 0 ? "+" : ""}${d.last28.subscribersGained - d.last28.subscribersLost}` : "—"} hint={d.last28 ? `${d.last28.subscribersGained} gained, ${d.last28.subscribersLost} lost` : undefined} />
        </div>
        {d.last28 && d.last28.daily.length > 1 && (
          <div className="rounded-xl border border-border bg-card/60 p-3">
            <p className="mb-2 text-xs font-medium">Views per day · average view {dur(d.last28.averageViewSeconds)}</p>
            <DailyViews daily={d.last28.daily} />
          </div>
        )}
        {!d.last28 && !d.analyticsNeedsReconnect && <p className="text-xs text-muted-foreground">YouTube Analytics has no figures for the last 28 days yet.</p>}
      </section>

      {d.recent.length > 1 && (
        <section className="glass space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Views by upload</p>
            <p className="text-xs text-muted-foreground">
              Long-form average {fmt(Math.round(avg(d.recent, "long")))} · Short-form average {fmt(Math.round(avg(d.recent, "short")))}
            </p>
          </div>
          <UploadViews videos={d.recent} />
        </section>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="glass p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latest uploads</p>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {([["all", "All"], ["long", "Long-form"], ["short", "Short-form"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setForm(id)} className={`rounded-md px-2.5 py-1 text-xs font-medium ${form === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No videos here yet.</p> : (
            <ul className="divide-y divide-border">
              {shown.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2">
                  {v.thumbnail ? <img src={v.thumbnail} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" /> : <div className="h-12 w-20 shrink-0 rounded-md bg-muted" />}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium">{v.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {v.form === "long" ? "Long-form" : "Short-form"} · {dur(v.seconds)} · {v.publishedAt ? relativeTime(v.publishedAt) : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{fmt(v.views)} views · {fmt(v.likes)} likes · {fmt(v.comments)} comments</p>
                  </div>
                  <a href={v.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-primary" aria-label="Open on YouTube"><ExternalLink className="h-3.5 w-3.5" /></a>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">Long-form means 4 minutes or longer; anything shorter counts as short-form.</p>
        </section>

        <section className="glass space-y-3 p-4">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Better titles</p>
            <p className="text-xs text-muted-foreground">Three title ideas for each of your latest long-form videos. Nothing changes on YouTube; copy one into YouTube Studio if you like it.</p>
          </div>
          <Button size="sm" variant="outline" disabled={longCount === 0 || titles.isPending} onClick={() => titles.mutate()}>
            {titles.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />} {titles.data ? "Suggest again" : "Suggest titles"}
          </Button>
          {longCount === 0 && <p className="text-xs text-muted-foreground">Upload a video of 4 minutes or more to get title ideas.</p>}
          {titles.data?.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card/60 p-3">
              <p className="line-clamp-1 text-[11px] text-muted-foreground">Now: {t.original}</p>
              <ul className="mt-1 space-y-1">
                {t.options.map((o) => (
                  <li key={o} className="flex items-start justify-between gap-2 text-sm">
                    <span>{o}</span>
                    <button type="button" aria-label="Copy title" className="shrink-0 text-muted-foreground hover:text-primary" onClick={() => { void navigator.clipboard.writeText(o); toast.success("Title copied."); }}>
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
