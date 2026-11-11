import { useCallback, useState } from "react";
import { SocialCowork } from "@/components/social/SocialCowork";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Facebook, Instagram, Linkedin, Youtube, ExternalLink, MessageCircle, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LinkedInWorkspace } from "@/routes/linkedin";
import { MetaComposer } from "@/components/social/MetaComposer";
import { YouTubeComposer } from "@/components/social/YouTubeComposer";
import { YouTubeInsights } from "@/components/social/YouTubeInsights";
import { YouTubeComments } from "@/components/social/YouTubeComments";
import { getYouTube } from "@/lib/youtube.functions";
import { convertSocialComment, getSocialThread, listSocialComments, listSocialThreads, refreshSocialNow, reviewSocialComment, sendSocialReply, suggestSocialReply } from "@/lib/social-comments.functions";

type Platform = "linkedin" | "facebook" | "instagram" | "youtube";
type View = "post" | "comments" | "messages" | "insights";
type SocialSearch = { platform?: Platform; view?: View; linkedin?: string; youtube?: string; why?: string; clip?: string; clipTitle?: string };

export const Route = createFileRoute("/social")({
  head: () => ({
    meta: [
      { title: "Social media | BookedSecure" },
      { name: "description", content: "Post to LinkedIn, Facebook, Instagram and YouTube, and answer comments and messages, from one place. Nothing is posted or sent until you approve." },
      { property: "og:title", content: "Social media | BookedSecure" },
      { property: "og:description", content: "Post to LinkedIn, Facebook and Instagram and answer comments in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // ?view=messages opens the DMs (used by notifications); ?platform= picks the network.
  validateSearch: (search: Record<string, unknown>): SocialSearch => ({
    ...(search["platform"] === "linkedin" || search["platform"] === "facebook" || search["platform"] === "instagram" || search["platform"] === "youtube" ? { platform: search["platform"] } : {}),
    ...(search["view"] === "post" || search["view"] === "comments" || search["view"] === "messages" || search["view"] === "insights" ? { view: search["view"] } : {}),
    ...(typeof search["linkedin"] === "string" ? { linkedin: search["linkedin"].slice(0, 20) } : {}),
    ...(typeof search["youtube"] === "string" ? { youtube: search["youtube"].slice(0, 20) } : {}),
    ...(typeof search["why"] === "string" ? { why: search["why"].slice(0, 60) } : {}),
    ...(typeof search["clip"] === "string" && /^[0-9a-f-]{36}$/i.test(search["clip"]) ? { clip: search["clip"] } : {}),
    ...(typeof search["clipTitle"] === "string" ? { clipTitle: search["clipTitle"].slice(0, 100) } : {}),
  }),
  component: SocialMediaPage,
});

const PLATFORMS: { id: Platform; label: string; icon: typeof Linkedin; color: string }[] = [
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-[#1877f2]" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-[#d62976]" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-[#0a66c2]" },
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-[#ff0000]" },
];

function SocialMediaPage() {
  const search = Route.useSearch();
  // Co-Work is the front door; any link to a network or section opens the hands-on tools.
  if (Object.keys(search).length === 0) return <AppShell title="Social media"><SocialCowork /></AppShell>;
  return <SocialTools />;
}

function SocialTools() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // A notification about comments or messages opens the inbox, not the composer.
  const platform: Platform = search.platform ?? "facebook";
  const requested = search.view ?? "post";
  const view: View = platform === "linkedin" ? "post"
    : platform === "youtube" ? (requested === "messages" ? "post" : requested)
    : requested === "insights" ? "post" : requested;
  const clearYouTube = useCallback(() => void navigate({ search: { platform: "youtube" }, replace: true }), [navigate]);
  const go = (next: Partial<SocialSearch>) => void navigate({ search: { platform, view, ...next }, replace: true });

  return (
    <AppShell title="Social media">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <header className="space-y-3">
          <Link to="/social" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-primary"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Co-Work</Link>
          <div>
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Social media</h1>
            <p className="text-sm text-muted-foreground">Post to your pages and answer comments and messages. Nothing is posted or sent until you approve it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Network" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-border bg-card p-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={platform === p.id}
                  onClick={() => go({ platform: p.id, view: "post" })}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${platform === p.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <p.icon className={`h-4 w-4 ${platform === p.id ? "" : p.color}`} /> {p.label}
                </button>
              ))}
            </div>
            {platform !== "linkedin" && (
              <div role="tablist" aria-label="Section" className="inline-flex rounded-xl border border-border bg-card p-1">
                {(platform === "youtube"
                  ? ([["post", "Upload"], ["insights", "Insights"], ["comments", "Comments"]] as const)
                  : ([["post", "Post"], ["comments", "Comments"], ["messages", "Messages"]] as const)).map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={view === id}
                    onClick={() => go({ view: id })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${view === id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </header>

        {platform === "linkedin" ? (
          <LinkedInWorkspace search={{ ...(search.linkedin ? { linkedin: search.linkedin } : {}), ...(search.why ? { why: search.why } : {}) }} clearSearch={() => void navigate({ search: { platform: "linkedin" }, replace: true })} />
        ) : platform === "youtube" ? (
          view === "insights" ? <YouTubeSection view="insights" />
            : view === "comments" ? <YouTubeSection view="comments" />
            : <YouTubeComposer outcome={search.youtube} why={search.why} clearOutcome={clearYouTube} clipId={search.clip} clipTitle={search.clipTitle} />
        ) : view === "post" || view === "insights" ? (
          <MetaComposer platform={platform} />
        ) : (
          <SocialInbox platform={platform} view={view} />
        )}
      </div>
    </AppShell>
  );
}

type Status = "pending_review" | "approved" | "posted" | "failed" | "dismissed";
const TABS: { status: Status; label: string }[] = [
  { status: "pending_review", label: "To review" },
  { status: "approved", label: "Posting" },
  { status: "posted", label: "Posted" },
  { status: "failed", label: "Couldn't post" },
  { status: "dismissed", label: "Dismissed" },
];
type Row = Awaited<ReturnType<typeof listSocialComments>>[number];

function SocialInbox({ platform, view }: { platform: "facebook" | "instagram"; view: "comments" | "messages" }) {
  const [status, setStatus] = useState<Status>("pending_review");
  const qc = useQueryClient();
  const list = useServerFn(listSocialComments);
  const refresh = useServerFn(refreshSocialNow);
  const q = useQuery({ queryKey: ["social-comments", status], queryFn: () => list({ data: { status } }), enabled: view === "comments" });
  const refreshM = useMutation({
    mutationFn: () => refresh(),
    onSuccess: async (r) => {
      if (!r.ok) toast.error(r.reason);
      else toast.success(`Checked Facebook and Instagram: ${r.newComments} new comment${r.newComments === 1 ? "" : "s"}, ${r.newMessages} new message${r.newMessages === 1 ? "" : "s"}.${r.errors.length ? ` Some parts failed: ${r.errors.join(" ")}` : ""}`);
      await qc.invalidateQueries({ queryKey: ["social-comments"] });
      await qc.invalidateQueries({ queryKey: ["social-threads"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not refresh."),
  });
  return (
    <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {view === "messages" ? "Messages" : "Comments"} from your {platform === "instagram" ? "Instagram account" : "Facebook Page"}, usually with a suggested reply.
          </p>
          <Button size="sm" variant="outline" disabled={refreshM.isPending} onClick={() => refreshM.mutate()}><RefreshCw className="mr-2 h-4 w-4" />{refreshM.isPending ? "Checking…" : "Check now"}</Button>
        </div>
        {view === "messages" ? <MessagesView platform={platform} /> : <>
          <div className="flex flex-wrap gap-2">
            {TABS.map((t) => (
              <Button key={t.status} size="sm" variant={t.status === status ? "default" : "outline"} onClick={() => setStatus(t.status)}>
                {t.label}
              </Button>
            ))}
          </div>
          {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
            : q.isError ? <p className="text-sm text-destructive">Could not load comments.</p>
            : (q.data ?? []).length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                Nothing here yet. New comments are checked every few minutes once Facebook is connected in{" "}
                <Link to="/settings/integrations" className="text-primary underline">Setup → Connections</Link>.
              </div>
            ) : (q.data ?? []).filter((r) => r.platform === platform).map((r) => <CommentCard key={r.id} row={r} />)}
        </>}
    </div>
  );
}

type Thread = Awaited<ReturnType<typeof listSocialThreads>>["threads"][number];

function MessagesView({ platform }: { platform: "facebook" | "instagram" }) {
  const list = useServerFn(listSocialThreads);
  const q = useQuery({ queryKey: ["social-threads"], queryFn: () => list(), refetchInterval: 60_000 });
  const [open, setOpen] = useState<Thread | null>(null);
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p className="text-sm text-destructive">Could not load messages.</p>;
  if (q.data?.setupMissing) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">Messages are waiting for a database update (migration 0026_social_messages).</p>;
  if (open) return <ThreadView thread={open} onBack={() => setOpen(null)} />;
  const threads = (q.data?.threads ?? []).filter((t) => t.platform === platform);
  if (!threads.length) return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No {platform === "instagram" ? "Instagram" : "Facebook"} messages yet. New messages are checked every few minutes.</p>;
  return (
    <ul className="divide-y divide-border rounded-lg border bg-card">
      {threads.map((t) => (
        <li key={`${t.platform}:${t.participantId}`}>
          <button type="button" className="flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-secondary/40" onClick={() => setOpen(t)}>
            <div className="min-w-0">
              <p className="text-sm font-medium">{t.name ?? "Customer"} <span className="font-normal text-muted-foreground">· {t.platform === "instagram" ? "Instagram" : "Messenger"}</span></p>
              <p className="truncate text-sm text-muted-foreground">{t.lastFromCustomer ? "" : "You: "}{t.last}</p>
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <p>{new Date(t.lastAt).toLocaleString("en-AU")}</p>
              {t.lastFromCustomer ? <p className="mt-1 font-medium text-primary">Needs reply</p> : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ThreadView({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getSocialThread);
  const send = useServerFn(sendSocialReply);
  const key = ["social-thread", thread.platform, thread.participantId];
  const q = useQuery({ queryKey: key, queryFn: () => load({ data: { platform: thread.platform as "facebook" | "instagram", participantId: thread.participantId } }), refetchInterval: 30_000 });
  const [text, setText] = useState<string | null>(null);
  const value = text ?? q.data?.draft ?? "";
  const sendM = useMutation({
    mutationFn: () => send({ data: { platform: thread.platform as "facebook" | "instagram", participantId: thread.participantId, text: value } }),
    onSuccess: async () => { toast.success("Sent."); setText(""); await qc.invalidateQueries({ queryKey: key }); await qc.invalidateQueries({ queryKey: ["social-threads"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send."),
  });
  const window = q.data?.window;
  return (
    <div className="space-y-3">
      <Button size="sm" variant="ghost" onClick={onBack}>← All messages</Button>
      <p className="text-sm font-medium">{thread.name ?? "Customer"} · {thread.platform === "instagram" ? "Instagram" : "Messenger"}</p>
      {q.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border bg-card p-3">
          {(q.data?.messages ?? []).map((m) => (
            <div key={m.id} className={m.direction === "in" ? "mr-12" : "ml-12 text-right"}>
              <p className={`inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${m.direction === "in" ? "bg-secondary" : "bg-primary text-primary-foreground"}`}>{m.body}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(m.sent_at).toLocaleString("en-AU")}{m.status === "failed" ? ` · not sent: ${m.error ?? "error"}` : ""}</p>
            </div>
          ))}
        </div>
      )}
      {window && !window.allowed ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">{window.reason}</p> : <>
        {window && window.allowed && window.messagingType === "MESSAGE_TAG" ? <p className="text-xs text-muted-foreground">More than 24 hours since their last message: Meta allows a personal reply from you (not automated) for up to 7 days.</p> : null}
        <Textarea aria-label="Reply" rows={3} value={value} onChange={(e) => setText(e.target.value)} placeholder="Write your reply" />
        <Button size="sm" disabled={sendM.isPending || !value.trim()} onClick={() => sendM.mutate()}><Send className="mr-2 h-4 w-4" />{sendM.isPending ? "Sending…" : "Send reply"}</Button>
      </>}
    </div>
  );
}

function CommentCard({ row }: { row: Row }) {
  const qc = useQueryClient();
  const review = useServerFn(reviewSocialComment);
  const convert = useServerFn(convertSocialComment);
  const suggestFn = useServerFn(suggestSocialReply);
  const [reply, setReply] = useState(row.approved_response ?? row.draft_response ?? "");
  const [english, setEnglish] = useState<string | null>(null);
  const [converting, setConverting] = useState(false);
  const suggest = useMutation({
    mutationFn: () => suggestFn({ data: { id: row.id } }),
    onSuccess: (r) => {
      if (r.noReplyNeeded) toast.message("This one doesn't look like it needs a reply. You can still write one or dismiss it.");
      else { setReply(r.text); setEnglish(r.english); }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "A reply could not be suggested."),
  });
  const [name, setName] = useState(row.author_name ?? "");
  const [mobile, setMobile] = useState("");
  const done = () => qc.invalidateQueries({ queryKey: ["social-comments"] });
  const act = useMutation({
    mutationFn: (action: "approve" | "dismiss" | "reopen") => review({ data: { id: row.id, action, reply } }),
    onSuccess: (r, a) => {
      if (a === "approve") {
        const res = r as { status?: string; postError?: string | null };
        if (res.status === "posted") toast.success("Reply posted.");
        else toast.error(`Approved, but posting failed: ${res.postError ?? "unknown error"}. It is under "Couldn't post"; you can edit and approve again.`);
      } else toast.success(a === "dismiss" ? "Dismissed." : "Moved back to review.");
      void done();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not update."),
  });
  const conv = useMutation({
    mutationFn: () => convert({ data: { id: row.id, name, mobile } }),
    onSuccess: () => { toast.success("Added as a customer. No text was sent."); setConverting(false); void done(); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not add customer."),
  });
  const editable = row.status === "pending_review" || row.status === "failed";
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm">
          <span className="font-medium">{row.author_name ?? "Someone"}</span>
          <span className="text-muted-foreground"> · {row.platform === "instagram" ? "Instagram" : "Facebook"} · {new Date(row.commented_at ?? row.created_at).toLocaleString("en-AU")}</span>
          {row.sentiment ? <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs">{row.sentiment}</span> : null}
        </div>
        {row.comment_url ? <a href={row.comment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary"><ExternalLink className="h-3 w-3" />Open</a> : null}
      </div>
      <p className="whitespace-pre-wrap text-sm">{row.comment_text}</p>
      {row.post_text ? <p className="line-clamp-2 text-xs text-muted-foreground">On post: {row.post_text}</p> : null}
      {row.response_reason ? <p className="text-xs text-muted-foreground">Why reply: {row.response_reason}</p> : null}
      {row.post_error ? <p className="text-xs text-destructive">Posting failed: {row.post_error}</p> : null}
      {editable ? (
        <>
          <Textarea aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder="Write your reply" />
          {english && <p className="text-xs text-muted-foreground"><span className="font-medium">In English:</span> {english}</p>}
        </>
      ) : row.approved_response ? (
        <p className="rounded-md bg-secondary p-2 text-sm">Reply: {row.approved_response}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable && !reply.trim() && <Button size="sm" variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate()}><Sparkles className="mr-2 h-4 w-4" />{suggest.isPending ? "Writing…" : "Suggest a reply"}</Button>}
        {editable && <Button size="sm" disabled={act.isPending || !reply.trim()} onClick={() => act.mutate("approve")}>{act.isPending ? "Posting…" : "Approve & post reply"}</Button>}
        {row.status !== "posted" && row.status !== "dismissed" && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("dismiss")}>Dismiss</Button>}
        {(row.status === "approved" || row.status === "dismissed") && <Button size="sm" variant="outline" disabled={act.isPending} onClick={() => act.mutate("reopen")}>Back to review</Button>}
        {row.lead_id ? (
          <Link to="/leads/$leadId" params={{ leadId: row.lead_id }} className="inline-flex items-center text-sm text-primary underline">Open customer</Link>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConverting((v) => !v)}>Convert to lead</Button>
        )}
      </div>
      {converting && !row.lead_id && (
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="max-w-44" />
          <Input aria-label="Mobile" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="Mobile (they gave you)" className="max-w-52" />
          <Button size="sm" disabled={conv.isPending || !name.trim() || mobile.trim().length < 8} onClick={() => conv.mutate()}>Add customer</Button>
        </div>
      )}
    </div>
  );
}

/** Insights and Comments only make sense once a channel is connected. */
function YouTubeSection({ view }: { view: "insights" | "comments" }) {
  const load = useServerFn(getYouTube);
  const q = useQuery({ queryKey: ["youtube"], queryFn: () => load() });
  if (q.isLoading) return null;
  if (!q.data?.connected) return <div className="glass p-8 text-center text-sm text-muted-foreground">Connect your YouTube channel on the Upload tab first.</div>;
  return view === "insights" ? <YouTubeInsights isOwner={q.data.isOwner} /> : <YouTubeComments isOwner={q.data.isOwner} />;
}
