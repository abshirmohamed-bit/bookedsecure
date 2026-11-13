import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bookmark, CalendarClock, ExternalLink, Globe, Heart, ImagePlus, Loader2, MessageCircle, MoreHorizontal, Send, Share2, Sparkles, ThumbsUp, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { cancelSocialPost, getSocialPosting, publishSocialPost, saveSocialDraft, scheduleSocialPost, uploadSocialPicture, writeSocialPost } from "@/lib/social-posts.functions";

type Platform = "facebook" | "instagram";
type Picture = { id: string; preview: string; path: string | null; failed?: boolean };

const LIMIT: Record<Platform, number> = { facebook: 5000, instagram: 2200 };
const CHIPS = ["Share a recent job", "A helpful tip", "Seasonal reminder", "Special offer", "Thank our customers", "Keep it short"];

/** Turns any picture into a JPEG up to 1440px (Instagram only accepts JPEG). */
async function toJpegBase64(file: File): Promise<{ base64: string; preview: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That picture could not be opened."));
      el.src = url;
    });
    const scale = Math.min(1, 1440 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("That picture could not be prepared.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { base64: dataUrl.split(",")[1] ?? "", preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function MetaComposer({ platform }: { platform: Platform }) {
  const qc = useQueryClient();
  const load = useServerFn(getSocialPosting);
  const q = useQuery({ queryKey: ["social-posting", platform], queryFn: () => load({ data: { platform } }) });
  const write = useServerFn(writeSocialPost);
  const upload = useServerFn(uploadSocialPicture);
  const publish = useServerFn(publishSocialPost);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [brief, setBrief] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [when, setWhen] = useState("");
  const [mode, setMode] = useState<"now" | "later">("now");
  const schedule = useServerFn(scheduleSocialPost);
  const cancel = useServerFn(cancelSocialPost);
  const saveDraftFn = useServerFn(saveSocialDraft);

  const draft = useMutation({
    mutationFn: () => write({ data: { platform, brief, chips } }),
    onSuccess: (r) => setText(r.text),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't write that."),
  });
  const post = useMutation({
    mutationFn: () => publish({ data: { platform, text, imagePaths: pictures.map((p) => p.path!).filter(Boolean) } }),
    onSuccess: async (r) => {
      toast.success(r.duplicate ? "That post was already published." : `Posted to ${platform === "instagram" ? "Instagram" : "Facebook"}.`);
      reset();
      await qc.invalidateQueries({ queryKey: ["social-posting", platform] });
    },
    onError: async (e) => {
      toast.error(e instanceof Error ? e.message : "That didn't post.");
      await qc.invalidateQueries({ queryKey: ["social-posting", platform] });
    },
  });

  const reset = () => { setText(""); setBrief(""); setChips([]); setPictures([]); setWhen(""); setMode("now"); };
  const scheduleM = useMutation({
    mutationFn: () => schedule({ data: { platform, text, imagePaths: pictures.map((p) => p.path!).filter(Boolean), when: new Date(when).toISOString() } }),
    onSuccess: async (r) => {
      toast.success(`Scheduled for ${new Date(r.scheduledFor).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.`);
      reset();
      await qc.invalidateQueries({ queryKey: ["social-posting", platform] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't schedule that."),
  });
  // Drafts and approval: anyone on the team can save or send for approval; nothing is posted.
  const draftM = useMutation({
    mutationFn: (submit: boolean) => saveDraftFn({ data: { platform, text, imagePaths: pictures.map((p) => p.path!).filter(Boolean), plannedFor: when ? new Date(when).toISOString() : null, submit } }),
    onSuccess: async (r) => {
      toast.success(r.status === "pending_approval" ? "Sent to the owner for approval. It's in the Calendar tab." : "Draft saved. Find it in the Calendar tab.");
      reset();
      await qc.invalidateQueries({ queryKey: ["social-planner"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the draft."),
  });
  const cancelM = useMutation({
    mutationFn: (id: string) => cancel({ data: { id } }),
    onSuccess: async () => { toast.success("Scheduled post cancelled."); await qc.invalidateQueries({ queryKey: ["social-posting", platform] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't cancel."),
  });

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const room = 10 - pictures.length;
    for (const file of Array.from(files).slice(0, room)) {
      if (!file.type.startsWith("image/")) { toast.error(`${file.name} isn't a picture.`); continue; }
      const id = crypto.randomUUID();
      try {
        const { base64, preview } = await toJpegBase64(file);
        setPictures((current) => [...current, { id, preview, path: null }]);
        const { path } = await upload({ data: { data_base64: base64 } });
        setPictures((current) => current.map((p) => (p.id === id ? { ...p, path } : p)));
      } catch (e) {
        setPictures((current) => current.map((p) => (p.id === id ? { ...p, failed: true } : p)));
        toast.error(e instanceof Error ? e.message : "A picture couldn't be added.");
      }
    }
  }

  const d = q.data;
  const name = platform === "instagram" ? "Instagram" : "Facebook";
  if (q.isLoading) return <div className="glass h-72 animate-pulse" />;
  if (q.isError || !d) return <p className="glass p-6 text-sm text-destructive">{name} couldn't be loaded.</p>;
  if (!d.connected || (platform === "instagram" && !d.instagram)) {
    return (
      <div className="glass flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-base font-semibold">{!d.connected ? "Connect your Facebook Page" : "Link an Instagram account"}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {!d.connected
            ? "Posting uses the same Facebook connection as lead import and comments. Connect your Page, and approve posting when Facebook asks."
            : "Instagram posts go out through your Facebook Page. Link a professional Instagram account to the Page in Meta, then reconnect Facebook here."}
        </p>
        <Button asChild><Link to="/settings/integrations">Open Connections</Link></Button>
      </div>
    );
  }

  const ready = pictures.every((p) => p.path && !p.failed);
  const missingPicture = platform === "instagram" && pictures.length === 0;
  const canPost = d.isOwner && ready && !missingPicture && (text.trim().length > 0 || pictures.length > 0) && text.length <= LIMIT[platform];
  const postsAs = platform === "instagram" ? `@${d.instagram?.username ?? "instagram"}` : d.pageName ?? "your Page";

  const imagePaths = pictures.map((p) => p.preview);
  const preview = <PostPreview platform={platform} postsAs={postsAs} text={text} pictures={imagePaths} />;
  const hasContent = text.trim().length > 0 || pictures.length > 0;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] xl:gap-6">
      <section className="glass overflow-hidden p-0">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Avatar name={postsAs} />
          <p className="min-w-0 flex-1 truncate text-sm">Posting as <span className="font-semibold">{postsAs}</span></p>
          <Link to="/settings/integrations" className="shrink-0 text-xs text-muted-foreground hover:text-foreground">Reconnect</Link>
        </div>

        {/* AI assist sits inside the composer: describe it, pick a tone, and it fills the text below. */}
        <div className="space-y-2 border-b border-border bg-primary/[0.04] px-4 py-3">
          <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); draft.mutate(); }}>
            <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <input
              value={brief}
              maxLength={2000}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Tell AI what it's about, e.g. a ceramic coating on a black Mazda"
              aria-label="What the post is about"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <Button type="submit" size="sm" variant="outline" disabled={draft.isPending} className="shrink-0" aria-label={text.trim() ? "Rewrite with AI" : "Write with AI"}>
              {draft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              <span className="hidden sm:inline">{text.trim() ? "Rewrite" : "Write it"}</span>
            </Button>
          </form>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
            {CHIPS.map((chip) => (
              <button key={chip} type="button" aria-pressed={chips.includes(chip)} onClick={() => setChips((c) => (c.includes(chip) ? c.filter((x) => x !== chip) : [...c, chip]))}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${chips.includes(chip) ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/60 text-muted-foreground hover:text-foreground"}`}>
                {chip}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 pt-3">
          <Textarea
            rows={8}
            value={text}
            aria-label={platform === "instagram" ? "Caption" : "Post text"}
            placeholder={platform === "instagram" ? "Write a caption…" : "What would you like to share?"}
            onChange={(e) => setText(e.target.value)}
            className="min-h-44 resize-y border-0 bg-transparent px-0 text-[15px] shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          {pictures.map((p) => (
            <div key={p.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
              <img src={p.preview} alt="" className={`h-full w-full object-cover ${p.path ? "" : "opacity-50"}`} />
              {!p.path && !p.failed && <Loader2 className="absolute inset-0 m-auto h-4 w-4 animate-spin text-primary" />}
              {p.failed && <span className="absolute inset-x-0 bottom-0 bg-destructive/90 text-center text-[10px] text-white">Failed</span>}
              <button type="button" aria-label="Remove picture" onClick={() => setPictures((c) => c.filter((x) => x.id !== p.id))}
                className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-background/90 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {pictures.length < 10 && (
            <button type="button" onClick={() => fileRef.current?.click()}
              className="inline-flex h-16 items-center gap-2 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground hover:border-primary/50 hover:text-primary">
              <ImagePlus className="h-5 w-5" /> {pictures.length ? "Add more" : "Add pictures"}
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
          <span className={`ml-auto self-end text-[11px] tabular-nums ${text.length > LIMIT[platform] ? "text-destructive" : "text-muted-foreground"}`}>{text.length} / {LIMIT[platform]}</span>
        </div>
        {missingPicture && <p className="px-4 pb-3 text-xs text-muted-foreground">Instagram posts need at least one picture (up to 10).</p>}

        {/* When and how it goes out, in one place. */}
        <div className="space-y-3 border-t border-border bg-card/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="When to post" className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {(["now", "later"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m}
                  onClick={() => { setMode(m); if (m === "now") setWhen(""); }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium ${mode === m ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {m === "now" ? <Send className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                  {m === "now" ? (d.isOwner ? "Post now" : "No date") : "Pick a time"}
                </button>
              ))}
            </div>
            {mode === "later" && (
              <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Schedule for"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground sm:flex-none" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!d.isOwner && <p className="w-full text-xs text-muted-foreground sm:mr-auto sm:w-auto">The owner approves posts before they go out.</p>}
            <Button variant="ghost" className="sm:ml-auto" disabled={!ready || !hasContent || draftM.isPending} onClick={() => draftM.mutate(false)}>Save draft</Button>
            {!d.isOwner ? (
              <Button className="btn-glow flex-1 sm:flex-none" disabled={!ready || missingPicture || !hasContent || draftM.isPending} onClick={() => draftM.mutate(true)}>
                {draftM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send for approval
              </Button>
            ) : when ? (
              <Button className="btn-glow flex-1 sm:flex-none" disabled={!canPost || scheduleM.isPending} onClick={() => scheduleM.mutate()}>
                {scheduleM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Schedule
              </Button>
            ) : (
              <Button className="btn-glow flex-1 sm:flex-none" disabled={!canPost || post.isPending || mode === "later"} onClick={() => post.mutate()}>
                {post.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post to {name}
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="space-y-4 lg:sticky lg:top-4">
        {/* Phones: the preview folds away under the composer. */}
        <details className="glass group p-3 lg:hidden">
          <summary className="cursor-pointer list-none text-sm font-medium text-primary">
            <span className="group-open:hidden">Show preview</span><span className="hidden group-open:inline">Hide preview</span>
          </summary>
          <div className="mt-3">{preview}</div>
        </details>
        <section className="hidden lg:block">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">How it will look on {name}</p>
          {preview}
        </section>

        {d.posts.length > 0 && (
          <section className="glass p-4">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent posts</p>
            <ul className="divide-y divide-border">
              {d.posts.map((post) => (
                <li key={post.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm">{post.bodyText}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {post.status === "scheduled" && post.scheduledFor
                        ? <span className="font-medium text-primary">Scheduled for {new Date(post.scheduledFor).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span>
                        : <>{relativeTime(post.createdAt)} · {post.status === "published" ? "Published" : post.status === "failed" ? <span className="text-destructive">Failed: {post.error}</span> : post.status === "cancelled" ? "Cancelled" : "Publishing…"}</>}
                    </p>
                  </div>
                  {post.status === "scheduled" && d.isOwner && (
                    <button type="button" onClick={() => cancelM.mutate(post.id)} disabled={cancelM.isPending} className="shrink-0 text-xs text-muted-foreground hover:text-destructive">Cancel</button>
                  )}
                  {post.url && (
                    <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function Avatar({ name, ring = false }: { name: string; ring?: boolean }) {
  const letter = name.replace(/^@/, "").trim()[0]?.toUpperCase() ?? "?";
  return (
    <span aria-hidden="true" className={`grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[oklch(0.45_0.15_258)] to-[oklch(0.62_0.15_245)] text-sm font-semibold text-white ${ring ? "ring-2 ring-primary/40 ring-offset-2 ring-offset-card" : ""}`}>
      {letter}
    </span>
  );
}

/** A close likeness of the real Facebook or Instagram post, so the owner sees what customers will see. */
function PostPreview({ platform, postsAs, text, pictures }: { platform: Platform; postsAs: string; text: string; pictures: string[] }) {
  const handle = postsAs.replace(/^@/, "");
  if (platform === "instagram") {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Avatar name={postsAs} ring />
          <p className="text-sm font-semibold">{handle}</p>
          <MoreHorizontal className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
        </div>
        {pictures[0] ? (
          <div className="relative">
            <img src={pictures[0]} alt="" className="aspect-square w-full object-cover" />
            {pictures.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">1/{pictures.length}</span>}
          </div>
        ) : (
          <div className="grid aspect-square w-full place-items-center bg-secondary/60 text-xs text-muted-foreground">Your picture</div>
        )}
        <div className="flex items-center gap-3.5 px-3 pt-2.5">
          <Heart className="h-5 w-5" aria-hidden="true" /><MessageCircle className="h-5 w-5" aria-hidden="true" /><Send className="h-5 w-5" aria-hidden="true" />
          <Bookmark className="ml-auto h-5 w-5" aria-hidden="true" />
        </div>
        <p className="line-clamp-4 whitespace-pre-wrap px-3 pb-3 pt-1.5 text-sm">
          {text ? <><span className="font-semibold">{handle} </span>{text}</> : <span className="text-muted-foreground">Your caption will appear here.</span>}
        </p>
      </div>
    );
  }
  const shown = pictures.slice(0, 4);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm">
      <div className="flex items-center gap-2.5 px-3 pt-3">
        <Avatar name={postsAs} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{postsAs}</p>
          <p className="flex items-center gap-1 text-[11px] text-muted-foreground">Just now · <Globe className="h-3 w-3" aria-hidden="true" /></p>
        </div>
        <MoreHorizontal className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="line-clamp-6 whitespace-pre-wrap px-3 py-2.5 text-sm">
        {text || (shown.length ? null : <span className="text-muted-foreground">Your post will appear here.</span>)}
      </p>
      {shown.length > 0 && (
        <div className={`grid gap-0.5 ${shown.length > 1 ? "grid-cols-2" : ""}`}>
          {shown.map((src, i) => (
            <div key={i} className={`relative ${shown.length === 3 && i === 0 ? "col-span-2" : ""}`}>
              <img src={src} alt="" className={`w-full object-cover ${shown.length === 1 ? "max-h-96" : "aspect-square"}`} />
              {i === 3 && pictures.length > 4 && <span className="absolute inset-0 grid place-items-center bg-black/50 text-xl font-semibold text-white">+{pictures.length - 4}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="mx-3 mt-1 flex justify-around border-t border-border py-1.5 text-xs font-medium text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 py-1"><ThumbsUp className="h-4 w-4" aria-hidden="true" />Like</span>
        <span className="inline-flex items-center gap-1.5 py-1"><MessageCircle className="h-4 w-4" aria-hidden="true" />Comment</span>
        <span className="inline-flex items-center gap-1.5 py-1"><Share2 className="h-4 w-4" aria-hidden="true" />Share</span>
      </div>
    </div>
  );
}
