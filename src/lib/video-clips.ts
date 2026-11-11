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

/** The Engine's layouts the editor offers, in plain words. "title-subtitles" stays Engine-only. */
export const CLIP_LAYOUTS = [
  { id: "auto", label: "Let Co-Work choose", hint: "Picks per clip" },
  { id: "full-video", label: "Follow the speaker", hint: "Re-aims on every cut" },
  { id: "split", label: "Split screen", hint: "Two people stacked" },
  { id: "streamer", label: "Blurred background", hint: "Whole shot over a blur" },
  { id: "black-box", label: "Whole shot", hint: "Fit with black bars" },
] as const;
export type ClipLayout = (typeof CLIP_LAYOUTS)[number]["id"];
export const CLIP_LAYOUT_IDS = CLIP_LAYOUTS.map((l) => l.id) as [ClipLayout, ...ClipLayout[]];

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
