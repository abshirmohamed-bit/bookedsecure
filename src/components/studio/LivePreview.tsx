import { GripHorizontal, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { PlanBox, ShotPlan } from "@/lib/video-clips.server";
import type { CaptionLine, ClipLayout, VideoAspect } from "@/lib/video-clips";

const ASPECT: Record<VideoAspect, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };
/** Layouts the browser draws on its own, without the Engine's shot plan. */
const WHOLE_PICTURE: readonly ClipLayout[] = ["streamer", "black-box", "title-subtitles"];
/** Where the preset caption positions sit, as a share of the frame from the top. */
export const PRESET_Y: Record<string, number> = { top: 0.2, middle: 0.5, lower: 0.82 };

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

/** CSS for the source video so `crop` (in source pixels) covers a frame of `frame` pixels. */
function coverStyle(crop: PlanBox, source: { w: number; h: number }, frame: { w: number; h: number }) {
  const scale = Math.max(frame.w / crop.w, frame.h / crop.h);
  return {
    width: source.w * scale, height: source.h * scale,
    left: -crop.x * scale + (frame.w - crop.w * scale) / 2, top: -crop.y * scale + (frame.h - crop.h * scale) / 2,
  };
}

/**
 * The clip as it will look, played straight from its source video in the
 * browser: the trim on a loop, each shot cropped where the Engine frames it
 * (or drawn whole for the picture-only layouts, with no plan needed), and the
 * captions and headline over it. Captions can be dragged to any height.
 * Nothing is rendered or saved, so every change shows on the next frame.
 */
export function LivePreview({
  src, offsetMs, start, end, clipStart, aspect, layout, plan, lines, lineTexts, captions, headline, poster,
  scrubMs, timeRef, onCaptionY,
}: {
  src: string;
  /** Where the source's time 0 sits on the original video's timeline. */
  offsetMs: number;
  /** The clip being previewed, on the original timeline. */
  start: number; end: number;
  /** The saved clip's start: caption and shot times count from here. */
  clipStart: number;
  aspect: VideoAspect;
  layout: ClipLayout;
  plan: ShotPlan | null;
  lines: CaptionLine[];
  lineTexts: Record<number, string>;
  captions: { on: boolean; className: string; highlight: boolean; position: string; size: number; y: number | null };
  headline: { on: boolean; text: string; position: string };
  poster?: string | undefined;
  /** While a trim handle is dragged: show this moment instead of playing. */
  scrubMs?: number | null | undefined;
  /** Written every frame with the time on the original timeline, for the timeline's playhead. */
  timeRef?: MutableRefObject<number> | undefined;
  /** A caption dragged to a new height (0 top .. 1 bottom), when the drag ends. */
  onCaptionY?: ((y: number) => void) | undefined;
}) {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  /** The second person of a split shot: a muted copy kept in step with the first. */
  const twin = useRef<HTMLVideoElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const wasPlaying = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setFrame({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Seeking is the slow part of a scrub: at most one per frame, always the latest asked for.
  const seekTarget = useRef<number | null>(null);
  const seekFrame = useRef(0);
  const seekTo = (ms: number) => {
    seekTarget.current = ms;
    if (seekFrame.current) return;
    seekFrame.current = requestAnimationFrame(() => {
      seekFrame.current = 0;
      const v = video.current;
      const t = seekTarget.current;
      if (v && t !== null && v.readyState >= 1) v.currentTime = Math.max(0, (t - offsetMs) / 1000);
      if (twin.current && t !== null && twin.current.readyState >= 1) twin.current.currentTime = Math.max(0, (t - offsetMs) / 1000);
      if (t !== null) { setNow(t); if (timeRef) timeRef.current = t; }
    });
  };
  useEffect(() => () => cancelAnimationFrame(seekFrame.current), []);

  // A new trim starts the loop again from its first frame (once the drag is over).
  useEffect(() => { if (scrubMs == null) seekTo(start); }, [start, offsetMs]);

  // Dragging a trim handle shows that moment; letting go plays on from the start.
  useEffect(() => {
    const v = video.current;
    if (scrubMs != null) {
      if (v && !v.paused) { wasPlaying.current = true; v.pause(); setPlaying(false); }
      seekTo(scrubMs);
    } else if (wasPlaying.current && v) {
      wasPlaying.current = false;
      seekTo(start);
      void v.play().then(() => setPlaying(true)).catch(() => undefined);
    }
  }, [scrubMs]);

  // Follow the video while it plays, looping inside the trim.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        const t = offsetMs + v.currentTime * 1000;
        if (t >= end || t < start - 1000) v.currentTime = Math.max(0, (start - offsetMs) / 1000);
        const w = twin.current;
        if (w) {
          if (Math.abs(w.currentTime - v.currentTime) > 0.2) w.currentTime = v.currentTime;
          if (w.paused) void w.play().catch(() => undefined);
        }
        const shown = Math.min(Math.max(t, start), end);
        setNow(shown);
        if (timeRef) timeRef.current = shown;
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
    else { v.pause(); twin.current?.pause(); setPlaying(false); }
  };

  const rel = now - clipStart;
  const source = plan?.source && plan.source.w > 0 ? plan.source : natural;
  const whole = WHOLE_PICTURE.includes(layout);
  const shot = whole ? null : (plan?.shots.find((s) => rel >= s.start_ms && rel < s.end_ms) ?? plan?.shots[plan.shots.length - 1] ?? null);
  const contain = whole || (shot ? ["fit", "bars", "screen", "feed"].includes(shot.kind) : false);
  const split = !whole && shot?.kind === "split" && shot.cells.length >= 2 ? shot.cells.slice(0, 2) : null;
  const crop = useMemo(() => {
    if (!source.w || !source.h || contain || split) return null;
    const fromPlan = shot ? (cropAt(shot, rel) ?? shot.main ?? shot.cells[0] ?? null) : null;
    return fromPlan ?? centreCrop(source, aspect);
  }, [source, contain, split, shot, rel, aspect]);
  const half = { w: frame.w, h: frame.h / 2 };
  const style = split && frame.w && source.w ? coverStyle(split[0]!, source, half) : crop && frame.w ? coverStyle(crop, source, frame) : null;

  const line = lines.find((l) => rel >= l.start_ms && rel <= l.end_ms + 150);
  const edited = line ? lineTexts[line.start_ms] : undefined;
  const fontRem = 1.3 * captions.size * (frame.w ? Math.min(1.25, Math.max(0.6, frame.w / 352)) : 1);
  const headlineTop = headline.position !== "bottom";
  const y = dragY ?? captions.y ?? PRESET_Y[captions.position] ?? 0.5;

  const dragCaption = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onCaptionY || !box.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = box.current.getBoundingClientRect();
    const at = (clientY: number) => Math.min(0.95, Math.max(0.05, (clientY - rect.top) / rect.height));
    setDragY(at(e.clientY));
    const target = e.currentTarget;
    const move = (ev: PointerEvent) => setDragY(at(ev.clientY));
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      const final = at(ev.clientY);
      setDragY(null);
      onCaptionY(Math.round(final * 1000) / 1000);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const videoEl = (
    <video
      ref={video} src={src} muted={muted} playsInline preload="auto" poster={poster}
      onLoadedMetadata={(e) => {
        setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight });
        e.currentTarget.currentTime = Math.max(0, (start - offsetMs) / 1000);
      }}
      onError={() => setFailed(true)}
      className={style ? "absolute max-w-none transition-[left,top,width,height] duration-150 ease-out" : layout === "title-subtitles" ? "absolute inset-x-0 top-1/2 w-full -translate-y-1/2 object-contain" : "absolute inset-0 size-full object-contain"}
      style={style ?? undefined}
    />
  );

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-black">
      {/* the picture-only layouts, drawn here without waiting for the Engine */}
      {layout === "streamer" && poster ? <img src={poster} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover opacity-80 blur-xl" /> : null}
      <div key={layout} className="absolute inset-0 animate-in fade-in duration-200">
        {failed ? (poster ? <img src={poster} alt="" className="size-full object-cover" /> : null)
          : split ? <div className="absolute inset-x-0 top-0 h-1/2 overflow-hidden">{videoEl}</div> : videoEl}
        {split && !failed && frame.w && source.w ? (
          <div className="absolute inset-x-0 bottom-0 h-1/2 overflow-hidden border-t-2 border-white/70">
            <video ref={twin} src={src} muted playsInline preload="auto" aria-hidden="true" className="absolute max-w-none"
              style={coverStyle(split[1]!, source, half)}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = video.current?.currentTime ?? Math.max(0, (start - offsetMs) / 1000); }} />
          </div>
        ) : null}
      </div>

      {headline.on && headline.text.trim() ? (
        <div className={`pointer-events-none absolute inset-x-3 flex justify-center ${headlineTop ? "top-[7%]" : "bottom-[7%]"}`}>
          <span className="max-w-full rounded-lg bg-white px-3 py-1.5 text-center text-[0.95rem] font-black leading-tight text-black shadow-lg">{headline.text}</span>
        </div>
      ) : null}

      {captions.on ? (
        <div
          onPointerDown={dragCaption}
          title={onCaptionY ? "Drag to move the captions" : undefined}
          className={`group/cap absolute inset-x-3 flex -translate-y-1/2 touch-none select-none justify-center text-center ${onCaptionY ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"} ${dragY !== null ? "" : "transition-[top] duration-150"}`}
          style={{ top: `${y * 100}%` }}
        >
          <span className={`relative rounded-md px-1 ring-white/70 ${dragY !== null ? "ring-2" : "group-hover/cap:ring-1"}`}>
            <span className={captions.className} style={{ fontSize: `${fontRem}rem`, lineHeight: 1.15 }}>
              {!line ? <span className="opacity-60">Captions</span>
                : edited !== undefined || !captions.highlight
                  ? (edited ?? line.text)
                  : line.words.map((w, i) => (
                    <span key={i} className={rel >= w.start_ms && rel < w.end_ms ? "text-[#FFD60A]" : undefined}>{i ? " " : ""}{w.text.trim()}</span>
                  ))}
            </span>
            {onCaptionY ? (
              <span className={`absolute -top-5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white ${dragY !== null ? "opacity-100" : "opacity-0 group-hover/cap:opacity-100"} transition-opacity`}>
                <GripHorizontal className="size-3" aria-hidden="true" />{dragY !== null ? `${Math.round(dragY * 100)}%` : "Drag"}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
        <button type="button" onClick={toggle} aria-label={playing ? "Pause preview" : "Play preview"} className="grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:scale-105 hover:bg-black/70 active:scale-95">
          {playing ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Turn sound on" : "Turn sound off"} className="grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:scale-105 hover:bg-black/70 active:scale-95">
          {muted ? <VolumeX className="size-4" aria-hidden="true" /> : <Volume2 className="size-4" aria-hidden="true" />}
        </button>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
          <div className="h-full bg-white" style={{ width: `${Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100))}%` }} />
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
          <span className={`size-1.5 rounded-full ${playing ? "animate-pulse bg-red-500" : "bg-white/60"}`} aria-hidden="true" />Live
        </span>
      </div>
    </div>
  );
}
