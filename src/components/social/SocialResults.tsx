import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Download, Facebook, Film, Instagram, Linkedin, Loader2, MessageCircle, PenLine, Play, Send, Sparkles, Trash2, TriangleAlert, X, Youtube } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/Portal";
import { resultDayLabel } from "@/lib/social-cowork";
import { getLinkedIn } from "@/lib/linkedin.functions";
import { getSocialPosting } from "@/lib/social-posts.functions";
import { getYouTube } from "@/lib/youtube.functions";
import { listSocialComments } from "@/lib/social-comments.functions";
import { isActiveJob, jobStatusLabel } from "@/lib/video-clips";
import { deleteVideoJobs, getVideoClips, renameVideoClip, renderVideoClip } from "@/lib/video-clips.functions";

export type Job = Awaited<ReturnType<typeof getVideoClips>>["jobs"][number];
export type Clip = Job["clips"][number];

const ACCOUNTS = [
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-[#1877f2]" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-[#d62976]" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-[#0a66c2]" },
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-[#ff0000]" },
] as const;

/** The connected accounts, each opening its hands-on tools. */
export function YourChannels({ narrow = false }: { narrow?: boolean }) {
  const postsFn = useServerFn(getSocialPosting);
  const youtubeFn = useServerFn(getYouTube);
  const linkedinFn = useServerFn(getLinkedIn);
  const facebook = useQuery({ queryKey: ["social-posting", "facebook"], queryFn: () => postsFn({ data: { platform: "facebook" } }) });
  const instagram = useQuery({ queryKey: ["social-posting", "instagram"], queryFn: () => postsFn({ data: { platform: "instagram" } }) });
  const youtube = useQuery({ queryKey: ["youtube"], queryFn: () => youtubeFn() });
  const linkedin = useQuery({ queryKey: ["linkedin"], queryFn: () => linkedinFn() });
  const connected: Record<(typeof ACCOUNTS)[number]["id"], boolean | undefined> = {
    facebook: facebook.data?.connected,
    instagram: instagram.data ? Boolean(instagram.data.instagram) : undefined,
    linkedin: linkedin.data?.connected,
    youtube: youtube.data?.connected,
  };
  return (
    <div className={`grid grid-cols-2 gap-2.5 ${narrow ? "" : "lg:grid-cols-4"}`}>
      {ACCOUNTS.map((a) => (
        <Link key={a.id} to="/social" search={{ platform: a.id }} aria-label={`Open ${a.label} tools`} className="glass flex min-h-14 items-center gap-2.5 rounded-2xl px-3 py-2 hover:bg-white/70">
          <a.icon className={`size-5 shrink-0 ${a.color}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium">{a.label}</span>
            <span className="block truncate text-[11px] text-muted-foreground">{connected[a.id] === undefined ? " " : connected[a.id] ? "Connected" : "Connect"}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Everything Co-Work has made or is waiting on, newest first. */
export function SocialResults({ onAsk, wide = false }: { onAsk: (text: string) => void; wide?: boolean }) {
  const clipsFn = useServerFn(getVideoClips);
  const commentsFn = useServerFn(listSocialComments);
  const postsFn = useServerFn(getSocialPosting);
  const clips = useQuery({
    queryKey: ["video-clips"],
    queryFn: () => clipsFn(),
    refetchInterval: (q) => {
      const jobs = q.state.data?.jobs ?? [];
      return jobs.some((j) => isActiveJob(j.status) || j.clips.some((c) => c.status === "EXPORTING")) ? 5000 : 60_000;
    },
  });
  const comments = useQuery({ queryKey: ["social-comments", "pending_review"], queryFn: () => commentsFn({ data: { status: "pending_review" } }) });
  const facebook = useQuery({ queryKey: ["social-posting", "facebook"], queryFn: () => postsFn({ data: { platform: "facebook" } }) });
  const instagram = useQuery({ queryKey: ["social-posting", "instagram"], queryFn: () => postsFn({ data: { platform: "instagram" } }) });

  const waiting = comments.data?.length ?? 0;
  const jobs = clips.data?.jobs ?? [];
  const posts = [...(facebook.data?.posts ?? []), ...(instagram.data?.posts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const groups = (["Today", "Yesterday", "Earlier"] as const)
    .map((label) => ({ label, jobs: jobs.filter((j) => resultDayLabel(j.created_at) === label) }))
    .filter((g) => g.jobs.length > 0);
  const empty = !waiting && !jobs.length && !posts.length && !clips.isLoading;

  return (
    <div className="space-y-4">
      {waiting > 0 ? (
        <button type="button" onClick={() => onAsk(`Show me the ${waiting === 1 ? "comment" : `${waiting} comments`} waiting for a reply and suggest what to say.`)} className="glass flex min-h-14 w-full items-center gap-3 rounded-2xl p-3 text-left hover:bg-white/70">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><MessageCircle className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{waiting} comment{waiting === 1 ? "" : "s"} waiting</span>
            <span className="block text-xs text-muted-foreground">Ask Co-Work to draft the replies</span>
          </span>
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
        </button>
      ) : null}

      {groups.map((group) => (
        <section key={group.label} className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">{group.label}</h3>
          {group.jobs.map((job) => <JobCard key={job.id} job={job} onAsk={onAsk} wide={wide} />)}
        </section>
      ))}
      {jobs.length > 1 ? <ClearAllClips count={jobs.length} /> : null}

      {posts.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-muted-foreground">Recent posts</h3>
          <ul className="glass divide-y divide-border rounded-2xl">
            {posts.map((post) => (
              <li key={post.id} className="flex items-start gap-2 p-3">
                {post.status === "failed" ? <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />}
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm">{post.bodyText}</p>
                  <p className="mt-0.5 text-xs capitalize text-muted-foreground">{post.platform} · {post.status}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {empty ? (
        <p className="glass rounded-2xl p-4 text-sm text-muted-foreground">Clips, posts and anything waiting for you will show up here.</p>
      ) : null}
      {clips.data && !clips.data.configured && jobs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Video clipping isn't switched on yet. Posts and replies work now.</p>
      ) : null}
    </div>
  );
}

export function useDeleteVideoJobs() {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteVideoJobs);
  return useMutation({
    mutationFn: (jobId?: string) => deleteFn({ data: jobId ? { jobId } : {} }),
    onSuccess: async (r) => { await qc.invalidateQueries({ queryKey: ["video-clips"] }); toast.success(r.deleted === 1 ? "Video and its clips deleted." : `${r.deleted} videos and their clips deleted.`); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That couldn't be deleted."),
  });
}

function ClearAllClips({ count }: { count: number }) {
  const remove = useDeleteVideoJobs();
  return (
    <ConfirmAction title="Delete all clips?" description={`All ${count} videos and every clip made from them will be deleted. This can't be undone.`} confirmLabel="Delete all" onConfirm={() => remove.mutate(undefined)}>
      <button
        type="button"
        disabled={remove.isPending}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        <Trash2 className="size-3.5" aria-hidden="true" />{remove.isPending ? "Deleting…" : "Delete all clips"}
      </button>
    </ConfirmAction>
  );
}

function JobCard({ job, onAsk, wide }: { job: Job; onAsk: (text: string) => void; wide: boolean }) {
  const moving = isActiveJob(job.status);
  const remove = useDeleteVideoJobs();
  return (
    <article className="glass overflow-hidden rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary/10 text-primary">
          {job.thumbnail_url ? <img src={job.thumbnail_url} alt="" className="size-full object-cover" /> : <Film className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{job.source_name}</p>
          <p className={`text-xs ${job.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}>
            {job.status === "FAILED" ? (job.error ?? jobStatusLabel(job)) : jobStatusLabel(job)}{moving && job.progress > 0 ? ` · ${Math.round(job.progress)}%` : ""}
          </p>
        </div>
        {moving ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
        <ConfirmAction title="Delete this video?" description={`"${job.source_name}" and every clip made from it will be deleted. This can't be undone.`} onConfirm={() => remove.mutate(job.id)}>
          <button
            type="button"
            disabled={remove.isPending}
            aria-label={`Delete ${job.source_name} and its clips`}
            title="Delete this video and its clips"
            className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {remove.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          </button>
        </ConfirmAction>
      </div>
      {moving ? (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(job.progress, 6)}%` }} />
        </div>
      ) : null}
      {job.status === "COMPLETED" && job.error ? <p className="mt-2 text-xs text-muted-foreground">{job.error}</p> : null}
      {job.status === "WAITING" ? (
        <Button size="sm" className="mt-2 min-h-10 w-full" onClick={() => onAsk("Turn this video into short clips.")}>Make clips</Button>
      ) : null}
      {job.clips.length > 0 ? (
        <div className={`mt-3 grid grid-cols-2 gap-x-2.5 gap-y-4 ${wide ? "sm:grid-cols-3 xl:grid-cols-5" : ""}`}>
          {job.clips.map((clip) => <ClipCard key={clip.id} clip={clip} onAsk={onAsk} />)}
        </div>
      ) : null}
    </article>
  );
}

function ClipCard({ clip, onAsk }: { clip: Clip; onAsk: (text: string) => void }) {
  const qc = useQueryClient();
  const renderFn = useServerFn(renderVideoClip);
  const [open, setOpen] = useState(false);
  const render = useMutation({
    mutationFn: () => renderFn({ data: { clipId: clip.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-clips"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That clip couldn't be rendered."),
  });
  const ready = Boolean(clip.status === "READY" && clip.video_url);
  const title = clip.title ?? "Clip";
  const caption = () => onAsk(`Write a caption for the clip called "${title.slice(0, 120)}".`);
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => setOpen(true)} aria-label={`Open ${title}`} className="group relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-primary/10 ring-primary/40 transition hover:ring-2">
        {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" /> : null}
        {ready ? <span className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition group-hover:scale-110"><Play className="size-4" aria-hidden="true" /></span></span> : null}
        {clip.status === "EXPORTING" ? <span className="absolute inset-0 grid place-items-center bg-black/30 text-xs font-medium text-white"><Loader2 className="size-5 animate-spin" aria-label="Rendering" /></span> : null}
      </button>
      <button type="button" onClick={() => setOpen(true)} className="mt-1.5 line-clamp-2 text-left text-xs font-medium hover:text-primary">{title}</button>
      <div className="mt-1.5 space-y-1">
        {ready ? (
          <>
            <Button asChild size="sm" className="min-h-9 w-full text-xs">
              <Link to="/social" search={{ platform: "youtube", clip: clip.id, clipTitle: title.slice(0, 100) }}><Send className="size-3" aria-hidden="true" />Post</Link>
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="min-h-9 flex-1 px-1 text-xs" onClick={caption}>Caption</Button>
              <Button asChild size="icon" variant="outline" className="size-9 shrink-0"><a href={clip.video_url ?? undefined} download aria-label={`Download ${title}`}><Download className="size-3.5" aria-hidden="true" /></a></Button>
            </div>
          </>
        ) : clip.status === "FOUND" || clip.status === "FAILED" ? (
          <Button size="sm" variant="outline" className="min-h-9 w-full text-xs" disabled={render.isPending} onClick={() => render.mutate()}>{clip.status === "FAILED" ? "Try again" : "Make video"}</Button>
        ) : null}
      </div>
      {open ? <ClipPanel clip={clip} ready={ready} onClose={() => setOpen(false)} onCaption={() => { setOpen(false); caption(); }} onRender={() => render.mutate()} rendering={render.isPending} /> : null}
    </div>
  );
}

const clock = (ms: number | null) => {
  if (ms === null) return null;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** One clip, opened large: watch it, rename it, caption, post, download or make it again. */
function ClipPanel({ clip, ready, onClose, onCaption, onRender, rendering }: { clip: Clip; ready: boolean; onClose: () => void; onCaption: () => void; onRender: () => void; rendering: boolean }) {
  const qc = useQueryClient();
  const renameFn = useServerFn(renameVideoClip);
  const [title, setTitle] = useState(clip.title ?? "");
  const saved = (clip.title ?? "") === title.trim();
  const rename = useMutation({
    mutationFn: () => renameFn({ data: { clipId: clip.id, title } }),
    onSuccess: async (r) => { setTitle(r.title); await qc.invalidateQueries({ queryKey: ["video-clips"] }); toast.success("Clip renamed."); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "That clip couldn't be renamed."),
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const start = clock(clip.start_ms);
  const end = clock(clip.end_ms);
  const length = clock(clip.duration_ms ?? (clip.start_ms !== null && clip.end_ms !== null ? clip.end_ms - clip.start_ms : null));
  const name = title.trim() || "Clip";
  return (
    <Portal>
      <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/60 p-3 sm:grid sm:place-items-center sm:p-6" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-label={name} onClick={(e) => e.stopPropagation()} className="relative mx-auto flex w-full max-w-3xl flex-col gap-5 rounded-3xl border border-white/70 bg-background p-4 shadow-2xl sm:flex-row sm:p-5">
          <button type="button" onClick={onClose} aria-label="Close clip" className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-background/80 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="size-4" aria-hidden="true" /></button>
          <div className="mx-auto w-full max-w-[17rem] shrink-0">
            {ready && clip.video_url ? (
              <video src={clip.video_url} controls autoPlay playsInline poster={clip.thumbnail_url ?? undefined} className="aspect-[9/16] w-full rounded-2xl bg-black object-contain" />
            ) : (
              <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-primary/10">
                {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" className="size-full object-cover" /> : null}
                <span className="absolute inset-x-3 bottom-3 rounded-xl bg-black/55 p-2 text-center text-xs text-white">{clip.status === "EXPORTING" ? "Making the video…" : clip.status === "FAILED" ? (clip.error ?? "This clip couldn't be made.") : "Not made into a video yet."}</span>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 sm:pt-8">
            <form onSubmit={(e) => { e.preventDefault(); if (!saved && title.trim()) rename.mutate(); }}>
              <label htmlFor={`clip-title-${clip.id}`} className="text-xs font-medium text-muted-foreground">Title</label>
              <div className="mt-1 flex gap-2">
                <input id={`clip-title-${clip.id}`} value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} className="min-h-10 min-w-0 flex-1 rounded-xl border border-input bg-white/70 px-3 text-base outline-none focus:ring-2 focus:ring-primary/40 sm:text-sm" />
                <Button type="submit" size="sm" variant="outline" className="min-h-10" disabled={saved || !title.trim() || rename.isPending}>{rename.isPending ? "Saving…" : "Save"}</Button>
              </div>
            </form>
            {start || length ? (
              <p className="text-xs text-muted-foreground">{start && end ? `From ${start} to ${end} of the original` : null}{start && end && length ? " · " : null}{length ? `${length} long` : null}</p>
            ) : null}
            {clip.reason ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Why Co-Work picked it</p>
                <p className="mt-1 text-sm leading-relaxed">{clip.reason}</p>
              </div>
            ) : null}
            <div className="mt-auto grid gap-2 sm:grid-cols-2">
              {ready ? (
                <>
                  <Button asChild className="min-h-11 sm:col-span-2">
                    <Link to="/social" search={{ platform: "youtube", clip: clip.id, clipTitle: name.slice(0, 100) }}><Send className="size-4" aria-hidden="true" />Post this clip</Link>
                  </Button>
                  <Button variant="outline" className="min-h-11" onClick={onCaption}><PenLine className="size-4" aria-hidden="true" />Write a caption</Button>
                  <Button asChild variant="outline" className="min-h-11"><a href={clip.video_url ?? undefined} download><Download className="size-4" aria-hidden="true" />Download</a></Button>
                </>
              ) : clip.status === "FOUND" || clip.status === "FAILED" ? (
                <Button className="min-h-11 sm:col-span-2" disabled={rendering} onClick={onRender}>{clip.status === "FAILED" ? "Try again" : "Make video"}</Button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
