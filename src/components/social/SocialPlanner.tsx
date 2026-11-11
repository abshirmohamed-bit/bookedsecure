import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Facebook, Instagram, Linkedin, Loader2, RefreshCw, Trash2, Undo2, Youtube, X } from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { engagementRate, localDay, monthWeeks, type PlannerPost, STATUS_LABEL } from "@/lib/social-planner";
import { approveSocialPost, discardSocialDraft, getSocialPlanner, refreshSocialInsights, saveSocialDraft, sendBackSocialPost } from "@/lib/social-posts.functions";

const ICON = { facebook: Facebook, instagram: Instagram, linkedin: Linkedin, youtube: Youtube } as const;
const COLOUR = { facebook: "text-[#1877f2]", instagram: "text-[#d62976]", linkedin: "text-[#0a66c2]", youtube: "text-[#ff0000]" } as const;
const CHIP: Record<string, string> = {
  draft: "bg-secondary text-muted-foreground", pending_approval: "bg-amber-100 text-amber-800", scheduled: "bg-primary/15 text-primary",
  publishing: "bg-primary/15 text-primary", published: "bg-emerald-100 text-emerald-800", failed: "bg-red-100 text-red-700", cancelled: "bg-muted text-muted-foreground line-through",
};
const fmtWhen = (iso: string, timeZone: string) => new Date(iso).toLocaleString("en-AU", { timeZone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The social calendar: what is published, planned, waiting for approval and in draft, with each post's figures. */
export function SocialPlanner() {
  const qc = useQueryClient();
  const load = useServerFn(getSocialPlanner);
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const weeks = useMemo(() => monthWeeks(cursor.y, cursor.m), [cursor]);
  const from = `${weeks[0]![0]}T00:00:00.000Z`;
  const to = `${weeks[weeks.length - 1]![6]}T23:59:59.000Z`;
  const q = useQuery({ queryKey: ["social-planner", from, to], queryFn: () => load({ data: { from: new Date(Date.parse(from) - 86400_000).toISOString(), to: new Date(Date.parse(to) + 86400_000).toISOString() } }) });
  const [openId, setOpenId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["social-planner"] });

  const d = q.data;
  const tz = d?.timezone ?? "Australia/Sydney";
  const byDay = useMemo(() => {
    const map = new Map<string, PlannerPost[]>();
    for (const p of d?.posts ?? []) {
      if (p.status === "cancelled") continue;
      if ((p.status === "draft" || p.status === "pending_approval") && !p.plannedFor) continue;
      const day = localDay(p.status === "draft" || p.status === "pending_approval" ? p.plannedFor! : p.at, tz);
      map.set(day, [...(map.get(day) ?? []), p]);
    }
    return map;
  }, [d, tz]);
  const waiting = (d?.posts ?? []).filter((p) => p.status === "pending_approval");
  const drafts = (d?.posts ?? []).filter((p) => p.status === "draft");
  const open = (d?.posts ?? []).find((p) => p.id === openId) ?? null;
  const today = localDay(now.toISOString(), tz);
  const shift = (delta: number) => setCursor((c) => { const m = c.m + delta; return m < 1 ? { y: c.y - 1, m: 12 } : m > 12 ? { y: c.y + 1, m: 1 } : { y: c.y, m }; });
  const monthName = new Date(Date.UTC(cursor.y, cursor.m - 1, 15)).toLocaleString("en-AU", { month: "long", year: "numeric" });

  if (q.isLoading) return <div className="glass h-96 animate-pulse" />;
  if (q.isError || !d) return <p className="glass p-6 text-sm text-destructive">The calendar couldn't be loaded.</p>;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="glass p-3 sm:p-4">
        {!d.ready ? <p className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Drafts and approval start once the database update (migration 0063) is applied. Published and scheduled posts show below.</p> : null}
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button size="icon" variant="ghost" aria-label="Previous month" onClick={() => shift(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="text-sm font-semibold">{monthName}</h2>
          <Button size="icon" variant="ghost" aria-label="Next month" onClick={() => shift(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border text-xs">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <div key={w} className="bg-secondary/60 px-1 py-1 text-center font-medium text-muted-foreground">{w}</div>)}
          {weeks.flat().map((day) => {
            const inMonth = Number(day.slice(5, 7)) === cursor.m;
            const posts = byDay.get(day) ?? [];
            return (
              <div key={day} className={`min-h-20 bg-card p-1 ${inMonth ? "" : "opacity-50"} ${day === today ? "ring-2 ring-inset ring-primary/50" : ""}`}>
                <p className="text-[10px] text-muted-foreground">{Number(day.slice(8))}</p>
                <ul className="mt-0.5 space-y-0.5">
                  {posts.slice(0, 3).map((p) => {
                    const Icon = ICON[p.platform] ?? Facebook;
                    return (
                      <li key={p.id}>
                        <button type="button" onClick={() => setOpenId(p.id)} className={`flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] ${CHIP[p.status]}`}>
                          <Icon className={`h-3 w-3 shrink-0 ${COLOUR[p.platform] ?? ""}`} /><span className="truncate">{p.text || "Picture post"}</span>
                        </button>
                      </li>
                    );
                  })}
                  {posts.length > 3 ? <li className="px-1 text-[10px] text-muted-foreground">+{posts.length - 3} more</li> : null}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Times in {tz}. Drafts with a planned time show on that day.</p>
      </section>

      <aside className="space-y-4">
        <Queue title="Waiting for approval" posts={waiting} tz={tz} onOpen={setOpenId} empty={d.isOwner ? "Nothing to approve." : "Nothing waiting. Drafts you send for approval appear here."} />
        <Queue title="Drafts" posts={drafts} tz={tz} onOpen={setOpenId} empty="No drafts. Save one from the Post tab." />
      </aside>

      {open ? <PostPanel post={open} tz={tz} isOwner={d.isOwner} onClose={() => setOpenId(null)} onChanged={refresh} /> : null}
    </div>
  );
}

function Queue({ title, posts, tz, onOpen, empty }: { title: string; posts: PlannerPost[]; tz: string; onOpen: (id: string) => void; empty: string }) {
  return (
    <section className="glass p-3">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title} {posts.length ? `(${posts.length})` : ""}</p>
      {posts.length ? (
        <ul className="divide-y divide-border">
          {posts.map((p) => {
            const Icon = ICON[p.platform] ?? Facebook;
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onOpen(p.id)} className="flex w-full items-start gap-2 py-2 text-left">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${COLOUR[p.platform] ?? ""}`} />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm">{p.text || "Picture post"}</span>
                    <span className="block text-[11px] text-muted-foreground">{p.plannedFor ? `For ${fmtWhen(p.plannedFor, tz)}` : "No time set"}{p.createdBy ? ` · by ${p.createdBy}` : ""}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground">{empty}</p>}
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number | null }) {
  return <div className="rounded-lg bg-secondary/50 p-2"><p className="text-[10px] text-muted-foreground">{label}</p><p className="text-sm font-semibold tabular-nums">{value === null ? "—" : value.toLocaleString()}</p></div>;
}

function PostPanel({ post, tz, isOwner, onClose, onChanged }: { post: PlannerPost; tz: string; isOwner: boolean; onClose: () => void; onChanged: () => void }) {
  const approve = useServerFn(approveSocialPost);
  const sendBack = useServerFn(sendBackSocialPost);
  const discard = useServerFn(discardSocialDraft);
  const save = useServerFn(saveSocialDraft);
  const insights = useServerFn(refreshSocialInsights);
  const editable = post.status === "draft" || post.status === "pending_approval";
  const meta = post.platform === "facebook" || post.platform === "instagram";
  const [text, setText] = useState(post.text);
  const [when, setWhen] = useState(toLocalInput(post.plannedFor));
  const [note, setNote] = useState("");
  const done = (msg: string) => { toast.success(msg); onChanged(); onClose(); };
  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "That didn't work.");
  const planned = when ? new Date(when).toISOString() : null;

  const saveM = useMutation({ mutationFn: (submit: boolean) => save({ data: { platform: post.platform as "facebook" | "instagram", text, plannedFor: planned, draftId: post.id, submit } }), onSuccess: (r) => done(r.status === "pending_approval" ? "Sent for approval." : "Draft saved."), onError: fail });
  const approveM = useMutation({ mutationFn: () => approve({ data: { id: post.id, when: planned } }), onSuccess: (r) => done(r.status === "scheduled" ? `Approved. Goes out ${fmtWhen(r.scheduledFor!, tz)}.` : "Approved and published."), onError: (e) => { fail(e); onChanged(); } });
  const backM = useMutation({ mutationFn: () => sendBack({ data: { id: post.id, note } }), onSuccess: () => done("Sent back as a draft."), onError: fail });
  const discardM = useMutation({ mutationFn: () => discard({ data: { id: post.id } }), onSuccess: () => done("Draft removed."), onError: fail });
  const insightsM = useMutation({ mutationFn: () => insights({ data: { id: post.id } }), onSuccess: () => { toast.success("Figures updated."); onChanged(); }, onError: fail });
  const busy = saveM.isPending || approveM.isPending || backM.isPending || discardM.isPending;
  const Icon = ICON[post.platform] ?? Facebook;
  const rate = engagementRate(post.insights);
  // Pictures stay as they were: only the words and the planned time are edited here.
  const textChanged = text.trim() !== post.text.trim() || when !== toLocalInput(post.plannedFor);

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" role="dialog" aria-modal="true" aria-label="Post details" onClick={onClose}>
        <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-background p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start gap-2">
            <Icon className={`mt-1 h-5 w-5 shrink-0 ${COLOUR[post.platform] ?? ""}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{post.postsAs ?? post.platform}</p>
              <p className="text-xs"><span className={`rounded-full px-2 py-0.5 ${CHIP[post.status]}`}>{STATUS_LABEL[post.status]}</span>{post.createdBy ? <span className="text-muted-foreground"> · by {post.createdBy}</span> : null}</p>
            </div>
            <Button size="icon" variant="ghost" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>

          {post.reviewNote && post.status === "draft" ? <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Owner's note: {post.reviewNote}</p> : null}
          {post.error ? <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{post.error}</p> : null}

          {editable && meta ? (
            <div className="mt-3 space-y-2">
              <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Post text" />
              {post.pictures ? <p className="text-[11px] text-muted-foreground">{post.pictures} picture{post.pictures === 1 ? "" : "s"} attached.</p> : null}
              <label className="block text-xs text-muted-foreground">Planned for
                <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground" />
              </label>
              <div className="flex flex-wrap gap-2">
                {isOwner ? (
                  <Button disabled={busy || textChanged} title={textChanged ? "Save your changes first" : undefined} onClick={() => approveM.mutate()}>
                    {approveM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}{planned && Date.parse(planned) > Date.now() + 5 * 60_000 ? "Approve and schedule" : "Approve and post now"}
                  </Button>
                ) : null}
                {textChanged || post.status === "draft" ? <Button variant="outline" disabled={busy} onClick={() => saveM.mutate(false)}>Save draft</Button> : null}
                {post.status === "draft" ? <Button variant="outline" disabled={busy} onClick={() => saveM.mutate(true)}>Send for approval</Button> : null}
                <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => { if (window.confirm("Remove this draft?")) discardM.mutate(); }}><Trash2 className="mr-1.5 h-4 w-4" />Remove</Button>
              </div>
              {isOwner && post.status === "pending_approval" ? (
                <div className="space-y-1 rounded-lg border border-border p-2">
                  <Textarea rows={2} value={note} placeholder="What should change? (optional)" onChange={(e) => setNote(e.target.value)} aria-label="Note for the writer" />
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => backM.mutate()}><Undo2 className="mr-1.5 h-4 w-4" />Send back for changes</Button>
                </div>
              ) : null}
              {!isOwner ? <p className="text-[11px] text-muted-foreground">The owner approves posts before they go out.</p> : null}
            </div>
          ) : (
            <p className="mt-3 whitespace-pre-wrap text-sm">{post.text || "Picture post"}</p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            {post.publishedAt ? `Published ${fmtWhen(post.publishedAt, tz)}` : post.plannedFor ? `Planned for ${fmtWhen(post.plannedFor, tz)}` : `Written ${fmtWhen(post.createdAt, tz)}`}
          </p>
          {post.url ? <a href={post.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" />Open on {post.platform}</a> : null}

          {post.status === "published" && meta ? (
            <section className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Performance</p>
                <Button size="sm" variant="ghost" disabled={insightsM.isPending} onClick={() => insightsM.mutate()}><RefreshCw className={`mr-1 h-3 w-3 ${insightsM.isPending ? "animate-spin" : ""}`} />Refresh</Button>
              </div>
              {post.insights ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {post.platform === "facebook" ? <><Figure label="Impressions" value={post.insights.impressions} /><Figure label="Reach" value={post.insights.reach} /><Figure label="Clicks" value={post.insights.clicks} /></>
                      : <><Figure label="Reach" value={post.insights.reach} /><Figure label="Views" value={post.insights.views} /><Figure label="Saves" value={post.insights.saves} /></>}
                    <Figure label={post.platform === "facebook" ? "Reactions" : "Likes"} value={post.insights.likes} /><Figure label="Comments" value={post.insights.comments} /><Figure label="Shares" value={post.insights.shares} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{rate === null ? "" : `Engagement rate ${rate}% · `}Updated {post.insightsAt ? fmtWhen(post.insightsAt, tz) : "never"}. Figures refresh every few hours for 30 days.</p>
                </>
              ) : <p className="text-xs text-muted-foreground">No figures yet. Press Refresh, or wait a few hours.</p>}
            </section>
          ) : null}
        </div>
      </div>
    </Portal>
  );
}
