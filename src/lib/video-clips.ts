/** Rules for video clipping, shared by the server, Co-Work and the Social page. */

export const VIDEO_ASPECTS = ["9:16", "1:1", "4:5", "16:9"] as const;
export type VideoAspect = (typeof VIDEO_ASPECTS)[number];

export const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
/** The Engine's own limits; anything outside them is refused outright. */
export const MIN_CLIPS_PER_JOB = 2;
export const MAX_CLIP_INSTRUCTIONS = 500;

/** Worth another try later: the Engine is busy or waking, not refusing the job. */
export function isTemporaryEngineError(code: string): boolean {
  return ["ENGINE_NOT_CONFIGURED", "ENGINE_UNREACHABLE", "JOB_LIMIT_REACHED", "RATE_LIMITED", "HTTP_502", "HTTP_503", "HTTP_504"].includes(code);
}

export type TranscriptLine = { start_ms: number; end_ms: number; text: string };

/** The transcript as "[m:ss] words" lines about every 30 seconds, cut at `maxChars`. */
export function transcriptText(lines: readonly TranscriptLine[], maxChars = 15000): { text: string; cut: boolean } {
  const blocks: string[] = [];
  let current: string[] = [];
  let blockStart = -1;
  const stamp = (ms: number) => `[${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}]`;
  for (const line of lines) {
    if (blockStart < 0 || line.start_ms - blockStart >= 30_000) {
      if (current.length) blocks.push(`${stamp(blockStart)} ${current.join(" ")}`);
      current = [];
      blockStart = line.start_ms;
    }
    current.push(line.text);
  }
  if (current.length) blocks.push(`${stamp(blockStart)} ${current.join(" ")}`);
  const full = blocks.join("\n");
  return full.length > maxChars ? { text: full.slice(0, maxChars), cut: true } : { text: full, cut: false };
}

/** Clips rendered without being asked, so the best ones are ready to watch. */
export const AUTO_RENDER_COUNT = 3;

export const ACTIVE_JOB_STATUSES = ["INGESTING", "IMPORTING", "QUEUED", "PROCESSING"] as const;
export type VideoJobStatus = "UPLOADING" | "WAITING" | "COMPLETED" | "FAILED" | (typeof ACTIVE_JOB_STATUSES)[number];

export function isActiveJob(status: string): boolean {
  return status === "UPLOADING" || (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

/** What the owner sees while a video is being worked on. */
export function jobStatusLabel(job: { status: string; stage?: string | null }): string {
  switch (job.status) {
    case "UPLOADING": return "Uploading";
    case "INGESTING":
    case "IMPORTING": return "Getting your video ready";
    case "WAITING": return "Ready when you are";
    case "QUEUED": return "Waiting its turn";
    case "COMPLETED": return "Clips ready";
    case "FAILED": return "Couldn't finish";
    default: break;
  }
  const stage = (job.stage ?? "").toLowerCase();
  if (stage === "transcribing") return "Listening to your video";
  if (stage === "finding") return "Finding the best moments";
  if (stage === "framing") return "Framing the shots";
  if (stage === "building" || stage === "finalizing") return "Cutting your clips";
  return "Working on it";
}

/**
 * Only public https addresses may be handed to the Engine, so nobody can point
 * it at its own host's private network.
 */
export function isPublicVideoLink(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".")) return false;
  if (host.startsWith("[") || /^[\d.]+$/.test(host)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(host);
}

/** The highest-scoring clips, best first, for rendering straight away. */
export function clipsToRender<T extends { id: string; score: number | null }>(clips: readonly T[], count = AUTO_RENDER_COUNT): T[] {
  return [...clips].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, count);
}

// ------------------------------------------------------------------ clip editor

/** A caption word as the Engine keeps it: times are from the clip's own start. */
export type CaptionWord = { text: string; start_ms: number; end_ms: number; [key: string]: unknown };
export type CaptionLine = { start_ms: number; end_ms: number; text: string; words: CaptionWord[] };

/**
 * The Engine's choices, as the app knows them without asking. The ids must match
 * the Engine's catalog (GET /v1/catalog), which is what the editor shows when it
 * answers; these words stand in when it is asleep, and the ids validate input.
 */
export const CLIP_LAYOUTS = [
  { id: "auto", label: "Let the Engine choose", hint: "Decided shot by shot: follows the speaker, stacks two people, shows screenshots whole" },
  { id: "full-video", label: "Follow the speaker", hint: "One crop that holds on whoever is talking, re-aimed on every cut" },
  { id: "split", label: "Split screen", hint: "Two people who share the shot, one cell each" },
  { id: "grid", label: "Group grid", hint: "Three or four people, each framed in their own cell" },
  { id: "screen", label: "Screen + speaker", hint: "The picture on top, the person below: slides, screen shares, gameplay" },
  { id: "pip", label: "Picture-in-picture", hint: "The main shot with the other person's face in a small inset" },
  { id: "streamer", label: "Blurred background", hint: "The whole picture over a blurred copy of itself" },
  { id: "black-box", label: "Black bars", hint: "The whole picture with black above and below" },
  { id: "title-subtitles", label: "Headline + captions", hint: "The picture in the middle, the headline above and the words below" },
] as const;
export type ClipLayout = (typeof CLIP_LAYOUTS)[number]["id"];
export const CLIP_LAYOUT_IDS = CLIP_LAYOUTS.map((l) => l.id) as [ClipLayout, ...ClipLayout[]];

export const CLIP_ZOOMS = [
  { id: "off", label: "No zoom", hint: "The crop is as wide as the output allows" },
  { id: "auto", label: "Push in on wide shots", hint: "Tighter when the person is small in the frame, with room above the head" },
  { id: "moments", label: "Punch in on lines", hint: "Pushes in further on every other sentence, for energy" },
] as const;
export type ClipZoom = (typeof CLIP_ZOOMS)[number]["id"];
export const CLIP_ZOOM_IDS = CLIP_ZOOMS.map((z) => z.id) as [ClipZoom, ...ClipZoom[]];

export const CAPTION_POSITIONS = ["top", "middle", "lower"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export const CAPTION_SIZE = { min: 0.6, max: 1.6, step: 0.1 } as const;
export const TITLE_STYLES = [
  { id: "bold_band", label: "Bold band", hint: "Capitals on a dark band" },
  { id: "boxed", label: "Boxed", hint: "As written, on a softer box" },
  { id: "headline", label: "Headline", hint: "Capitals with an outline, no box" },
  { id: "clean", label: "Clean", hint: "As written, with a soft shadow" },
] as const;
export type TitleStyle = (typeof TITLE_STYLES)[number]["id"];
export const TITLE_STYLE_IDS = TITLE_STYLES.map((t) => t.id) as [TitleStyle, ...TitleStyle[]];
export const TITLE_POSITIONS = ["auto", "top", "bottom"] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];

/** How a whole video should be clipped, chosen before the Engine runs (video_clip_jobs.options). */
export type ClipJobOptions = {
  layout?: ClipLayout | undefined; zoom?: ClipZoom | undefined; captionStyleId?: string | undefined; captionPosition?: CaptionPosition | undefined;
  captionSize?: number | undefined; titleEnabled?: boolean | undefined; titleStyle?: TitleStyle | undefined;
};

/** A jsonb value as job options: unknown keys and bad values are dropped, never thrown on. */
export function readJobOptions(value: unknown): ClipJobOptions {
  if (!value || typeof value !== "object") return {};
  const v = value as Record<string, unknown>;
  const out: ClipJobOptions = {};
  if (CLIP_LAYOUT_IDS.includes(v["layout"] as ClipLayout)) out.layout = v["layout"] as ClipLayout;
  if (CLIP_ZOOM_IDS.includes(v["zoom"] as ClipZoom)) out.zoom = v["zoom"] as ClipZoom;
  if (typeof v["captionStyleId"] === "string" && v["captionStyleId"]) out.captionStyleId = v["captionStyleId"].slice(0, 60);
  if (CAPTION_POSITIONS.includes(v["captionPosition"] as CaptionPosition)) out.captionPosition = v["captionPosition"] as CaptionPosition;
  if (typeof v["captionSize"] === "number" && v["captionSize"] >= CAPTION_SIZE.min && v["captionSize"] <= CAPTION_SIZE.max) out.captionSize = v["captionSize"];
  if (typeof v["titleEnabled"] === "boolean") out.titleEnabled = v["titleEnabled"];
  if (TITLE_STYLE_IDS.includes(v["titleStyle"] as TitleStyle)) out.titleStyle = v["titleStyle"] as TitleStyle;
  return out;
}

/** The kinds of shot the Engine composes, in the owner's words. */
export const SHOT_KINDS: Record<string, string> = {
  fill: "Follows the speaker", fit: "Whole picture over a blur", bars: "Whole picture with bars", headline: "Headline layout",
  split: "Split screen", grid: "Group grid", screen: "Screen + speaker", pip: "Picture-in-picture", feed: "One side of a split-screen call",
};

export const MIN_CLIP_MS = 3_000;
export const MAX_CLIP_MS = 10 * 60_000;

/** The Engine's caption lines (caption.group_lines): up to 4 words, at most 1.6 s. */
export function groupCaptionLines(words: readonly CaptionWord[], maxWords = 4, maxMs = 1600): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let buf: CaptionWord[] = [];
  const flush = () => {
    if (buf.length) lines.push({ start_ms: buf[0]!.start_ms, end_ms: buf[buf.length - 1]!.end_ms, text: buf.map((w) => w.text.trim()).join(" ").trim(), words: buf });
  };
  for (const w of words) {
    if (buf.length && (buf.length >= maxWords || w.end_ms - buf[0]!.start_ms > maxMs)) { flush(); buf = []; }
    buf.push(w);
  }
  flush();
  return lines;
}

/** New words over a span: kept timings when the count matches, else spread evenly. */
function respread(original: readonly CaptionWord[], text: string): CaptionWord[] {
  const tokens = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((t) => t.slice(0, 60));
  if (!tokens.length || !original.length) return [];
  if (tokens.length === original.length) return original.map((w, i) => ({ ...w, text: tokens[i]! }));
  const start = original[0]!.start_ms;
  const step = (original[original.length - 1]!.end_ms - start) / tokens.length;
  return tokens.map((t, i) => ({ ...original[Math.min(i, original.length - 1)]!, text: t, start_ms: Math.round(start + i * step), end_ms: Math.round(start + (i + 1) * step) }));
}

export type CaptionLineEdit = { start_ms: number; from: string; to: string };

/**
 * Applies the editor's corrected lines. Each names the line it was made on and
 * the text it saw, so a line that has changed since is refused, not guessed at.
 */
export function applyLineEdits(words: readonly CaptionWord[], edits: readonly CaptionLineEdit[]): CaptionWord[] {
  const byStart = new Map(edits.map((e) => [e.start_ms, e]));
  const out: CaptionWord[] = [];
  let used = 0;
  for (const line of groupCaptionLines(words)) {
    const edit = byStart.get(line.start_ms);
    if (!edit) { out.push(...line.words); continue; }
    if (edit.from.trim() !== line.text) throw new Error("The captions changed while you were editing. Reopen the clip and try again.");
    used++;
    out.push(...respread(line.words, edit.to));
  }
  if (used !== byStart.size) throw new Error("The captions changed while you were editing. Reopen the clip and try again.");
  return out;
}

const bare = (s: string) => s.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");

/** Co-Work's fixes: every place the wrong word or phrase is said becomes the right one. */
export function applyWordFixes(words: readonly CaptionWord[], fixes: readonly { wrong: string; right: string }[]): { words: CaptionWord[]; changed: number } {
  let current = [...words];
  let changed = 0;
  for (const fix of fixes) {
    const target = fix.wrong.split(/\s+/).map(bare).filter(Boolean);
    if (!target.length) continue;
    const next: CaptionWord[] = [];
    for (let i = 0; i < current.length;) {
      const slice = current.slice(i, i + target.length);
      if (slice.length === target.length && slice.every((w, k) => bare(w.text) === target[k])) {
        const trail = /[^\p{L}\p{N}']+$/u.exec(slice[slice.length - 1]!.text.trim())?.[0] ?? "";
        const right = fix.right.trim();
        next.push(...respread(slice, right && trail && !right.endsWith(trail) ? right + trail : right));
        changed++;
        i += target.length;
      } else {
        next.push(current[i]!);
        i++;
      }
    }
    current = next;
  }
  return { words: current, changed };
}

/**
 * Keeps corrected words through a trim. `base` is the clip's words before the
 * trim (from oldIn), `fresh` the Engine's words for the new range (from newIn).
 * Inside the old range the corrected words win; outside it the transcript fills in.
 */
export function mergeTrimmedWords(base: readonly CaptionWord[], oldIn: number, oldOut: number, fresh: readonly CaptionWord[], newIn: number, newOut: number): CaptionWord[] {
  const length = newOut - newIn;
  const shift = oldIn - newIn;
  const kept = base.map((w) => ({ ...w, start_ms: w.start_ms + shift, end_ms: w.end_ms + shift })).filter((w) => w.end_ms > 0 && w.start_ms < length);
  const filled = fresh.filter((w) => {
    const abs = w.start_ms + newIn;
    return abs < oldIn || abs >= oldOut;
  });
  return [...kept, ...filled].sort((a, b) => a.start_ms - b.start_ms);
}

/** A trim the Engine will take: inside the source, start before end, a sensible length. */
export function checkTrim(inMs: number, outMs: number, sourceMs: number | null): string | null {
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || inMs < 0) return "The clip can't start before the video does.";
  if (sourceMs && outMs > sourceMs) return "The clip can't end after the video does.";
  if (outMs - inMs < MIN_CLIP_MS) return "A clip has to be at least 3 seconds long.";
  if (outMs - inMs > MAX_CLIP_MS) return "A clip can be up to 10 minutes long.";
  return null;
}

/** The Engine's caption styles, for when it is asleep and cannot be asked. Ids match engine/app/pipeline/caption.py. */
export const FALLBACK_CAPTION_STYLES: { id: string; name: string; font: string; defaults: { size: number; position: string; animation: string } }[] = [
  { id: "bold_white", name: "Bold white", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "yellow_pop", name: "Yellow pop", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "pop" } },
  { id: "outlined", name: "Outlined", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "boxed", name: "Boxed", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "neon", name: "Neon", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "minimal", name: "Minimal", font: "Montserrat", defaults: { size: 52, position: "middle", animation: "none" } },
  { id: "karaoke_highlight", name: "Karaoke highlight", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "karaoke" } },
  { id: "word_pop", name: "Word pop", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "pop" } },
  { id: "two_color_speaker", name: "Two-colour speaker", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "lower_third", name: "Lower third", font: "Montserrat", defaults: { size: 48, position: "lower", animation: "none" } },
  { id: "uppercase_impact", name: "Uppercase impact", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "handwritten", name: "Handwritten", font: "Permanent Marker", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "bounce", name: "Bounce", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "bounce" } },
  { id: "typewriter", name: "Typewriter", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "typewriter" } },
  { id: "glow_box", name: "Glow box", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "highlighter", name: "Highlighter", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "comic", name: "Comic", font: "Montserrat", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "serif_quote", name: "Serif quote", font: "Playfair Display", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "clean_caps", name: "Clean caps", font: "Anton", defaults: { size: 64, position: "middle", animation: "none" } },
  { id: "podcast_bar", name: "Podcast bar", font: "Montserrat", defaults: { size: 46, position: "lower", animation: "none" } },
];
