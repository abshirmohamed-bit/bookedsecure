import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Download, Facebook, Film, Instagram, Linkedin, Loader2, MessageCircle, Play, Send, Sparkles, TriangleAlert, Youtube } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/Portal";
import { resultDayLabel } from "@/lib/social-cowork";
import { getLinkedIn } from "@/lib/linkedin.functions";
import { getSocialPosting } from "@/lib/social-posts.functions";
import { getYouTube } from "@/lib/youtube.functions";
import { listSocialComments } from "@/lib/social-comments.functions";
import { isActiveJob, jobStatusLabel } from "@/lib/video-clips";
import { getVideoClips, renderVideoClip } from "@/lib/video-clips.functions";

type Job = Awaited<ReturnType<typeof getVideoClips>>["jobs"][number];
type Clip = Job["clips"][number];

const ACCOUNTS = [
  { id: "facebook", label: "Facebook", icon: Facebook, color: "text-[#1877f2]" },
  { id: "instagram", label: "Instagram", icon: Instagram, color: "text-[#d62976]" },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin, color: "text-[#0a66c2]" },
  { id: "youtube", label: "YouTube", icon: Youtube, color: "text-[#ff0000]" },
] as const;

/** The connected accounts, each opening its hands-on tools. */
export function YourChannels() {
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
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
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
export function SocialResults({ onAsk }: { onAsk: (text: string) => void }) {
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
          {group.jobs.map((job) => <JobCard key={job.id} job={job} onAsk={onAsk} />)}
        </section>
      ))}

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

function JobCard({ job, onAsk }: { job: Job; onAsk: (text: string) => void }) {
  const moving = isActiveJob(job.status);
  return (
    <article className="glass overflow-hidden rounded-2xl p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary/10 text-primary">
          {job.thumbnail_url ? <img src={job.thumbnail_url} alt="" className="size-full object-cover" /> : <Film className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{job.source_name}</p>
          <p className={`text-xs ${job.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}>
            {job.status === "FAILED" ? (job.error ?? jobStatusLabel(job)) : jobStatusLabel(job)}
          </p>
        </div>
        {moving ? <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" /> : null}
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
        <div className="-mx-3 mt-3 flex snap-x gap-2 overflow-x-auto px-3 pb-1 cowork-scroll">
          {job.clips.map((clip) => <ClipCard key={clip.id} clip={clip} onAsk={onAsk} />)}
        </div>
      ) : null}
    </article>
  );
}

function ClipCard({ clip, onAsk }: { clip: Clip; onAsk: (text: string) => void }) {
  const qc = useQueryClient();
  const renderFn = useServerFn(renderVideoClip);
  const [watching, setWatching] = useState(false);
  const render = useMutation({
    mutationFn: () => renderFn({ data: { clipId: clip.id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["video-clips"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "That clip couldn't be rendered."),
  });
  const ready = clip.status === "READY" && clip.video_url;
  const title = clip.title ?? "Clip";
  return (
    <div className="w-36 shrink-0 snap-start">
      <button type="button" disabled={!ready} onClick={() => setWatching(true)} aria-label={ready ? `Watch ${title}` : title} className="relative block aspect-[9/16] w-full overflow-hidden rounded-xl bg-primary/10">
        {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" /> : null}
        {ready ? <span className="absolute inset-0 grid place-items-center"><span className="grid size-10 place-items-center rounded-full bg-black/45 text-white backdrop-blur"><Play className="size-4" aria-hidden="true" /></span></span> : null}
        {clip.status === "EXPORTING" ? <span className="absolute inset-0 grid place-items-center bg-black/30 text-xs font-medium text-white"><Loader2 className="size-5 animate-spin" aria-label="Rendering" /></span> : null}
      </button>
      <p className="mt-1.5 line-clamp-2 text-xs font-medium">{title}</p>
      <div className="mt-1.5 space-y-1">
        {ready ? (
          <>
            <Button asChild size="sm" className="min-h-9 w-full text-xs">
              <Link to="/social" search={{ platform: "youtube", clip: clip.id, clipTitle: title.slice(0, 100) }}><Send className="size-3" aria-hidden="true" />Post</Link>
            </Button>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="min-h-9 flex-1 px-1 text-xs" onClick={() => onAsk(`Write a caption for the clip called "${title.slice(0, 120)}".`)}>Caption</Button>
              <Button asChild size="icon" variant="outline" className="size-9 shrink-0"><a href={clip.video_url ?? undefined} download aria-label={`Download ${title}`}><Download className="size-3.5" aria-hidden="true" /></a></Button>
            </div>
          </>
        ) : clip.status === "FOUND" || clip.status === "FAILED" ? (
          <Button size="sm" variant="outline" className="min-h-9 w-full text-xs" disabled={render.isPending} onClick={() => render.mutate()}>{clip.status === "FAILED" ? "Try again" : "Make video"}</Button>
        ) : null}
      </div>
      {watching && clip.video_url ? (
        <Portal>
          <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[70] grid place-items-center bg-black/80 p-4" onClick={() => setWatching(false)}>
            <video src={clip.video_url} controls autoPlay playsInline poster={clip.thumbnail_url ?? undefined} className="max-h-[85dvh] max-w-full rounded-xl" onClick={(e) => e.stopPropagation()} />
            <Button variant="secondary" className="mt-3 min-h-11" onClick={() => setWatching(false)}>Close</Button>
          </div>
        </Portal>
      ) : null}
    </div>
  );
}
