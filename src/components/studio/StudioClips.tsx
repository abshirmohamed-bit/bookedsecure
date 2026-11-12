import { useQuery } from "@tanstack/react-query";
import { ConfirmAction } from "@/components/ConfirmAction";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Clapperboard, Film, Loader2, Play, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { ClipEditor } from "@/components/studio/ClipEditor";
import { useDeleteVideoJobs, type Clip, type Job } from "@/components/social/SocialResults";
import { Button } from "@/components/ui/button";
import { isActiveJob, jobStatusLabel } from "@/lib/video-clips";
import { getVideoClips } from "@/lib/video-clips.functions";

type Status = "all" | "ready" | "waiting";
const STATUS: { id: Status; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ready", label: "Ready" },
  { id: "waiting", label: "Not made yet" },
];

const seconds = (ms: number | null) => (ms === null ? null : `${Math.floor(ms / 60000)}:${String(Math.round(ms / 1000) % 60).padStart(2, "0")}`);

/** Studio's library: every clip of the business, grouped by the video it came from. */
export function StudioClips({ clipId, videoId }: { clipId?: string | undefined; videoId?: string | undefined }) {
  const navigate = useNavigate();
  const clipsFn = useServerFn(getVideoClips);
  const clips = useQuery({
    queryKey: ["video-clips"],
    queryFn: () => clipsFn(),
    refetchInterval: (q) => ((q.state.data?.jobs ?? []).some((j) => isActiveJob(j.status) || j.clips.some((c) => c.status === "EXPORTING")) ? 5000 : 60_000),
  });
  const [status, setStatus] = useState<Status>("all");
  const [query, setQuery] = useState("");
  const jobs = useMemo(() => clips.data?.jobs ?? [], [clips.data]);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return jobs
      .filter((job) => !videoId || job.id === videoId)
      .map((job) => ({
        job,
        clips: job.clips.filter((c) =>
          (status === "all" || (status === "ready" ? c.status === "READY" : c.status !== "READY"))
          && (!words || `${c.title ?? ""} ${c.reason ?? ""} ${job.source_name}`.toLowerCase().includes(words))),
      }))
      .filter((g) => g.clips.length > 0 || (!words && status === "all"));
  }, [jobs, videoId, status, query]);

  const open = clipId ? jobs.flatMap((j) => j.clips.map((c) => ({ clip: c, job: j }))).find((x) => x.clip.id === clipId) : undefined;
  const setSearch = (next: { clip?: string | undefined; video?: string | undefined }) =>
    navigate({ to: "/studio", search: { tab: "clips", ...(next.video ? { video: next.video } : {}), ...(next.clip ? { clip: next.clip } : {}) }, replace: Boolean(next.clip === undefined && clipId) });
  const total = jobs.reduce((n, j) => n + j.clips.length, 0);
  const ready = jobs.reduce((n, j) => n + j.clips.filter((c) => c.status === "READY").length, 0);

  if (clips.isLoading) return <div className="glass grid place-items-center rounded-2xl p-12"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading clips" /></div>;
  if (clips.isError) return <div className="glass rounded-2xl p-6 text-sm text-destructive">Your clips couldn't be loaded. Refresh to try again.</div>;

  if (jobs.length === 0) {
    return (
      <div className="glass grid place-items-center gap-3 rounded-3xl p-12 text-center">
        <span className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Clapperboard className="size-5" aria-hidden="true" /></span>
        <p className="font-heading text-lg font-semibold">No clips yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">Give Co-Work a long video, or paste a link, and the best moments land here as short clips you can edit and post.</p>
        <Button asChild className="btn-glow min-h-11"><Link to="/assistant">Open Co-Work</Link></Button>
        {clips.data && !clips.data.configured ? <p className="text-xs text-muted-foreground">Video clipping isn't switched on for this workspace yet.</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <label className="relative min-w-[12rem] flex-1">
          <span className="sr-only">Search clips</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles and moments…" className="min-h-10 w-full rounded-xl border border-transparent bg-white/60 pl-9 pr-3 text-base outline-none focus:border-primary/40 sm:text-sm" />
        </label>
        <select aria-label="Video" value={videoId ?? ""} onChange={(e) => setSearch({ video: e.target.value || undefined })} className="min-h-10 max-w-[16rem] rounded-xl border border-transparent bg-white/60 px-3 text-sm outline-none focus:border-primary/40">
          <option value="">All videos ({jobs.length})</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.source_name.slice(0, 60)}</option>)}
        </select>
        <div className="inline-flex rounded-xl bg-white/50 p-0.5">
          {STATUS.map((s) => (
            <button key={s.id} type="button" onClick={() => setStatus(s.id)} className={`min-h-9 rounded-lg px-3 text-xs font-medium ${status === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{s.label}</button>
          ))}
        </div>
        <p className="px-2 text-xs text-muted-foreground">{ready} of {total} clips ready</p>
      </div>

      {shown.length === 0 ? <p className="glass rounded-2xl p-6 text-center text-sm text-muted-foreground">No clips match.</p> : null}

      {shown.map(({ job, clips: list }) => <VideoGroup key={job.id} job={job} clips={list} onOpen={(id) => setSearch({ video: videoId, clip: id })} />)}

      {open ? <ClipEditor clip={open.clip} job={open.job} onClose={() => setSearch({ video: videoId })} /> : null}
    </div>
  );
}

function VideoGroup({ job, clips, onOpen }: { job: Job; clips: Clip[]; onOpen: (clipId: string) => void }) {
  const remove = useDeleteVideoJobs();
  const moving = isActiveJob(job.status);
  return (
    <section className="glass rounded-3xl p-4">
      <header className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary/10 text-primary">
          {job.thumbnail_url ? <img src={job.thumbnail_url} alt="" className="size-full object-cover" /> : <Film className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{job.source_name}</h2>
          <p className={`text-xs ${job.status === "FAILED" ? "text-destructive" : "text-muted-foreground"}`}>
            {job.status === "FAILED" ? (job.error ?? jobStatusLabel(job)) : jobStatusLabel(job)}
            {job.duration_ms ? ` · ${seconds(job.duration_ms)} long` : ""}
            {job.clips.length ? ` · ${job.clips.length} clip${job.clips.length === 1 ? "" : "s"}` : ""}
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
      </header>
      {moving ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-primary/10" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.max(job.progress, 6)}%` }} />
        </div>
      ) : null}
      {clips.length > 0 ? (
        <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {clips.map((clip) => (
            <li key={clip.id} className="min-w-0">
              <button type="button" onClick={() => onOpen(clip.id)} className="group block w-full text-left" aria-label={`Open ${clip.title ?? "clip"}`}>
                <span className="relative block aspect-[9/16] overflow-hidden rounded-2xl bg-primary/10 ring-primary/40 transition group-hover:ring-2">
                  {clip.thumbnail_url ? <img src={clip.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" /> : null}
                  {clip.status === "READY" ? <span className="absolute inset-0 grid place-items-center"><span className="grid size-11 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition group-hover:scale-110"><Play className="size-4" aria-hidden="true" /></span></span> : null}
                  {clip.status === "EXPORTING" ? <span className="absolute inset-0 grid place-items-center bg-black/30"><Loader2 className="size-5 animate-spin text-white" aria-label="Rendering" /></span> : null}
                  <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
                    {clip.status === "READY" ? seconds(clip.duration_ms) ?? "Ready" : clip.status === "EXPORTING" ? "Making…" : clip.status === "FAILED" ? "Failed" : "Not made yet"}
                  </span>
                </span>
                <span className="mt-2 line-clamp-2 block text-[13px] font-medium group-hover:text-primary">{clip.title ?? "Clip"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : job.status === "COMPLETED" ? <p className="mt-3 text-xs text-muted-foreground">No clips came out of this video.</p> : null}
    </section>
  );
}
