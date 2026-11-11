import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, ExternalLink, Film, Loader2, Sparkles, Upload, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { YOUTUBE_ACCEPT, YOUTUBE_CHUNK_BYTES, YOUTUBE_DESCRIPTION_MAX, YOUTUBE_TITLE_MAX, videoProblem, type YouTubePrivacy } from "@/lib/youtube";
import { abandonYouTubeVideoUpload, disconnectYouTubeAccount, getYouTube, startYouTubeConnect, startYouTubeVideoUpload, writeYouTubeVideo } from "@/lib/youtube.functions";

const CHIPS = ["Before and after", "How we do it", "A helpful tip", "Customer job walkthrough", "Keep it short"];
const PRIVACY: { id: YouTubePrivacy; label: string; hint: string }[] = [
  { id: "public", label: "Public", hint: "Anyone can find and watch it." },
  { id: "unlisted", label: "Unlisted", hint: "Only people with the link." },
  { id: "private", label: "Private", hint: "Only you, in YouTube Studio." },
];
const CONNECT_MESSAGES: Record<string, string> = {
  connected: "YouTube connected.",
  denied: "YouTube wasn't connected: the Google sign-in was cancelled.",
  expired: "That sign-in link expired. Please connect again.",
  failed: "YouTube couldn't be connected. Please try again.",
};
const WHY: Record<string, string> = {
  no_channel: "This Google account has no YouTube channel yet. Create one on youtube.com, then connect again.",
  scope_missing: "Please tick \"Manage your YouTube videos\" when Google asks.",
  no_refresh: "Remove BookedSecure from your Google account's third-party access, then connect again.",
  owner: "Only the business owner can connect YouTube.",
};
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;

export function YouTubeComposer({ outcome, why, clearOutcome, clipId, clipTitle }: { outcome?: string | undefined; why?: string | undefined; clearOutcome: () => void; clipId?: string | undefined; clipTitle?: string | undefined }) {
  const qc = useQueryClient();
  const load = useServerFn(getYouTube);
  const q = useQuery({ queryKey: ["youtube"], queryFn: () => load() });
  const connect = useServerFn(startYouTubeConnect);
  const disconnect = useServerFn(disconnectYouTubeAccount);
  const write = useServerFn(writeYouTubeVideo);
  const start = useServerFn(startYouTubeVideoUpload);
  const abandon = useServerFn(abandonYouTubeVideoUpload);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brief, setBrief] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState<YouTubePrivacy>("public");
  const [when, setWhen] = useState("");
  const [madeForKids, setMadeForKids] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!outcome) return;
    const message = CONNECT_MESSAGES[outcome] ?? CONNECT_MESSAGES["failed"]!;
    const extra = why ? WHY[why.replace(/-\d+$/, "")] : undefined;
    if (outcome === "connected") toast.success(message); else toast.error(extra ?? message);
    clearOutcome();
    void qc.invalidateQueries({ queryKey: ["youtube"] });
  }, [outcome, why, clearOutcome, qc]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const connectM = useMutation({
    mutationFn: () => connect(),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't start the Google sign-in."),
  });
  const disconnectM = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: async () => { toast.success("YouTube disconnected."); await qc.invalidateQueries({ queryKey: ["youtube"] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't disconnect."),
  });
  const draft = useMutation({
    mutationFn: () => write({ data: { brief, chips } }),
    onSuccess: (r) => { if (r.title) setTitle(r.title); setDescription(r.description); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't write that."),
  });

  // A finished clip sent over from Co-work's Results arrives ready to upload.
  const loadedClip = useRef<string | null>(null);
  useEffect(() => {
    if (!clipId || loadedClip.current === clipId) return;
    loadedClip.current = clipId;
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const res = await fetch(`/api/video-clips/${clipId}/file`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        choose([new File([blob], `${clipTitle || "clip"}.mp4`, { type: "video/mp4" })]);
      } catch (e) {
        toast.error(e instanceof Error && e.message ? e.message : "That clip couldn't be loaded.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId]);

  function choose(files: ArrayLike<File> | null) {
    const f = files?.[0];
    if (!f) return;
    const problem = videoProblem({ title: "x", description: "", fileSize: f.size, mimeType: f.type });
    if (problem) { toast.error(problem); return; }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, YOUTUBE_TITLE_MAX));
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a video first.");
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to upload.");
      const plan = await start({ data: {
        title, description, privacy, madeForKids,
        publishAt: when ? new Date(when).toISOString() : null,
        fileSize: file.size, mimeType: file.type || "application/octet-stream",
      } });
      setProgress(0);
      try {
        let next = 0;
        for (;;) {
          const piece = file.slice(next, Math.min(next + YOUTUBE_CHUNK_BYTES, file.size));
          const res = await fetch(`/api/youtube/upload?ticket=${encodeURIComponent(plan.ticket)}&start=${next}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
            body: piece,
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; done?: boolean; nextByte?: number; url?: string };
          if (!res.ok) throw new Error(body.error ?? "The video didn't upload.");
          if (body.done) { setProgress(100); return { url: body.url ?? null, channel: plan.channelTitle }; }
          next = typeof body.nextByte === "number" && body.nextByte > next ? body.nextByte : next + piece.size;
          setProgress(Math.min(99, Math.round((next / file.size) * 100)));
          if (next >= file.size) throw new Error("YouTube didn't confirm the upload. Check YouTube Studio before trying again.");
        }
      } catch (e) {
        await abandon({ data: { postId: plan.postId, reason: e instanceof Error ? e.message : "The upload stopped." } }).catch(() => undefined);
        throw e;
      }
    },
    onSuccess: async (r) => {
      toast.success(when ? `Uploaded to ${r.channel}. YouTube will publish it ${fmtWhen(new Date(when).toISOString())}.` : `Uploaded to ${r.channel}. YouTube may take a few minutes to process it.`);
      setFile(null); setPreview(null); setTitle(""); setDescription(""); setBrief(""); setChips([]); setWhen(""); setMadeForKids(false);
      await qc.invalidateQueries({ queryKey: ["youtube"] });
    },
    onError: async (e) => {
      toast.error(e instanceof Error ? e.message : "The upload didn't work.");
      await qc.invalidateQueries({ queryKey: ["youtube"] });
    },
    onSettled: () => setProgress(null),
  });

  if (q.isLoading) return <div className="glass grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (q.isError || !q.data) return <div className="glass p-6 text-sm text-destructive">Couldn't load YouTube. Refresh to try again.</div>;
  const d = q.data;

  if (!d.connected) {
    return (
      <div className="glass flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-base font-semibold">Connect your YouTube channel</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {d.setupMissing ? "YouTube posting is waiting for a one-time database update."
            : !d.platformReady ? "YouTube isn't switched on for BookedSecure yet. It will appear here once it is."
            : "Sign in with the Google account that owns your channel and allow BookedSecure to upload videos. Nothing is uploaded until you press Upload."}
        </p>
        {d.isOwner ? (
          <Button disabled={!d.platformReady || d.setupMissing || connectM.isPending} onClick={() => connectM.mutate()}>
            {connectM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Connect YouTube
          </Button>
        ) : <p className="text-xs text-muted-foreground">Ask the business owner to connect YouTube.</p>}
      </div>
    );
  }

  const busy = upload.isPending;
  const problem = file ? videoProblem({ title, description, fileSize: file.size, mimeType: file.type }) : "Choose a video.";
  const canUpload = d.isOwner && !problem && !busy;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="glass space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm">
            {d.channelThumbnail && <img src={d.channelThumbnail} alt="" className="h-6 w-6 rounded-full" />}
            Uploading to <span className="font-semibold">{d.channelTitle ?? "your channel"}</span>
          </p>
          {d.isOwner && (
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => connectM.mutate()}>Reconnect</button>
              <button type="button" className="text-muted-foreground hover:text-destructive" disabled={disconnectM.isPending} onClick={() => disconnectM.mutate()}>Disconnect</button>
            </div>
          )}
        </div>

        {file ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card/60 p-2">
            <Film className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">{mb(file.size)}</p>
            </div>
            {!busy && (
              <button type="button" aria-label="Remove video" onClick={() => { setFile(null); setPreview(null); }} className="grid h-6 w-6 place-items-center rounded-full text-muted-foreground hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground hover:border-primary/50 hover:text-primary">
            <Upload className="h-5 w-5" /> Choose a video
            <span className="text-[11px]">MP4, MOV or WebM, up to 2 GB. Vertical videos up to 3 minutes become Shorts.</span>
          </button>
        )}
        <input ref={fileRef} type="file" accept={YOUTUBE_ACCEPT} className="sr-only" onChange={(e) => { choose(e.target.files); e.target.value = ""; }} />

        <div className="space-y-2 rounded-lg border border-border bg-card/60 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-primary"><Sparkles className="h-3.5 w-3.5" /> Let AI write the title and description</p>
          <Textarea rows={2} value={brief} maxLength={2000} placeholder="What's in the video? e.g. full detail on a white Ranger after a beach trip" onChange={(e) => setBrief(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {CHIPS.map((chip) => (
              <button key={chip} type="button" onClick={() => setChips((c) => (c.includes(chip) ? c.filter((x) => x !== chip) : [...c, chip]))}
                className={`rounded-full border px-2.5 py-1 text-xs ${chips.includes(chip) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {chip}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" disabled={draft.isPending} onClick={() => draft.mutate()}>
            {draft.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />} Write it
          </Button>
        </div>

        <div>
          <Input value={title} maxLength={YOUTUBE_TITLE_MAX} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
          <p className="mt-1 text-right text-[11px] text-muted-foreground">{title.length} / {YOUTUBE_TITLE_MAX}</p>
        </div>
        <div>
          <Textarea rows={6} value={description} placeholder="Description" onChange={(e) => setDescription(e.target.value)} />
          <p className={`mt-1 text-right text-[11px] ${description.length > YOUTUBE_DESCRIPTION_MAX ? "text-destructive" : "text-muted-foreground"}`}>{description.length} / {YOUTUBE_DESCRIPTION_MAX}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium">Who can watch</p>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {PRIVACY.map((p) => (
                <button key={p.id} type="button" disabled={Boolean(when)} title={p.hint} onClick={() => setPrivacy(p.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${(when ? p.id === "public" : privacy === p.id) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"} disabled:opacity-60`}>
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{when ? "Scheduled videos stay private until they go public at that time." : PRIVACY.find((p) => p.id === privacy)?.hint}</p>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium">Made for kids?</p>
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5">
              {([[false, "No"], [true, "Yes"]] as const).map(([v, label]) => (
                <button key={label} type="button" onClick={() => setMadeForKids(v)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${madeForKids === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">YouTube requires this answer. Most business videos are "No".</p>
          </div>
        </div>

        {progress !== null && (
          <div className="space-y-1">
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
            <p className="text-[11px] text-muted-foreground">Uploading… {progress}%. Keep this page open.</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!d.isOwner && <p className="mr-auto text-xs text-muted-foreground">Only the owner can upload.</p>}
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <input type="datetime-local" value={when} disabled={busy} onChange={(e) => setWhen(e.target.value)} aria-label="Publish at"
              className="h-9 rounded-md border border-input bg-background px-2 text-xs text-foreground" />
          </label>
          <Button disabled={!canUpload} onClick={() => upload.mutate()}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : when ? <CalendarClock className="mr-1.5 h-4 w-4" /> : <Upload className="mr-1.5 h-4 w-4" />}
            {when ? "Upload and schedule" : "Upload to YouTube"}
          </Button>
        </div>
        {when && <p className="text-right text-[11px] text-muted-foreground">Leave the date empty to publish when the upload finishes.</p>}
      </section>

      <div className="space-y-4">
        <section className="glass p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {preview ? <video src={preview} controls muted className="aspect-video w-full bg-black object-contain" />
              : <div className="grid aspect-video w-full place-items-center bg-muted/40 text-sm text-muted-foreground">Your video will appear here.</div>}
            <div className="space-y-1 p-3">
              <p className="line-clamp-2 text-sm font-semibold">{title || "Title"}</p>
              <p className="text-xs text-muted-foreground">{d.channelTitle}</p>
              {description && <p className="line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">{description}</p>}
            </div>
          </div>
        </section>

        {d.videos.length > 0 && (
          <section className="glass p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent videos</p>
            <ul className="divide-y divide-border">
              {d.videos.map((v) => (
                <li key={v.id} className="flex items-start gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm">{v.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {v.status === "scheduled" && v.publishAt ? <span className="font-medium text-primary">Goes public {fmtWhen(v.publishAt)}</span>
                        : v.status === "failed" ? <span className="text-destructive">Failed: {v.error}</span>
                        : <>{relativeTime(v.createdAt)} · {v.status === "uploading" ? "Uploading…" : v.privacy === "unlisted" ? "Unlisted" : v.privacy === "private" ? "Private" : "Published"}</>}
                    </p>
                  </div>
                  {v.url && (
                    <a href={v.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs text-primary">
                      <ExternalLink className="h-3 w-3" /> Open
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">Edit or delete videos in YouTube Studio.</p>
          </section>
        )}
      </div>
    </div>
  );
}
