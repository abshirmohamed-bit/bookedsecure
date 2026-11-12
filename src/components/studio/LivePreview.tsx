import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanBox, ShotPlan } from "@/lib/video-clips.server";
import type { CaptionLine, VideoAspect } from "@/lib/video-clips";

const ASPECT: Record<VideoAspect, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };

/** Where a fill shot's crop is at `ms`: its window, slid along its pan. */
export function cropAt(shot: ShotPlan["shots"][number], ms: number): PlanBox | null {
  const win = shot.window;
  if (!win) return null;
  const pan = shot.pan;
  if (!pan.length) return win;
  if (ms <= pan[0]![0]) return { ...win, x: pan[0]![1] };
  for (let i = 1; i < pan.length; i++) {
    const [t1, x1] = pan[i]!;
    const [t0, x0] = pan[i - 1]!;
    if (ms <= t1) return { ...win, x: x0 + ((x1 - x0) * (ms - t0)) / Math.max(1, t1 - t0) };
  }
  return { ...win, x: pan[pan.length - 1]![1] };
}

/** A centred crop of the source in the output's shape, for before the shot plan arrives. */
export function centreCrop(src: { w: number; h: number }, aspect: VideoAspect): PlanBox {
  const ratio = ASPECT[aspect];
  const w = Math.min(src.w, src.h * ratio);
  const h = Math.min(src.h, w / ratio);
  return { x: (src.w - w) / 2, y: (src.h - h) / 2, w, h };
}

/**
 * The clip as it will look, played straight from its source video in the
 * browser: the current trim on a loop, each shot cropped where the Engine
 * frames it, and the captions and headline drawn over it. Nothing is rendered
 * or saved, so every change shows the moment it is made.
 */
export function LivePreview({
  src, offsetMs, start, end, clipStart, aspect, plan, lines, lineTexts, captions, headline, poster,
}: {
  src: string;
  /** Where the source's time 0 sits on the original video's timeline. */
  offsetMs: number;
  /** The clip being previewed, on the original timeline. */
  start: number; end: number;
  /** The saved clip's start: caption and shot times count from here. */
  clipStart: number;
  aspect: VideoAspect;
  plan: ShotPlan | null;
  lines: CaptionLine[];
  lineTexts: Record<number, string>;
  captions: { on: boolean; className: string; highlight: boolean; position: string; size: number };
  headline: { on: boolean; text: string; position: string };
  poster?: string | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setFrame({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new trim starts the loop again from its first frame.
  useEffect(() => {
    const v = video.current;
    if (v && v.readyState >= 1) v.currentTime = Math.max(0, (start - offsetMs) / 1000);
    setNow(start);
  }, [start, offsetMs]);

  // Follow the video while it plays, looping inside the trim.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        const t = offsetMs + v.currentTime * 1000;
        if (t >= end || t < start - 1000) v.currentTime = Math.max(0, (start - offsetMs) / 1000);
        setNow(Math.min(Math.max(t, start), end));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, start, end, offsetMs]);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) { void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false)); }
    else { v.pause(); setPlaying(false); }
  };

  const rel = now - clipStart;
  const source = plan?.source && plan.source.w > 0 ? plan.source : natural;
  const shot = plan?.shots.find((s) => rel >= s.start_ms && rel < s.end_ms) ?? plan?.shots[plan.shots.length - 1] ?? null;
  const contain = shot ? ["fit", "bars", "screen", "feed"].includes(shot.kind) : false;
  const crop = useMemo(() => {
    if (!source.w || !source.h || contain) return null;
    const fromPlan = shot ? (cropAt(shot, rel) ?? shot.main ?? shot.cells[0] ?? null) : null;
    return fromPlan ?? centreCrop(source, aspect);
  }, [source, contain, shot, rel, aspect]);

  // Size the whole source so the crop fills the frame.
  const style = crop && frame.w
    ? (() => {
      const scale = Math.max(frame.w / crop.w, frame.h / crop.h);
      return { width: source.w * scale, height: source.h * scale, left: -crop.x * scale + (frame.w - crop.w * scale) / 2, top: -crop.y * scale + (frame.h - crop.h * scale) / 2 };
    })()
    : null;

  const line = lines.find((l) => rel >= l.start_ms && rel <= l.end_ms + 150);
  const edited = line ? lineTexts[line.start_ms] : undefined;
  const fontRem = 1.3 * captions.size * (frame.w ? Math.min(1.25, Math.max(0.6, frame.w / 352)) : 1);
  const headlineTop = headline.position !== "bottom";

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-black">
      {failed ? (
        poster ? <img src={poster} alt="" className="size-full object-cover" /> : null
      ) : (
        <video
          ref={video} src={src} muted={muted} playsInline preload="auto" poster={poster}
          onLoadedMetadata={(e) => {
            setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
            e.currentTarget.currentTime = Math.max(0, (start - offsetMs) / 1000);
          }}
          onError={() => setFailed(true)}
          className={style ? "absolute max-w-none" : "size-full object-contain"}
          style={style ?? undefined}
        />
      )}

      {headline.on && headline.text.trim() ? (
        <div className={`pointer-events-none absolute inset-x-3 flex justify-center ${headlineTop ? "top-[7%]" : "bottom-[7%]"}`}>
          <span className="max-w-full rounded-lg bg-white px-3 py-1.5 text-center text-[0.95rem] font-black leading-tight text-black shadow-lg">{headline.text}</span>
        </div>
      ) : null}

      {captions.on && line ? (
        <div className={`pointer-events-none absolute inset-x-4 flex justify-center text-center ${captions.position === "top" ? "top-[16%]" : captions.position === "lower" ? "bottom-[12%]" : "top-1/2 -translate-y-1/2"}`}>
          <span className={captions.className} style={{ fontSize: `${fontRem}rem`, lineHeight: 1.15 }}>
            {edited !== undefined || !captions.highlight
              ? (edited ?? line.text)
              : line.words.map((w, i) => (
                <span key={i} className={rel >= w.start_ms && rel < w.end_ms ? "text-[#FFD60A]" : undefined}>{i ? " " : ""}{w.text.trim()}</span>
              ))}
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause preview" : "Play preview"} className="grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70">
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70">
          {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
          <div className="h-full bg-white" style={{ width: `${Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100))}%` }} />
        </div>
        <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">Live preview</span>
      </div>
    </div>
  );
}
