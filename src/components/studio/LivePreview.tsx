import { GripHorizontal, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { PlanBox, ShotPlan } from "@/lib/video-clips.server";
import { cropAt, shotAt, TRANSITION_MS } from "@/lib/clip-motion";
import { duoCards, glassCard, LOOK, pipBox, presenterCards, quadCards, spotlightCards } from "@/lib/clip-looks";
import type { CaptionLine, ClipLayout, VideoAspect } from "@/lib/video-clips";

const ASPECT: Record<VideoAspect, number> = { "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9 };
/** Layouts the browser draws on its own, without the Engine's shot plan. */
const WHOLE_PICTURE: readonly ClipLayout[] = ["streamer", "black-box", "title-subtitles"];
/** Where the preset caption positions sit, as a share of the frame from the top. */
export const PRESET_Y: Record<string, number> = { top: 0.2, middle: 0.5, lower: 0.82 };

export { cropAt };

/** The preview's take on each Engine transition, played on the incoming picture. */
const TRANSITION_FRAMES: Record<string, Keyframe[]> = {
  fade: [{ opacity: 0.25 }, { opacity: 1 }],
  zoomin: [{ transform: "scale(1.14)", opacity: 0.35 }, { transform: "scale(1)", opacity: 1 }],
  smoothup: [{ transform: "translateY(22%)", opacity: 0.4 }, { transform: "translateY(0)", opacity: 1 }],
  circleopen: [{ clipPath: "circle(8% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)" }],
  circleclose: [{ clipPath: "circle(75% at 50% 50%)", opacity: 0.5 }, { clipPath: "circle(75% at 50% 50%)", opacity: 1 }],
};

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
  const twins = useRef<(HTMLVideoElement | null)[]>([]);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [now, setNow] = useState(start);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dragY, setDragY] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const wasPlaying = useRef(false);
  /** The picture, animated when the composition changes the way the Engine transitions it. */
  const picture = useRef<HTMLDivElement>(null);
  const lastShot = useRef<number>(-1);

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
      if (t !== null) for (const w of twins.current) if (w && w.readyState >= 1) w.currentTime = Math.max(0, (t - offsetMs) / 1000);
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
        for (const w of twins.current) {
          if (!w) continue;
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
    else { v.pause(); for (const w of twins.current) w?.pause(); setPlaying(false); }
  };

  const rel = now - clipStart;
  const source = plan?.source && plan.source.w > 0 ? plan.source : natural;
  const whole = WHOLE_PICTURE.includes(layout);
  const shot = whole ? null : shotAt(plan?.shots ?? [], rel);
  const moving = Boolean(shot?.motion?.length);
  const contain = whole || (shot ? ["fit", "bars", "feed"].includes(shot.kind) || (shot.kind === "screen" && !shot.main) : false);
  const split = !whole && shot?.kind === "split" && shot.cells.length >= 2 ? shot.cells.slice(0, 2) : null;
  const crop = useMemo(() => {
    if (!source.w || !source.h || contain || split) return null;
    const fromPlan = shot ? (cropAt(shot, rel) ?? shot.main ?? shot.cells[0] ?? null) : null;
    return fromPlan ?? centreCrop(source, aspect);
  }, [source, contain, split, shot, rel, aspect]);
  // The finishing looks (lib/clip-looks, the Engine's looks.py): ambient glass
  // for whole-picture shots, cinema bars, duo cards for two people.
  const glass = !failed && (layout === "streamer" || layout === "title-subtitles" || (!whole && (shot?.kind === "fit" || shot?.kind === "headline")));
  const cinema = !failed && (layout === "black-box" || (!whole && shot?.kind === "bars"));
  const duo = split && frame.h >= frame.w && frame.w ? duoCards(frame.w, frame.h) : null;
  const half = duo ? { w: duo[0].w, h: duo[0].h } : { w: frame.w, h: frame.h / 2 };
  // Every multi-picture composition as cards, the same shapes as the Engine and
  // the browser render: duo (2), spotlight (3), 2 x 2 (4) and presenter.
  type Card = { box: { x: number; y: number; w: number; h: number }; crop: PlanBox };
  const cards: Card[] | null = (() => {
    if (whole || failed || !shot || !frame.w || !source.w || frame.h < frame.w) return null;
    if (duo && split) return duo.map((b, i) => ({ box: b, crop: split[i]! }));
    if (shot.kind === "grid" && (shot.cells.length === 3 || shot.cells.length >= 4)) {
      const spots = shot.cells.length === 3 ? spotlightCards(frame.w, frame.h) : quadCards(frame.w, frame.h);
      return spots.map((b, i) => ({ box: b, crop: shot.cells[i]! }));
    }
    if (shot.kind === "screen" && shot.main) {
      const top = Math.min(frame.h * 0.5, (frame.w * source.h) / source.w);
      const [scr, spk] = presenterCards(frame.w, frame.h, top);
      return [{ box: scr, crop: { x: 0, y: 0, w: source.w, h: source.h } }, { box: spk, crop: shot.main }];
    }
    return null;
  })();
  const bubble: Card | null = !whole && !failed && shot?.kind === "pip" && shot.inset && frame.w ? { box: pipBox(frame.w, frame.h), crop: shot.inset } : null;
  // The shot plan knows the picture's size before the video file does, so the card
  // appears at once (it waited ~2 s for the file's metadata); 16:9 until either knows.
  const picSize = source.w ? source : { w: 16, h: 9 };
  const glassBox = glass && frame.w ? glassCard(frame.w, frame.h, picSize.w, picSize.h) : null;
  const cardStyle = (b: { x: number; y: number; w: number; h: number }) => ({
    left: b.x, top: b.y, width: b.w, height: b.h, borderRadius: frame.w * LOOK.radius,
    boxShadow: `0 ${frame.w * LOOK.shadowDrop}px ${frame.w * LOOK.shadowBlur * 2}px rgba(0,0,0,${LOOK.shadowAlpha})`,
  });

  // A new layout fades in (the video itself keeps playing).
  useEffect(() => {
    const el = picture.current;
    if (el && typeof el.animate === "function") el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
  }, [layout]);

  // A change of composition plays the Engine's 6-frame transition; camera cuts stay cuts.
  const shotIndex = shot && plan ? plan.shots.indexOf(shot) : -1;
  useEffect(() => {
    const prev = lastShot.current;
    lastShot.current = shotIndex;
    const el = picture.current;
    if (!el || !playing || shotIndex !== prev + 1 || !shot?.transition || typeof el.animate !== "function") return;
    el.animate(TRANSITION_FRAMES[shot.transition] ?? TRANSITION_FRAMES["fade"]!, { duration: TRANSITION_MS, easing: "cubic-bezier(.65,0,.35,1)" });
  }, [shotIndex]);
  const style = cards ? coverStyle(cards[0]!.crop, source, cards[0]!.box)
    : split && frame.w && source.w ? coverStyle(split[0]!, source, half) : crop && frame.w ? coverStyle(crop, source, frame) : null;

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
      // The button follows the video itself (a stall, the end of the file, the browser pausing it).
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={(e) => { e.currentTarget.currentTime = Math.max(0, (start - offsetMs) / 1000); void e.currentTarget.play().catch(() => setPlaying(false)); }}
      onWaiting={() => setBuffering(true)}
      onPlaying={() => setBuffering(false)}
      onCanPlay={() => setBuffering(false)}
      className={glassBox ? "absolute inset-0 size-full object-cover" : style ? `absolute max-w-none ${moving ? "" : "transition-[left,top,width,height] duration-150 ease-out"}` : layout === "title-subtitles" ? "absolute inset-x-0 top-1/2 w-full -translate-y-1/2 object-contain" : "absolute inset-0 size-full object-contain"}
      style={glassBox ? undefined : style ?? undefined}
    />
  );

  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-black">
      {/* the picture-only layouts, drawn here without waiting for the Engine */}
      {(glass || cinema || duo || cards) && poster ? (
        <img src={poster} alt="" aria-hidden="true" className="absolute inset-0 size-full scale-110 object-cover blur-xl"
          style={{ filter: `blur(24px) saturate(${LOOK.ambientSaturation}) brightness(${cinema ? LOOK.cinemaBrightness : LOOK.ambientBrightness})` }} />
      ) : null}
      {cinema ? <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,.55) 100%)" }} /> : null}
      <div ref={picture} className="absolute inset-0">
        {failed && poster ? <img src={poster} alt="" className="absolute inset-0 size-full object-cover" /> : null}
        {/* One wrapper whose shape changes with the shot, so the video element is never
            recreated (a recreated video starts paused, and playback stopped at the first
            change of layout). */}
        <div className={failed ? "hidden" : "absolute overflow-hidden"}
          style={glassBox ? cardStyle(glassBox) : cards ? cardStyle(cards[0]!.box)
            : split ? { left: 0, top: 0, width: "100%", height: "50%" } : { left: 0, top: 0, width: "100%", height: "100%" }}>
          {videoEl}
        </div>
        {/* the other pictures of the composition: muted copies kept in step with the main video */}
        {[...(cards ? cards.slice(1) : split && !failed && frame.w && source.w ? [{ box: { x: 0, y: frame.h / 2, w: frame.w, h: frame.h / 2 }, crop: split[1]! }] : []), ...(bubble ? [bubble] : [])].map((c, i) => (
          <div key={`twin-${i}`} className={cards || bubble ? "absolute overflow-hidden" : "absolute overflow-hidden border-t-2 border-white/70"}
            style={cards || bubble ? cardStyle(c.box) : { left: c.box.x, top: c.box.y, width: c.box.w, height: c.box.h }}>
            <video ref={(el) => { twins.current[i] = el; }} src={src} muted playsInline preload="auto" aria-hidden="true" className="absolute max-w-none"
              style={source.w ? coverStyle(c.crop, source, c.box) : undefined}
              onLoadedMetadata={(e) => { e.currentTarget.currentTime = video.current?.currentTime ?? Math.max(0, (start - offsetMs) / 1000); }} />
          </div>
        ))}
      </div>

      {layout === "title-subtitles" && end > start ? (
        <div aria-hidden="true" className="pointer-events-none absolute left-0"
          style={{ bottom: `${LOOK.progress.lift * 100}%`, height: Math.max(3, frame.h * LOOK.progress.height), width: `${Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100))}%`, background: `rgba(255,255,255,${LOOK.progress.alpha})` }} />
      ) : null}
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
        {buffering && playing ? <span className="mr-1 size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" role="status" aria-label="Loading the video" /> : null}
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
