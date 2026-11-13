/**
 * Clip learning, step 1: what the Engine made and what the owner changed.
 *
 * The Engine's own picks are kept on each clip (video_clips.original) the
 * moment they arrive, and every change the owner makes afterwards is one row
 * in video_clip_events (kind, before, after). Later steps compare the two with
 * how the posted clips performed. Pure: no database here, so it is all tested.
 */
import { readJobOptions } from "@/lib/video-clips";

export const CLIP_EVENT_KINDS = [
  "title_changed", "headline_changed", "trimmed", "layout_changed", "caption_changed",
  "zoom_changed", "shape_changed", "deleted", "posted",
] as const;
export type ClipEventKind = (typeof CLIP_EVENT_KINDS)[number];
export type ClipEvent = { kind: ClipEventKind; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

export type ClipOriginal = {
  title: string | null; startMs: number | null; endMs: number | null; durationMs: number | null;
  score: number | null; grades: Record<string, string> | null; reason: string | null; sceneAnalysis: string | null;
  layout: string | null; captionStyleId: string | null; zoom: string | null; focus: string | null; aspect: string | null;
  headline: { text: string; style: string } | null;
  /** What is said first: the opening sentence, up to HOOK_WORDS words. */
  hookLine: string | null;
};

const HOOK_WORDS = 14;
const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The opening words of a clip, to the end of its first sentence. */
export function hookLine(words: readonly { text?: unknown }[]): string | null {
  const out: string[] = [];
  for (const w of words) {
    const t = typeof w.text === "string" ? w.text.trim() : "";
    if (!t) continue;
    out.push(t);
    if (/[.!?]["')\]]?$/.test(t) || out.length >= HOOK_WORDS) break;
  }
  return out.length ? out.join(" ").slice(0, 200) : null;
}

/**
 * The Engine's own picks for one clip, from its autoclip report. The webhook
 * sends the full form (with `finish`: layout, captions, headline); a poll
 * sends the short form, so the look falls back to what the job asked for.
 */
export function clipOriginal(clip: Record<string, unknown>, job: { aspect: string; options: unknown }): ClipOriginal {
  const finish = obj(clip["finish"]) ?? {};
  const framing = obj(finish["framing"]) ?? {};
  const asked = readJobOptions(job.options);
  const grades = obj(clip["grades"]);
  const gradeEntries = grades ? Object.entries(grades).filter(([, v]) => typeof v === "string").slice(0, 8) : [];
  const captions = Array.isArray(finish["captions"]) ? (finish["captions"] as { text?: unknown }[]) : [];
  const headline = str(finish["title_text"], 120);
  return {
    title: str(clip["title"], 120),
    startMs: int(clip["source_start_ms"] ?? clip["start_ms"]),
    endMs: int(clip["source_end_ms"] ?? clip["end_ms"]),
    durationMs: int(clip["duration_ms"]),
    score: int(clip["score"]),
    grades: gradeEntries.length ? Object.fromEntries(gradeEntries.map(([k, v]) => [k.slice(0, 20), String(v).slice(0, 4)])) : null,
    reason: str(clip["reason"]),
    sceneAnalysis: str(clip["scene_analysis"], 500),
    layout: str(finish["layout"], 40) ?? asked.layout ?? null,
    captionStyleId: str(finish["caption_style_id"], 60) ?? asked.captionStyleId ?? null,
    zoom: str(framing["zoom"], 20) ?? asked.zoom ?? null,
    focus: str(framing["focus"], 20),
    aspect: str(finish["aspect"], 10) ?? job.aspect,
    headline: headline ? { text: headline, style: str(finish["title_style"], 30) ?? asked.titleStyle ?? "bold_band" } : null,
    hookLine: hookLine(captions),
  };
}

/** A clip's look as the editor sees it (ClipSettings, less what is only for previews). */
export type ClipLook = {
  inMs: number; outMs: number; layout: string; zoom: string; aspect: string;
  styleId: string; captionsOn: boolean; captionPosition: string | null; captionSize: number; captionY: number | null;
  headline: { text: string; enabled: boolean; style: string; position: string };
};

/** The edits a save asks for, as far as the look goes. */
export type LookEdits = {
  layout?: string | undefined; zoom?: string | undefined; aspect?: string | undefined; styleId?: string | undefined;
  captionsOn?: boolean | undefined; captionPosition?: string | null | undefined; captionSize?: number | undefined; captionY?: number | null | undefined;
  headlineText?: string | undefined; headlineEnabled?: boolean | undefined; headlineStyle?: string | undefined; headlinePosition?: string | undefined;
};

/** The look after a save: the edits laid over what it was, with the trim the save settled on. */
export function lookAfter(before: ClipLook, edits: LookEdits, range: { inMs: number; outMs: number }): ClipLook {
  const pick = <T,>(v: T | undefined, was: T): T => (v === undefined ? was : v);
  return {
    inMs: range.inMs, outMs: range.outMs,
    layout: pick(edits.layout, before.layout), zoom: pick(edits.zoom, before.zoom), aspect: pick(edits.aspect, before.aspect),
    styleId: pick(edits.styleId, before.styleId), captionsOn: pick(edits.captionsOn, before.captionsOn),
    captionPosition: pick(edits.captionPosition, before.captionPosition), captionSize: pick(edits.captionSize, before.captionSize),
    captionY: pick(edits.captionY, before.captionY),
    headline: {
      text: edits.headlineText === undefined ? before.headline.text : edits.headlineText.trim().slice(0, 120),
      enabled: pick(edits.headlineEnabled, before.headline.enabled),
      style: pick(edits.headlineStyle, before.headline.style), position: pick(edits.headlinePosition, before.headline.position),
    },
  };
}

const CAPTION_CHANGES = new Set(["caption style", "captions on", "captions off", "caption position", "caption size", "caption words"]);
const HEADLINE_CHANGES = new Set(["headline", "headline on", "headline off", "headline style", "headline position"]);
const captionsOf = (l: ClipLook) => ({ styleId: l.styleId, captionsOn: l.captionsOn, position: l.captionPosition, size: l.captionSize, y: l.captionY });
const timesOf = (l: ClipLook) => ({ inMs: l.inMs, outMs: l.outMs, durationMs: l.outMs - l.inMs });

/**
 * One row per kind of change in a save, from the editor's own list of what
 * changed (saveClipEdits' `changed`). Corrected caption words are noted, never
 * copied: the words are the video's, and only the fact of fixing them is a lesson.
 */
export function editEvents(before: ClipLook, after: ClipLook, changed: readonly string[]): ClipEvent[] {
  const events: ClipEvent[] = [];
  if (changed.includes("trim")) events.push({ kind: "trimmed", before: timesOf(before), after: timesOf(after) });
  if (changed.includes("layout")) events.push({ kind: "layout_changed", before: { layout: before.layout }, after: { layout: after.layout } });
  if (changed.includes("zoom")) events.push({ kind: "zoom_changed", before: { zoom: before.zoom }, after: { zoom: after.zoom } });
  if (changed.includes("shape")) events.push({ kind: "shape_changed", before: { aspect: before.aspect }, after: { aspect: after.aspect } });
  const captionChanges = changed.filter((c) => CAPTION_CHANGES.has(c));
  if (captionChanges.length) events.push({ kind: "caption_changed", before: captionsOf(before), after: { ...captionsOf(after), changes: captionChanges } });
  const headlineChanges = changed.filter((c) => HEADLINE_CHANGES.has(c));
  if (headlineChanges.length) events.push({ kind: "headline_changed", before: { ...before.headline }, after: { ...after.headline, changes: headlineChanges } });
  return events;
}

export function titleEvent(before: string | null, after: string): ClipEvent | null {
  if ((before ?? "") === after) return null;
  return { kind: "title_changed", before: { title: before }, after: { title: after } };
}

export function postedEvent(clip: { title: string | null }, post: { platform: string; title: string; postId: string }): ClipEvent {
  return { kind: "posted", before: { title: clip.title }, after: { platform: post.platform, title: post.title, postId: post.postId } };
}

/** The clip row is deleted with its video, so what the Engine made goes into the event. */
export function deletedEvent(clip: { title: string | null; status: string; original: unknown }, scope: "video" | "all"): ClipEvent {
  return { kind: "deleted", before: { title: clip.title, status: clip.status, original: clip.original ?? null }, after: { scope } };
}
