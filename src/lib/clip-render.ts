/**
 * Makes a clip's MP4 in the browser: the source plays once, every frame is
 * composed on a canvas (the Engine's shot crops, the captions and the
 * headline), encoded to H.264 with WebCodecs, the audio to AAC, and both are
 * muxed into an MP4. Desktop Chrome and Edge can; anything else (or any
 * failure) saves through the Engine instead.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import * as MP4Box from "mp4box";
import { cropAt, shotAt, transitionAt, transitionLook, type MotionSample } from "@/lib/clip-motion";
import { duoCards, glassCard, LOOK, pipBox, presenterCards, quadCards, spotlightCards } from "@/lib/clip-looks";
import { groupCaptionLines, type CaptionLine, type CaptionWord, type VideoAspect } from "@/lib/video-clips";

export type PlanBox = { x: number; y: number; w: number; h: number };
export type RenderShot = { start_ms: number; end_ms: number; kind: string; window: PlanBox | null; pan: [number, number][]; cells: PlanBox[]; main: PlanBox | null; inset: PlanBox | null; motion?: MotionSample[]; transition?: string | null };
export type RenderPlan = { source: { w: number; h: number }; shots: RenderShot[] } | null;

export type RenderInput = {
  src: string;
  /** Where the source's time 0 sits on the original timeline. */
  offsetMs: number;
  /** The clip, on the original timeline. */
  startMs: number; endMs: number;
  aspect: VideoAspect;
  /** Shot times count from planStartMs (the clip's start when the plan was read). */
  plan: RenderPlan; planStartMs: number;
  /** Caption words, timed from startMs. */
  words: CaptionWord[];
  /** `y`: a dragged position, the line's centre as a share of the height from the top (wins over `position`). */
  captions: { on: boolean; styleId: string; position: string; size: number; y?: number | null };
  headline: { on: boolean; text: string; position: string };
};

const OUTPUT: Record<VideoAspect, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 }, "1:1": { w: 1080, h: 1080 }, "4:5": { w: 1080, h: 1350 }, "16:9": { w: 1920, h: 1080 },
};
const VIDEO_CODECS = ["avc1.640028", "avc1.4d0028", "avc1.42e028"];
const CONTAIN = new Set(["fit", "bars", "screen", "feed"]);

type Win = typeof globalThis & {
  MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<AudioData> };
};

/** A picture to draw from: the playing video, or a frame decoded straight from the file. */
type Pic = HTMLVideoElement | VideoFrame;
const pw = (v: Pic) => ("videoWidth" in v ? v.videoWidth : v.displayWidth);
const ph = (v: Pic) => ("videoHeight" in v ? v.videoHeight : v.displayHeight);

/** WebCodecs and the MP4 muxer both need a real duration for every output frame. */
export function videoFrameTiming(timestamp: number, fps: number): VideoFrameInit {
  return { timestamp: Math.round(timestamp), duration: Math.round(1_000_000 / fps) };
}

/** Whether this browser can make the video itself. */
export function canRenderInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined"
    && Boolean((window as Win).MediaStreamTrackProcessor) && "requestVideoFrameCallback" in HTMLVideoElement.prototype
    && typeof AudioContext !== "undefined";
}

function centreCrop(src: { w: number; h: number }, ratio: number): PlanBox {
  const w = Math.min(src.w, src.h * ratio);
  const h = Math.min(src.h, w / ratio);
  return { x: (src.w - w) / 2, y: (src.h - h) / 2, w, h };
}

/** Draws `box` of the source (in plan pixels) to cover the destination rectangle. */
function drawCover(ctx: CanvasRenderingContext2D, video: Pic, k: number, box: PlanBox, dx: number, dy: number, dw: number, dh: number) {
  const target = dw / dh;
  let { x, y, w, h } = box;
  if (w / h > target) { const nw = h * target; x += (w - nw) / 2; w = nw; } else { const nh = w / target; y += (h - nh) / 2; h = nh; }
  ctx.drawImage(video, x * k, y * k, w * k, h * k, dx, dy, dw, dh);
}

let ambientCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

/** The blurred, richer copy of the whole picture behind a card (drawn small, then scaled up: cheap). */
function drawAmbient(ctx: CanvasRenderingContext2D, video: Pic, W: number, H: number, brightness: number = LOOK.ambientBrightness) {
  const w = Math.max(2, Math.round(W / 4)), h = Math.max(2, Math.round(H / 4));
  if (!ambientCanvas || ambientCanvas.width !== w || ambientCanvas.height !== h) {
    ambientCanvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
  }
  const a = ambientCanvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!a) return;
  const vw = pw(video), vh = ph(video);
  const s = Math.max(w / vw, h / vh);
  a.filter = `blur(${Math.max(2, (LOOK.ambientBlur * W) / 4)}px) saturate(${LOOK.ambientSaturation}) brightness(${brightness})`;
  a.drawImage(video, (w - vw * s) / 2, (h - vh * s) / 2, vw * s, vh * s);
  a.filter = "none";
  ctx.drawImage(ambientCanvas as CanvasImageSource, 0, 0, W, H);
}

/** Draw `paint` inside a rounded card at `box`, with the looks' soft shadow under it. */
function drawCard(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, W: number, paint: () => void) {
  const r = W * LOOK.radius;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${LOOK.shadowAlpha})`;
  ctx.shadowBlur = W * LOOK.shadowBlur;
  ctx.shadowOffsetY = W * LOOK.shadowDrop;
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.x, box.y, box.w, box.h, r);
  ctx.clip();
  paint();
  ctx.restore();
}

function drawContain(ctx: CanvasRenderingContext2D, video: Pic, W: number, H: number) {
  const vw = pw(video), vh = ph(video);
  const s = Math.min(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
}

let layer: OffscreenCanvas | HTMLCanvasElement | null = null;

/** One composed frame: the shot's picture for this moment, mid-transition when the composition is changing. */
function drawPicture(ctx: CanvasRenderingContext2D, video: Pic, input: RenderInput, rel: number, W: number, H: number) {
  const shots = input.plan?.shots ?? [];
  const change = transitionAt(shots, rel);
  if (!change) return drawShot(ctx, video, input, shotAt(shots, rel), rel, W, H);
  // The outgoing picture (as the Engine's xfade sees it: still moving), then the incoming one over it.
  const look = transitionLook(change.name, change.p);
  ctx.save();
  if (look.fromScale !== 1) {
    ctx.translate(W / 2, H * 0.4);
    ctx.scale(look.fromScale, look.fromScale);
    ctx.translate(-W / 2, -H * 0.4);
  }
  drawShot(ctx, video, input, change.from, rel, W, H);
  ctx.restore();
  if (!layer || layer.width !== W || layer.height !== H) {
    layer = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
  }
  const lctx = layer.getContext("2d") as CanvasRenderingContext2D | null;
  if (!lctx) return drawShot(ctx, video, input, change.to, rel, W, H);
  drawShot(lctx, video, input, change.to, rel, W, H);
  ctx.save();
  if (look.circle !== null) {
    const r = Math.hypot(W, H) / 2 * look.circle;
    ctx.beginPath();
    if (look.circleOut) {
      // The outgoing picture shrinks away inside a circle; the new one shows around it.
      ctx.rect(0, 0, W, H);
      ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2, true);
    } else ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2);
    ctx.clip("evenodd");
  }
  ctx.globalAlpha = look.alpha;
  ctx.drawImage(layer as CanvasImageSource, 0, look.slide * H);
  ctx.restore();
}

/** One shot's composition at this moment. */
function drawShot(ctx: CanvasRenderingContext2D, video: Pic, input: RenderInput, shot: RenderShot | null, rel: number, W: number, H: number) {
  const plan = input.plan;
  const src = plan?.source && plan.source.w > 0 ? plan.source : { w: pw(video), h: ph(video) };
  const k = pw(video) / src.w;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (shot?.kind === "fit" || shot?.kind === "headline") {
    // Ambient glass: the whole picture as a rounded card over a blur of itself.
    drawAmbient(ctx, video, W, H);
    const card = glassCard(W, H, pw(video), ph(video));
    drawCard(ctx, card, W, () => ctx.drawImage(video, card.x, card.y, card.w, card.h));
    return;
  }
  if (shot?.kind === "bars") {
    // Cinema: bars made of the picture itself, darkened, with a soft vignette.
    drawAmbient(ctx, video, W, H, LOOK.cinemaBrightness);
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const vw = pw(video), vh = ph(video), sc = Math.min(W / vw, H / vh);
    ctx.drawImage(video, (W - vw * sc) / 2, (H - vh * sc) / 2, vw * sc, vh * sc);
    return;
  }
  if (shot?.kind === "screen" && shot.main && H >= W) {
    // Presenter: the screen on top, the speaker below, both as rounded cards.
    const top = Math.min(H * 0.5, (W * src.h) / Math.max(1, src.w));
    const [scr, spk] = presenterCards(W, H, top);
    const main = shot.main;
    drawAmbient(ctx, video, W, H);
    drawCard(ctx, scr, W, () => drawCover(ctx, video, k, { x: 0, y: 0, w: src.w, h: src.h }, scr.x, scr.y, scr.w, scr.h));
    drawCard(ctx, spk, W, () => drawCover(ctx, video, k, main, spk.x, spk.y, spk.w, spk.h));
    return;
  }
  if (shot && CONTAIN.has(shot.kind)) return drawContain(ctx, video, W, H);
  if (shot?.kind === "split" && shot.cells.length >= 2) {
    if (H >= W) {
      // Duo cards: two people as two rounded cards with a gap.
      drawAmbient(ctx, video, W, H);
      const [a, b] = duoCards(W, H);
      drawCard(ctx, a, W, () => drawCover(ctx, video, k, shot.cells[0]!, a.x, a.y, a.w, a.h));
      drawCard(ctx, b, W, () => drawCover(ctx, video, k, shot.cells[1]!, b.x, b.y, b.w, b.h));
      return;
    }
    drawCover(ctx, video, k, shot.cells[0]!, 0, 0, W, H / 2);
    drawCover(ctx, video, k, shot.cells[1]!, 0, H / 2, W, H / 2);
    return;
  }
  if (shot?.kind === "grid" && (shot.cells.length >= 4 || (shot.cells.length === 3 && H >= W))) {
    // Spotlight (3: the one talking on top) or a 2 x 2 (4) of rounded cards.
    drawAmbient(ctx, video, W, H);
    const spots = shot.cells.length === 3 ? spotlightCards(W, H) : quadCards(W, H);
    shot.cells.slice(0, spots.length).forEach((c, i) => {
      const b = spots[i]!;
      drawCard(ctx, b, W, () => drawCover(ctx, video, k, c, b.x, b.y, b.w, b.h));
    });
    return;
  }
  const main = (shot ? (cropAt(shot, rel) ?? shot.main ?? shot.cells[0] ?? null) : null) ?? centreCrop(src, W / H);
  drawCover(ctx, video, k, main, 0, 0, W, H);
  if (shot?.kind === "pip" && shot.inset) {
    // Reaction bubble: a rounded card with a soft shadow.
    const bubble = pipBox(W, H);
    const inset = shot.inset;
    drawCard(ctx, bubble, W, () => drawCover(ctx, video, k, inset, bubble.x, bubble.y, bubble.w, bubble.h));
  }
}

/** A canvas look for each caption style, close to the Engine's. */
function paintFor(styleId: string) {
  const yellow = "#FFD60A";
  switch (styleId) {
    case "yellow_pop": return { fill: yellow, stroke: "#000" };
    case "comic": return { fill: yellow, stroke: "#000", upper: true };
    case "uppercase_impact": case "clean_caps": return { fill: "#fff", stroke: "#000", upper: true };
    case "boxed": case "lower_third": case "podcast_bar": case "glow_box": return { fill: "#fff", box: "rgba(0,0,0,0.72)" };
    case "highlighter": return { fill: "#000", box: yellow };
    case "neon": return { fill: "#64D2FF", stroke: "#003344" };
    case "minimal": return { fill: "#fff", shadow: true, weight: 600 };
    case "karaoke_highlight": case "two_color_speaker": return { fill: "#fff", stroke: "#000", highlight: yellow };
    case "serif_quote": return { fill: "#fff", stroke: "#000", family: "Georgia, serif", weight: 700 };
    case "typewriter": return { fill: "#fff", stroke: "#000", family: "ui-monospace, monospace", weight: 700 };
    default: return { fill: "#fff", stroke: "#000" };
  }
}

/** Splits words into lines that fit `maxWidth`. */
function wrap(ctx: CanvasRenderingContext2D, words: string[], maxWidth: number): string[][] {
  const lines: string[][] = [];
  let line: string[] = [];
  for (const w of words) {
    const test = [...line, w].join(" ");
    if (line.length && ctx.measureText(test).width > maxWidth) { lines.push(line); line = [w]; } else line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}

function drawCaptions(ctx: CanvasRenderingContext2D, lines: CaptionLine[], input: RenderInput, rel: number, W: number, H: number) {
  if (!input.captions.on) return;
  const line = lines.find((l) => rel >= l.start_ms && rel <= l.end_ms + 150);
  if (!line) return;
  const p = paintFor(input.captions.styleId);
  const px = Math.round(Math.min(W, H * 0.5625) * 0.068 * input.captions.size);
  ctx.font = `${p.weight ?? 900} ${px}px ${p.family ?? "Inter, 'Segoe UI', system-ui, sans-serif"}`;
  ctx.textBaseline = "middle";
  const words = line.words.map((w) => (p.upper ? w.text.trim().toUpperCase() : w.text.trim())).filter(Boolean);
  const rows = wrap(ctx, words, W * 0.86).slice(0, 3);
  const lh = px * 1.18;
  const block = rows.length * lh;
  const freeY = input.captions.y;
  const centre = typeof freeY === "number" && Number.isFinite(freeY) ? H * Math.min(0.95, Math.max(0.05, freeY))
    : input.captions.position === "top" ? H * 0.2 : input.captions.position === "lower" ? H * 0.82 : H * 0.5;
  let y = centre - block / 2 + lh / 2;
  let index = 0;
  for (const row of rows) {
    const text = row.join(" ");
    const width = ctx.measureText(text).width;
    let x = (W - width) / 2;
    if (p.box) {
      ctx.fillStyle = p.box;
      const pad = px * 0.28;
      ctx.beginPath();
      ctx.roundRect(x - pad, y - lh / 2 - pad * 0.3, width + pad * 2, lh + pad * 0.6, px * 0.2);
      ctx.fill();
    }
    for (const word of row) {
      const w = line.words[index];
      const on = p.highlight && w && rel >= w.start_ms && rel < w.end_ms;
      if (p.stroke) { ctx.lineWidth = px * 0.14; ctx.strokeStyle = p.stroke; ctx.lineJoin = "round"; ctx.strokeText(word, x, y); }
      if (p.shadow) { ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = px * 0.2; }
      ctx.fillStyle = on ? p.highlight! : p.fill;
      ctx.fillText(word, x, y);
      ctx.shadowBlur = 0;
      x += ctx.measureText(`${word} `).width;
      index++;
    }
    y += lh;
  }
}

function drawHeadline(ctx: CanvasRenderingContext2D, input: RenderInput, W: number, H: number) {
  const text = input.headline.text.trim();
  if (!input.headline.on || !text) return;
  const px = Math.round(Math.min(W, H * 0.5625) * 0.05);
  ctx.font = `800 ${px}px Inter, 'Segoe UI', system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  const rows = wrap(ctx, text.split(/\s+/), W * 0.8).slice(0, 2);
  const lh = px * 1.2;
  const pad = px * 0.5;
  const width = Math.max(...rows.map((r) => ctx.measureText(r.join(" ")).width)) + pad * 2;
  const height = rows.length * lh + pad;
  const top = input.headline.position === "bottom" ? H * 0.9 - height : H * 0.07;
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect((W - width) / 2, top, width, height, px * 0.35);
  ctx.fill();
  ctx.fillStyle = "#000";
  rows.forEach((r, i) => {
    const t = r.join(" ");
    ctx.fillText(t, (W - ctx.measureText(t).width) / 2, top + pad / 2 + lh * (i + 0.5));
  });
}

function waitFor(el: HTMLMediaElement, event: string, timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(new Error(`The video took too long to ${event === "seeked" ? "jump to the clip" : "load"}.`)); }, timeoutMs);
    const ok = () => { cleanup(); resolve(); };
    const bad = () => { cleanup(); reject(new Error("The source video couldn't be read in this browser.")); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(event, ok); el.removeEventListener("error", bad); };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

/** Renders the clip; `onProgress` gets 0..1. Resolves with the MP4 and its size. */
type Rendered = { blob: Blob; width: number; height: number; durationMs: number };

/**
 * Make the clip's MP4 here. First the fast way: read the source file
 * directly, decode its frames as fast as the computer allows and copy its
 * sound packets as they are (an edit never changes the sound), which takes a
 * fraction of the clip's length and doesn't need the tab in front. If the
 * file or the browser can't do that, play it through once in real time.
 */
export async function renderClipInBrowser(input: RenderInput, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Rendered> {
  try {
    return await renderClipFast(input, onProgress, signal);
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn("Fast render unavailable, playing it through instead:", e);
    onProgress(0);
    return renderClipRealtime(input, onProgress, signal);
  }
}

async function renderClipRealtime(input: RenderInput, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Rendered> {
  const { w: W, h: H } = OUTPUT[input.aspect];
  const fps = 30;
  const bitrate = Math.min(8_000_000, Math.max(2_500_000, Math.floor((45 * 8_000_000) / Math.max(10, (input.endMs - input.startMs) / 1000))));
  let codec = "";
  for (const c of VIDEO_CODECS) {
    const ok = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }).catch(() => null);
    if (ok?.supported) { codec = c; break; }
  }
  if (!codec) throw new Error("This browser can't encode H.264 video.");

  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.preload = "auto";
  video.playsInline = true;
  video.src = input.src;
  await waitFor(video, "loadedmetadata");

  const audioCtx = new AudioContext();
  const sampleRate = audioCtx.sampleRate;
  const audioOk = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 128_000 }).catch(() => null);
  if (!audioOk?.supported) { await audioCtx.close(); throw new Error("This browser can't encode AAC audio."); }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: "in-memory", firstTimestampBehavior: "offset",
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    audio: { codec: "aac", numberOfChannels: 2, sampleRate },
  });
  let failure: Error | null = null;
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => {
    try { muxer.addVideoChunk(chunk, meta); }
    catch (e) { failure = e instanceof Error ? e : new Error(String(e)); }
  }, error: (e) => { failure = e; } });
  videoEncoder.configure({ codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality" });
  const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failure = e; } });
  audioEncoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 128_000 });

  // The source's sound goes into the encoder only, never out of the speakers.
  const sourceNode = audioCtx.createMediaElementSource(video);
  const dest = audioCtx.createMediaStreamDestination();
  dest.channelCount = 2;
  dest.channelCountMode = "explicit";
  sourceNode.connect(dest);
  const track = dest.stream.getAudioTracks()[0]!;
  const Processor = (window as Win).MediaStreamTrackProcessor!;
  const reader = new Processor({ track }).readable.getReader();
  let recording = false;
  const audioLoop = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      if (!recording) { value.close(); continue; }
      // Each track's first timestamp becomes 0 in the MP4 (firstTimestampBehavior "offset").
      audioEncoder.encode(value);
      value.close();
    }
  })();

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const lines = groupCaptionLines(input.words);
  const startS = Math.max(0, (input.startMs - input.offsetMs) / 1000);
  const endAbs = input.endMs;
  const poster = Boolean(input.plan?.shots.length) && input.plan!.shots.every((s) => s.kind === "headline");
  video.currentTime = startS;
  await waitFor(video, "seeked");

  let frames = 0;
  let lastTs = -1;
  const durationMs = input.endMs - input.startMs;
  await new Promise<void>((resolve, reject) => {
    // Sound is kept only between the first and last frames, so it lines up with the picture.
    const stop = () => { recording = false; video.pause(); resolve(); };
    signal?.addEventListener("abort", () => { video.pause(); reject(new Error("Stopped.")); }, { once: true });
    // A background tab plays slowly or not at all: hand over at once rather than make a broken video.
    const hidden = () => { if (document.hidden) { video.pause(); reject(new Error("the tab went into the background")); } };
    document.addEventListener("visibilitychange", hidden);
    const done = () => document.removeEventListener("visibilitychange", hidden);
    video.addEventListener("pause", done, { once: true });
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (failure) { video.pause(); reject(failure); return; }
      const abs = input.offsetMs + meta.mediaTime * 1000;
      if (abs >= endAbs) { stop(); return; }
      const ts = Math.round((abs - input.startMs) * 1000);
      if (ts >= 0 && ts > lastTs) {
        drawPicture(ctx, video, input, abs - input.planStartMs, W, H);
        drawCaptions(ctx, lines, input, abs - input.startMs, W, H);
        drawHeadline(ctx, input, W, H);
        if (poster) {
          // Podcast poster: a bar that fills across the bottom as the clip plays.
          const bh = Math.max(4, H * LOOK.progress.height);
          ctx.fillStyle = `rgba(255,255,255,${LOOK.progress.alpha})`;
          ctx.fillRect(0, H - bh - H * LOOK.progress.lift, (W * (abs - input.startMs)) / Math.max(1, endAbs - input.startMs), bh);
        }
        const frame = new VideoFrame(canvas, videoFrameTiming(ts, fps));
        videoEncoder.encode(frame, { keyFrame: frames % (fps * 2) === 0 });
        recording = true;
        frame.close();
        frames++;
        lastTs = ts;
        onProgress(Math.min(0.97, (abs - input.startMs) / Math.max(1, durationMs)));
      }
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
    video.addEventListener("ended", stop, { once: true });
    void audioCtx.resume().then(() => video.play()).catch(reject);
  });
  recording = false;
  track.stop();
  await reader.cancel().catch(() => undefined);
  await audioLoop.catch(() => undefined);
  await videoEncoder.flush();
  await audioEncoder.flush();
  videoEncoder.close();
  audioEncoder.close();
  await audioCtx.close();
  video.removeAttribute("src");
  video.load();
  if (failure) throw failure;
  if (frames < 10) throw new Error("Too few frames were made; the video may not have played.");
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), width: W, height: H, durationMs };
}


// ---------------------------------------------------------------- fast path

/** Bytes [start, end) of the source, read with an HTTP range request. */
async function fetchRange(url: string, start: number, end: number, signal?: AbortSignal): Promise<{ buf: ArrayBuffer; total: number | null }> {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` }, signal: signal ?? null });
  // Past the end of the file: nothing more to read.
  if (r.status === 416) return { buf: new ArrayBuffer(0), total: start };
  if (r.status !== 206 && r.status !== 200) throw new Error(`The source couldn't be read (${r.status}).`);
  const total = Number((r.headers.get("content-range") ?? "").split("/")[1]) || null;
  let buf = await r.arrayBuffer();
  if (r.status === 200) buf = buf.slice(start, end);
  return { buf, total };
}

/** The file's track table, reading only as far as the moov box (skipping the media data). */
async function readMoov(url: string, signal?: AbortSignal) {
  const file = MP4Box.createFile();
  let info: MP4Box.MP4Info | null = null;
  let error: string | null = null;
  file.onReady = (i) => { info = i; };
  file.onError = (e) => { error = e; };
  let next = 0;
  let total: number | null = null;
  for (let guard = 0; guard < 40 && !info && !error; guard++) {
    const size = 2 * 1024 * 1024;
    const end: number = total ? Math.min(total, next + size) : next + size;
    if (total !== null && next >= total) break;
    const got = await fetchRange(url, next, end, signal);
    // Content-Range is often not exposed across origins: a short read means the end of the file.
    total = total ?? got.total ?? (got.buf.byteLength < end - next ? next + got.buf.byteLength : null);
    if (!got.buf.byteLength) break;
    const chunk = got.buf as MP4Box.MP4ArrayBuffer;
    chunk.fileStart = next;
    const want = file.appendBuffer(chunk);
    next = want > next ? want : next + got.buf.byteLength;
  }
  file.flush();
  if (error) throw new Error(`The source file couldn't be read: ${error}`);
  if (!info) throw new Error("The source file's index wasn't found.");
  return { file, info: info as MP4Box.MP4Info };
}

/** The codec configuration box of a track's sample entry, as WebCodecs wants it. */
function trackDescription(file: MP4Box.MP4File, id: number): Uint8Array | undefined {
  const trak = file.getTrackById(id);
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // without the box header
    }
  }
  return undefined;
}

function audioSpecificConfig(file: MP4Box.MP4File, id: number): Uint8Array | undefined {
  const entry = file.getTrackById(id)?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  const data = entry?.esds?.esd?.descs?.[0]?.descs?.[0]?.data;
  return data ? new Uint8Array(data) : undefined;
}

async function renderClipFast(input: RenderInput, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Rendered> {
  if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined") throw new Error("WebCodecs isn't available.");
  const { w: W, h: H } = OUTPUT[input.aspect];
  const fps = 30;
  const bitrate = Math.min(8_000_000, Math.max(2_500_000, Math.floor((45 * 8_000_000) / Math.max(10, (input.endMs - input.startMs) / 1000))));
  let codec = VIDEO_CODECS[0]!;
  for (const c of VIDEO_CODECS) {
    if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate, framerate: fps }).catch(() => null))?.supported) { codec = c; break; }
  }

  const { file, info } = await readMoov(input.src, signal);
  const vt = info.videoTracks[0];
  const at = info.audioTracks[0];
  if (!vt) throw new Error("The source has no video track.");
  const vTrak = file.getTrackById(vt.id);
  const vSamples: MP4Box.MP4Sample[] = vTrak?.samples ?? [];
  if (!vSamples.length) throw new Error("The source's frames aren't listed.");
  const description = trackDescription(file, vt.id);
  const decoderConfig: VideoDecoderConfig = {
    codec: vt.codec, hardwareAcceleration: "prefer-hardware",
    ...(vt.video ? { codedWidth: vt.video.width, codedHeight: vt.video.height } : {}),
    ...(description ? { description } : {}),
  };
  if (!(await VideoDecoder.isConfigSupported(decoderConfig).catch(() => null))?.supported) throw new Error(`This browser can't decode ${vt.codec}.`);

  // Source-time window of the clip, in microseconds.
  const startUs = (input.startMs - input.offsetMs) * 1000;
  const endUs = (input.endMs - input.offsetMs) * 1000;
  const usOf = (s: MP4Box.MP4Sample) => (s.cts * 1_000_000) / s.timescale;
  // Decoding has to start at the keyframe at or before the clip's start.
  let first = vSamples.findIndex((s) => usOf(s) >= startUs);
  if (first < 0) throw new Error("The clip is past the end of the source.");
  while (first > 0 && !vSamples[first]!.is_sync) first--;
  let last = vSamples.length - 1;
  for (let i = first; i < vSamples.length; i++) { if (usOf(vSamples[i]!) > endUs + 200_000) { last = i; break; } }
  const vRange = vSamples.slice(first, last + 1);

  // Sound: AAC packets copied as they are.
  const aSamples: MP4Box.MP4Sample[] = at ? (file.getTrackById(at.id)?.samples ?? []).filter((s: MP4Box.MP4Sample) => usOf(s) >= startUs && usOf(s) < endUs) : [];
  const asc = at ? audioSpecificConfig(file, at.id) : undefined;
  const audioOk = Boolean(at && at.codec.startsWith("mp4a") && asc && aSamples.length);
  if (at && !audioOk) throw new Error("The source's sound can't be copied as it is.");

  // One read covers both tracks' bytes for the clip.
  const all = [...vRange, ...aSamples];
  const lo = Math.min(...all.map((s) => s.offset));
  const hi = Math.max(...all.map((s) => s.offset + s.size));
  if (hi - lo > 600 * 1024 * 1024) throw new Error("The clip's part of the file is too big to read here.");
  const bytes = new Uint8Array(hi - lo);
  const piece = 8 * 1024 * 1024;
  for (let at0 = lo; at0 < hi; at0 += piece) {
    const got = await fetchRange(input.src, at0, Math.min(hi, at0 + piece), signal);
    bytes.set(new Uint8Array(got.buf), at0 - lo);
    onProgress(0.3 * Math.min(1, (at0 + piece - lo) / (hi - lo)));
  }
  const slice = (s: MP4Box.MP4Sample) => bytes.subarray(s.offset - lo, s.offset - lo + s.size);

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, fastStart: "in-memory", firstTimestampBehavior: "offset",
    video: { codec: "avc", width: W, height: H, frameRate: fps },
    ...(audioOk && at?.audio ? { audio: { codec: "aac" as const, numberOfChannels: at.audio.channel_count, sampleRate: at.audio.sample_rate } } : {}),
  });
  let failure: Error | null = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => {
    try { muxer.addVideoChunk(chunk, meta); }
    catch (e) { failure = e instanceof Error ? e : new Error(String(e)); }
  }, error: (e) => { failure = e; } });
  // The encoder is the slow part: its "realtime" mode on the GPU runs about twice
  // as fast as "quality" at the same bitrate, with no visible difference here.
  const fastCfg: VideoEncoderConfig = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "realtime", hardwareAcceleration: "prefer-hardware" };
  const encCfg = (await VideoEncoder.isConfigSupported(fastCfg).catch(() => null))?.supported
    ? fastCfg : { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: "quality" as const };
  encoder.configure(encCfg);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const lines = groupCaptionLines(input.words);
  const poster = Boolean(input.plan?.shots.length) && input.plan!.shots.every((s) => s.kind === "headline");
  const durationMs = input.endMs - input.startMs;
  const minGapUs = 1_000_000 / fps - 1_000;
  let frames = 0;
  let lastOut = -Infinity;

  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const t = frame.timestamp;
        if (failure || t < startUs || t >= endUs || t - lastOut < minGapUs) return;
        const abs = input.offsetMs + t / 1000;
        drawPicture(ctx, frame, input, abs - input.planStartMs, W, H);
        drawCaptions(ctx, lines, input, abs - input.startMs, W, H);
        drawHeadline(ctx, input, W, H);
        if (poster) {
          const bh = Math.max(4, H * LOOK.progress.height);
          ctx.fillStyle = `rgba(255,255,255,${LOOK.progress.alpha})`;
          ctx.fillRect(0, H - bh - H * LOOK.progress.lift, (W * (abs - input.startMs)) / Math.max(1, durationMs), bh);
        }
        const out = new VideoFrame(canvas, videoFrameTiming(t - startUs, fps));
        encoder.encode(out, { keyFrame: frames % (fps * 2) === 0 });
        out.close();
        frames++;
        lastOut = t;
        onProgress(0.3 + 0.68 * Math.min(1, (t - startUs) / Math.max(1, endUs - startUs)));
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      } finally {
        frame.close();
      }
    },
    error: (e) => { failure = e; },
  });
  decoder.configure(decoderConfig);

  const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
  for (const s of vRange) {
    if (signal?.aborted) { decoder.close(); encoder.close(); throw new Error("Stopped."); }
    if (failure) break;
    while (decoder.decodeQueueSize > 12 || encoder.encodeQueueSize > 12) await breathe();
    decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? "key" : "delta", timestamp: usOf(s), duration: (s.duration * 1_000_000) / s.timescale, data: slice(s) }));
  }
  await decoder.flush().catch((e) => { failure = failure ?? e; });
  decoder.close();
  await encoder.flush().catch((e) => { failure = failure ?? e; });
  encoder.close();
  if (failure) throw failure;
  if (frames < 10) throw new Error("Too few frames came out of the source.");

  if (audioOk && at?.audio && asc) {
    const decoderConfigA = { codec: "mp4a.40.2", sampleRate: at.audio.sample_rate, numberOfChannels: at.audio.channel_count, description: asc };
    aSamples.forEach((s, i) => {
      muxer.addAudioChunk(
        new EncodedAudioChunk({ type: "key", timestamp: Math.round(usOf(s) - startUs), duration: Math.round((s.duration * 1_000_000) / s.timescale), data: slice(s) }),
        i === 0 ? { decoderConfig: decoderConfigA } : undefined,
      );
    });
  }
  muxer.finalize();
  onProgress(1);
  return { blob: new Blob([target.buffer], { type: "video/mp4" }), width: W, height: H, durationMs };
}
