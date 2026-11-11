import { useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ExternalLink, ImagePlus, Loader2, Send, Sparkles, Wand2, X } from "lucide-react";
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

  const reset = () => { setText(""); setBrief(""); setChips([]); setPictures([]); setWhen(""); };
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

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="glass space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">Posting as <span className="font-semibold">{postsAs}</span></p>
          <Link to="/settings/integrations" className="text-xs text-muted-foreground hover:text-foreground">Reconnect Facebook</Link>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Let AI write it</p>
          <Textarea rows={2} value={brief} maxLength={2000} placeholder="What's the post about? e.g. a ceramic coating we finished on a black Mazda" onChange={(e) => setBrief(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button key={chip} type="button" onClick={() => setChips((c) => (c.includes(chip) ? c.filter((x) => x !== chip) : [...c, chip]))}
                className={`rounded-full border px-2.5 py-1 text-xs ${chips.includes(chip) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {chip}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />} Write {platform === "instagram" ? "caption" : "post"}
          </Button>
        </div>

        <div>
          <Textarea rows={7} value={text} placeholder={platform === "instagram" ? "Caption" : "What would you like to share?"} onChange={(e) => setText(e.target.value)} />
          <p className={`mt-1 text-right text-[11px] ${text.length > LIMIT[platform] ? "text-destructive" : "text-muted-foreground"}`}>{text.length} / {LIMIT[platform]}</p>
        </div>

        <div className="flex flex-wrap gap-2">
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
              className="grid h-16 w-16 place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary" aria-label="Add pictures">
              <ImagePlus className="h-5 w-5" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        {missingPicture && <p className="text-xs text-muted-foreground">Instagram posts need at least one picture (up to 10).</p>}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!d.isOwner && <p className="mr-auto text-xs text-muted-foreground">The owner approves posts before they go out.</p>}
          <Button variant="ghost" disabled={!ready || (!text.trim() && pictures.length === 0) || draftM.isPending} onClick={() => draftM.mutate(false)}>Save draft</Button>
          {!d.isOwner && (
            <Button disabled={!ready || missingPicture || (!text.trim() && pictures.length === 0) || draftM.isPending} onClick={() => draftM.mutate(true)}>
              {draftM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Send for approval
            </Button>
          )}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Schedule for"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          </label>
          {!d.isOwner ? null : when ? (
            <Button disabled={!canPost || scheduleM.isPending} onClick={() => scheduleM.mutate()}>
              {scheduleM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CalendarClock className="mr-1.5 h-4 w-4" />} Schedule
            </Button>
          ) : (
            <Button disabled={!canPost || post.isPending} onClick={() => post.mutate()}>
              {post.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Post to {name}
            </Button>
          )}
        </div>
        {when && <p className="text-right text-[11px] text-muted-foreground">Leave the date empty to post now.</p>}
      </section>

      <div className="space-y-4">
        <section className="glass p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <p className="px-3 py-2 text-sm font-semibold">{postsAs}</p>
            {platform === "facebook" && text && <p className="whitespace-pre-wrap px-3 pb-2 text-sm">{text}</p>}
            {pictures[0] && <img src={pictures[0].preview} alt="" className="aspect-square w-full object-cover" />}
            {pictures.length > 1 && <p className="px-3 pt-1 text-[11px] text-muted-foreground">+{pictures.length - 1} more picture{pictures.length > 2 ? "s" : ""}</p>}
            {platform === "instagram" && text && <p className="whitespace-pre-wrap px-3 py-2 text-sm"><span className="font-semibold">{postsAs} </span>{text}</p>}
            {!text && pictures.length === 0 && <p className="px-3 pb-6 text-sm text-muted-foreground">Your post will appear here.</p>}
          </div>
        </section>

        {d.posts.length > 0 && (
          <section className="glass p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent posts</p>
            <ul className="divide-y divide-border">
              {d.posts.map((post) => (
                <li key={post.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">{post.bodyText}</p>
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
