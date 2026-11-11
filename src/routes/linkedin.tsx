import { useEffect, useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Building2, ExternalLink, Globe, Linkedin, Loader2, Plus, Send, Sparkles, Unplug, User, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { initials } from "@/lib/campaign-templates";
import { LINKEDIN_POST_MAX } from "@/lib/linkedin";
import { disconnectLinkedInAccount, finishLinkedInVideo, getLinkedIn, postToLinkedIn, setLinkedInAuthor, startLinkedInConnect, startLinkedInMediaUpload, startLinkedInPagesConnect, writeLinkedInPost } from "@/lib/linkedin.functions";
import { AttachmentPicker, MediaPreview, uploadAttachments, type Attachment } from "@/components/linkedin/LinkedInAttachments";

export type Search = { linkedin?: string; why?: string };

// LinkedIn now lives in Social media. This address stays for LinkedIn's sign-in return and old links.
export const Route = createFileRoute("/linkedin")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    ...(typeof search["linkedin"] === "string" ? { linkedin: search["linkedin"].slice(0, 20) } : {}),
    ...(typeof search["why"] === "string" ? { why: search["why"].slice(0, 60) } : {}),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/social", search: { platform: "linkedin", ...search } });
  },
});

const CHIPS = ["Share a recent job", "A helpful tip", "Seasonal reminder", "Thank our customers", "Ask for referrals", "Keep it short"];

/** LinkedIn posting, shown inside the Social media page. `search` carries LinkedIn's sign-in result. */
export function LinkedInWorkspace({ search, clearSearch }: { search: Search; clearSearch: () => void }) {
  const qc = useQueryClient();
  const load = useServerFn(getLinkedIn);
  const q = useQuery({ queryKey: ["linkedin"], queryFn: () => load() });

  // Coming back from LinkedIn's sign-in.
  useEffect(() => {
    if (!search.linkedin) return;
    if (search.linkedin === "connected") toast.success("LinkedIn connected.");
    else if (search.linkedin === "denied") toast.info("LinkedIn wasn't connected.");
    else if (search.linkedin === "expired") toast.error("That sign-in link expired. Please connect again.");
    else toast.error(`LinkedIn couldn't be connected${search.why ? ` (${search.why})` : ""}. Please try again.`);
    void qc.invalidateQueries({ queryKey: ["linkedin"] });
    clearSearch();
  }, [search.linkedin, search.why, clearSearch, qc]);

  const start = useServerFn(startLinkedInConnect);
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast.error(e instanceof Error ? e.message : "LinkedIn couldn't be opened."),
  });

  const d = q.data;
  return (
    <div className="space-y-4">
        {d?.connected && (
          <div className="flex justify-end">
            <ConnectionChip data={d} onReconnect={() => connect.mutate()} reconnecting={connect.isPending} />
          </div>
        )}

        {q.isLoading ? (
          <div className="glass h-72 animate-pulse" />
        ) : q.isError || !d ? (
          <p className="glass p-6 text-sm text-destructive">LinkedIn couldn't be loaded.</p>
        ) : d.setupMissing ? (
          <p className="glass p-6 text-sm text-muted-foreground">LinkedIn posting is waiting for a database update (migration 0035_linkedin_posting).</p>
        ) : !d.connected ? (
          <ConnectCard platformReady={d.platformReady} missing={d.missingSettings} isOwner={d.isOwner} pagesEnabled={d.pagesEnabled} connecting={connect.isPending} onConnect={() => connect.mutate()} />
        ) : (
          <>
            {d.expired && (
              <p className="glass flex items-center gap-2 px-4 py-3 text-sm">
                <AlertTriangle className="size-4 shrink-0 text-warning" /> Your LinkedIn connection expired. Reconnect to keep posting.
              </p>
            )}
            <PagesCard data={d} />
            <Composer data={d} />
          </>
        )}

        {d && d.posts.length > 0 && <PostHistory posts={d.posts} />}
    </div>
  );
}

type Data = Awaited<ReturnType<typeof getLinkedIn>>;

function ConnectCard({ platformReady, missing, isOwner, pagesEnabled, connecting, onConnect }: { platformReady: boolean; missing: string[]; isOwner: boolean; pagesEnabled: boolean; connecting: boolean; onConnect: () => void }) {
  return (
    <section className="glass flex flex-col items-center gap-4 px-6 py-12 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-[#0a66c2] text-white shadow-[0_8px_24px_rgb(10_102_194/0.35)]">
        <Linkedin className="size-7" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Connect LinkedIn</h2>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">
          Sign in with LinkedIn to post from BookedSecure{pagesEnabled ? " to your profile or your Company Page" : " to your LinkedIn profile"}. We only post when you press Post.
        </p>
      </div>
      {!platformReady ? (
        <p className="max-w-md text-xs text-muted-foreground">
          LinkedIn isn't switched on for BookedSecure yet.
          {missing.length > 0 ? ` The site can't see: ${missing.join(", ")}. Check the name in Lovable's secrets and publish again.` : " It needs the LinkedIn app keys added."}
        </p>
      ) : !isOwner ? (
        <p className="text-xs text-muted-foreground">Only the business owner can connect LinkedIn.</p>
      ) : (
        <Button className="btn-glow" onClick={onConnect} disabled={connecting}>
          {connecting ? <Loader2 className="animate-spin" /> : <Linkedin />} Connect LinkedIn
        </Button>
      )}
      <p className="max-w-md text-[11px] text-muted-foreground">
        LinkedIn doesn't let apps read or send your LinkedIn messages, so messages stay in LinkedIn.
      </p>
    </section>
  );
}

function ConnectionChip({ data, onReconnect, reconnecting }: { data: Data; onReconnect: () => void; reconnecting: boolean }) {
  const qc = useQueryClient();
  const disconnect = useServerFn(disconnectLinkedInAccount);
  const off = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => {
      toast.success("LinkedIn disconnected.");
      void qc.invalidateQueries({ queryKey: ["linkedin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not disconnect."),
  });
  const soon = data.renewInDays !== null && data.renewInDays <= 7;
  return (
    <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
      <span className="inline-flex min-w-0 items-center gap-2 rounded-full border border-white/70 bg-white/55 py-1 pl-1 pr-3 text-xs backdrop-blur-xl">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#0a66c2] text-white"><Linkedin className="size-3.5" /></span>
        <span className="min-w-0 truncate font-medium">{data.memberName ?? "LinkedIn"}</span>
        {data.renewInDays !== null && (
          <span className={cn("shrink-0", soon ? "text-warning-foreground" : "text-muted-foreground")}>
            · {data.renewInDays < 0 ? "expired" : `renew in ${data.renewInDays}d`}
          </span>
        )}
      </span>
      {data.isOwner && (soon || data.expired) && (
        <Button size="sm" variant="outline" onClick={onReconnect} disabled={reconnecting}>Reconnect</Button>
      )}
      {data.isOwner && (
        <Button
          size="icon-sm"
          variant="ghost"
          title="Disconnect LinkedIn"
          aria-label="Disconnect LinkedIn"
          disabled={off.isPending}
          onClick={() => window.confirm("Disconnect LinkedIn? You can connect again any time.") && off.mutate()}
        >
          <Unplug />
        </Button>
      )}
    </div>
  );
}

/** Company Pages connect through BookedSecure's separate Pages app (LinkedIn requires it). */
function PagesCard({ data }: { data: Data }) {
  const start = useServerFn(startLinkedInPagesConnect);
  const connect = useMutation({
    mutationFn: () => start(),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (e) => toast.error(e instanceof Error ? e.message : "LinkedIn couldn't be opened."),
  });
  if (!data.isOwner || !data.pagesAppReady) return null;
  const renew = data.pagesRenewInDays;
  if (data.pagesConnected && (renew === null || renew > 7)) return null;
  return (
    <section className="glass flex flex-wrap items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#0a66c2]/10 text-[#0a66c2]"><Building2 className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{data.pagesConnected ? "Renew your Company Page connection" : "Post as your Company Page"}</p>
        <p className="text-xs text-muted-foreground">
          {data.pagesConnected
            ? `LinkedIn needs you to sign in again ${renew !== null && renew < 0 ? "now" : `within ${renew} days`} to keep posting as your Page.`
            : "Sign in once more to let BookedSecure post as a LinkedIn Page you manage. You need to be its admin or content admin."}
        </p>
      </div>
      <Button onClick={() => connect.mutate()} disabled={connect.isPending} className="max-sm:w-full">
        {connect.isPending ? <Loader2 className="animate-spin" /> : <Building2 />} {data.pagesConnected ? "Reconnect Pages" : "Connect Company Pages"}
      </Button>
    </section>
  );
}

function Composer({ data }: { data: Data }) {
  const qc = useQueryClient();
  const write = useServerFn(writeLinkedInPost);
  const post = useServerFn(postToLinkedIn);
  const choose = useServerFn(setLinkedInAuthor);
  const startUpload = useServerFn(startLinkedInMediaUpload);
  const finishVideo = useServerFn(finishLinkedInVideo);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mediaTitle, setMediaTitle] = useState("");
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [brief, setBrief] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState<string | null>(data.defaultAuthorUrn);
  useEffect(() => setAuthor((a) => a ?? data.defaultAuthorUrn), [data.defaultAuthorUrn]);
  const current = data.authors.find((a) => a.urn === author) ?? data.authors[0];

  const draft = useMutation({
    mutationFn: () => write({ data: { brief, chips } }),
    onSuccess: (r) => setText(r.text),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't write a post."),
  });
  const publish = useMutation({
    mutationFn: async () => {
      const authorUrn = current?.urn ?? null;
      const media = await uploadAttachments(attachments, {
        authorUrn,
        title: mediaTitle.trim(),
        deps: { start: startUpload, finishVideo },
        onProgress: (sent, total) => setProgress({ sent, total }),
      });
      return post({ data: { text, authorUrn, media } });
    },
    onSettled: () => setProgress(null),
    onSuccess: (r) => {
      toast.success(r.duplicate ? "That post was already published." : `Posted to LinkedIn as ${r.authorName}.`, {
        ...(r.url ? { action: { label: "View", onClick: () => window.open(r.url!, "_blank", "noopener") } } : {}),
      });
      setText("");
      setBrief("");
      setChips([]);
      for (const a of attachments) URL.revokeObjectURL(a.url);
      setAttachments([]);
      setMediaTitle("");
      void qc.invalidateQueries({ queryKey: ["linkedin"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "LinkedIn didn't accept the post.");
      void qc.invalidateQueries({ queryKey: ["linkedin"] });
    },
  });

  const over = text.trim().length > LINKEDIN_POST_MAX;
  return (
    <section className="glass grid overflow-clip lg:grid-cols-2">
      <div className="space-y-4 border-white/60 p-4 sm:p-5 lg:border-r">
        {data.authors.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Post as</p>
            <div className="flex flex-wrap gap-2">
              {data.authors.map((a) => (
                <button
                  key={a.urn}
                  type="button"
                  onClick={() => {
                    setAuthor(a.urn);
                    if (data.isOwner) void choose({ data: { authorUrn: a.urn } }).catch(() => undefined);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    current?.urn === a.urn ? "border-primary/40 bg-white/90 font-medium text-primary shadow-sm" : "border-white/70 bg-white/45 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {a.kind === "organization" ? <Building2 className="size-3.5" /> : <User className="size-3.5" />} {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-2xl border border-white/70 bg-white/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium"><Sparkles className="size-3.5 text-primary" /> Write with AI</p>
          <Textarea rows={2} maxLength={2000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What's the post about? e.g. We just finished a full detail on a 2019 Ranger in Parramatta" className="resize-none text-base md:text-sm" />
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((c) => {
              const on = chips.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChips((list) => (on ? list.filter((x) => x !== c) : [...list, c]))}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors", on ? "border-primary/40 bg-primary/10 text-primary" : "border-white/70 bg-white/50 text-muted-foreground hover:text-foreground")}
                >
                  <Plus className={cn("size-3 transition-transform", on && "rotate-45")} /> {c}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => draft.mutate()} disabled={draft.isPending}>
              {draft.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} {text ? "Write it again" : "Write the post"}
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="linkedin-post" className="text-xs font-medium text-muted-foreground">Your post</label>
          <Textarea id="linkedin-post" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your post here, or let AI write it above." className="text-base md:text-sm" />
          <p className={cn("text-right text-[11px] tabular", over ? "text-destructive" : "text-muted-foreground")}>{text.trim().length} / {LINKEDIN_POST_MAX}</p>
        </div>

        <AttachmentPicker attachments={attachments} onChange={setAttachments} title={mediaTitle} onTitle={setMediaTitle} disabled={publish.isPending} />

        {progress && (
          <div className="space-y-1" role="status">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/60">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((progress.sent / Math.max(progress.total, 1)) * 100)}%` }} />
            </div>
            <p className="text-[11px] text-muted-foreground">Uploading to LinkedIn… {Math.round((progress.sent / Math.max(progress.total, 1)) * 100)}%</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Globe className="size-3" /> Public post on LinkedIn</p>
          {data.isOwner ? (
            <Button className="btn-glow max-sm:w-full" onClick={() => publish.mutate()} disabled={!text.trim() || over || publish.isPending || data.expired}>
              {publish.isPending ? <Loader2 className="animate-spin" /> : <Send />} {publish.isPending && progress ? "Uploading…" : "Post to LinkedIn"}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">Only the owner can post.</p>
          )}
        </div>
      </div>

      <div className="border-t border-white/60 bg-white/25 p-4 sm:p-5 lg:border-t-0">
        <p className="mb-3 text-xs font-medium text-muted-foreground">What people see</p>
        <PostPreview name={current?.name ?? "You"} kind={current?.kind ?? "person"} text={text} media={<MediaPreview attachments={attachments} title={mediaTitle} />} />
      </div>
    </section>
  );
}

function PostPreview({ name, kind, text, media }: { name: string; kind: "person" | "organization"; text: string; media?: React.ReactNode }) {
  const [more, setMore] = useState(false);
  const long = text.length > 280;
  return (
    <article className="overflow-hidden rounded-2xl border border-white/80 bg-white/90 shadow-sm">
      <div className="flex items-center gap-3 p-4 pb-2">
        <span className={cn("grid size-11 shrink-0 place-items-center bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-sm font-semibold text-white", kind === "organization" ? "rounded-lg" : "rounded-full")}>
          {initials(name, null)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">Now · <Globe className="size-3" /></p>
        </div>
      </div>
      <div className="px-4 pb-4">
        {text.trim() ? (
          <p className="whitespace-pre-line break-words text-sm [overflow-wrap:anywhere]">
            {long && !more ? `${text.slice(0, 280).trimEnd()}… ` : text}
            {long && (
              <button type="button" onClick={() => setMore((m) => !m)} className="font-medium text-muted-foreground hover:text-primary">
                {more ? " show less" : "more"}
              </button>
            )}
          </p>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Your post will show here as you write it.</p>
        )}
      </div>
      {media}
      <div className="flex justify-around border-t border-foreground/5 px-2 py-2 text-xs text-muted-foreground" aria-hidden>
        <span>Like</span><span>Comment</span><span>Repost</span><span>Send</span>
      </div>
    </article>
  );
}

function PostHistory({ posts }: { posts: Data["posts"] }) {
  return (
    <section className="glass overflow-hidden" aria-labelledby="linkedin-history">
      <h2 id="linkedin-history" className="border-b border-white/60 px-4 py-3 text-sm font-semibold">Recent posts</h2>
      <ul className="divide-y divide-white/60">
        {posts.map((p) => (
          <li key={p.id} className="flex min-w-0 items-start gap-3 px-4 py-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[#0a66c2]/10 text-[#0a66c2]"><Linkedin className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 whitespace-pre-line break-words text-sm">{p.bodyText}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <span>{p.authorName ?? "LinkedIn"}</span>·<span>{relativeTime(p.publishedAt ?? p.createdAt)}</span>
                {p.source !== "app" && <>·<span>{p.source === "mcp" ? "via ChatGPT/Claude" : "via Co-Work"}</span></>}
              </p>
              {p.status === "failed" && <p className="mt-0.5 text-[11px] text-destructive">{p.error ?? "Didn't post."}</p>}
            </div>
            {p.status === "published" && p.url ? (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-primary hover:bg-white/60">
                View <ExternalLink className="size-3" />
              </a>
            ) : (
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", p.status === "failed" ? "bg-destructive/12 text-destructive" : p.status === "published" ? "bg-primary/12 text-primary" : "bg-foreground/8 text-muted-foreground")}>
                {p.status === "failed" ? "Failed" : p.status === "published" ? "Posted" : "Posting"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
