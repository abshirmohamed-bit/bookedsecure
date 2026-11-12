/**
 * Makes a clip's MP4 in the browser: the source plays once, every frame is
 * composed on a canvas (the Engine's shot crops, the captions and the
 * headline), encoded to H.264 with WebCodecs, the audio to AAC, and both are
 * muxed into an MP4. Desktop Chrome and Edge can; anything else (or any
 * failure) saves through the Engine instead.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { groupCaptionLines, type CaptionLine, type CaptionWord, type VideoAspect } from "@/lib/video-clips";

export type PlanBox = { x: number; y: number; w: number; h: number };
export type RenderShot = { start_ms: number; end_ms: number; kind: string; window: PlanBox | null; pan: [number, number][]; cells: PlanBox[]; main: PlanBox | null; inset: PlanBox | null };
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
  captions: { on: boolean; styleId: string; position: string; size: number };
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

/** Whether this browser can make the video itself. */
export function canRenderInBrowser(): boolean {
  if (typeof window === "undefined") return false;
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined"
    && Boolean((window as Win).MediaStreamTrackProcessor) && "requestVideoFrameCallback" in HTMLVideoElement.prototype
    && typeof AudioContext !== "undefined";
}

/** The crop of a fill shot at `ms`: its window slid along its pan. */
function cropAt(shot: RenderShot, ms: number): PlanBox | null {
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

function centreCrop(src: { w: number; h: number }, ratio: number): PlanBox {
  const w = Math.min(src.w, src.h * ratio);
  const h = Math.min(src.h, w / ratio);
  return { x: (src.w - w) / 2, y: (src.h - h) / 2, w, h };
}

/** Draws `box` of the source (in plan pixels) to cover the destination rectangle. */
function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, k: number, box: PlanBox, dx: number, dy: number, dw: number, dh: number) {
  const target = dw / dh;
  let { x, y, w, h } = box;
  if (w / h > target) { const nw = h * target; x += (w - nw) / 2; w = nw; } else { const nh = w / target; y += (h - nh) / 2; h = nh; }
  ctx.drawImage(video, x * k, y * k, w * k, h * k, dx, dy, dw, dh);
}

function drawContain(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, W: number, H: number) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const s = Math.min(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
}

/** One composed frame: the shot's picture for this moment. */
function drawPicture(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, input: RenderInput, rel: number, W: number, H: number) {
  const plan = input.plan;
  const src = plan?.source && plan.source.w > 0 ? plan.source : { w: video.videoWidth, h: video.videoHeight };
  const k = video.videoWidth / src.w;
  const shot = plan?.shots.find((s) => rel >= s.start_ms && rel < s.end_ms)
    ?? (plan?.shots.length ? (rel < plan.shots[0]!.start_ms ? plan.shots[0]! : plan.shots[plan.shots.length - 1]!) : null);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (shot && CONTAIN.has(shot.kind)) return drawContain(ctx, video, W, H);
  if (shot?.kind === "split" && shot.cells.length >= 2) {
    drawCover(ctx, video, k, shot.cells[0]!, 0, 0, W, H / 2);
    drawCover(ctx, video, k, shot.cells[1]!, 0, H / 2, W, H / 2);
    return;
  }
  if (shot?.kind === "grid" && shot.cells.length >= 4) {
    shot.cells.slice(0, 4).forEach((c, i) => drawCover(ctx, video, k, c, (i % 2) * (W / 2), Math.floor(i / 2) * (H / 2), W / 2, H / 2));
    return;
  }
  const main = (shot ? (cropAt(shot, rel) ?? shot.main ?? shot.cells[0] ?? null) : null) ?? centreCrop(src, W / H);
  drawCover(ctx, video, k, main, 0, 0, W, H);
  if (shot?.kind === "pip" && shot.inset) {
    const iw = W * 0.34, ih = iw * (shot.inset.h / shot.inset.w);
    const ix = W - iw - W * 0.04, iy = H * 0.06;
    ctx.fillStyle = "#fff";
    ctx.fillRect(ix - 6, iy - 6, iw + 12, ih + 12);
    drawCover(ctx, video, k, shot.inset, ix, iy, iw, ih);
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
  const centre = input.captions.position === "top" ? H * 0.2 : input.captions.position === "lower" ? H * 0.82 : H * 0.5;
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
export async function renderClipInBrowser(input: RenderInput, onProgress: (p: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; width: number; height: number; durationMs: number }> {
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
  const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
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
        const frame = new VideoFrame(canvas, { timestamp: ts });
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
