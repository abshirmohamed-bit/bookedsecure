/**
 * Clip learning, step 3: a short, plain-text summary of what has worked on
 * one channel before, sent to the Engine's moment finder as `channel_notes`
 * (find.py's prompt: data about past results, never an instruction).
 *
 * Built from the Engine's own picks (video_clips.original, clip-learning.ts),
 * the owner's edits and deletes (video_clip_events), and a single comparable
 * score the caller picks per posted clip from its stats (metricValue, from
 * post-stats' PostInsights). Pure, so the heuristics here are fully tested
 * without a database. Below MIN_CLIPS_FOR_LESSONS scored clips there isn't
 * enough history yet, and this returns null: the Engine then works exactly
 * as it did before clip learning existed.
 */
import type { ClipEventKind, ClipOriginal } from "@/lib/clip-learning";
import type { PostInsights } from "@/lib/social-planner";

export const MIN_CLIPS_FOR_LESSONS = 5;
export const LESSONS_CHAR_CAP = 1200;
/** An edit kind is only worth mentioning once this many clips show it. */
const MIN_EDIT_SAMPLE = 3;
/** ...and at least this share of the clips that could have shown it. */
const EDIT_SHARE = 0.5;
const GOOD_EXAMPLES = 3;
const AVOID_EXAMPLES = 3;

export type LessonsClip = {
  id: string;
  /** What the Engine picked for this clip; null only if that was never recorded. */
  original: ClipOriginal | null;
  /** The clip (or its whole video) was deleted. */
  deleted: boolean;
  /** Every edit kind recorded for this clip, title/post excluded (those are tracked separately). */
  editKinds: ClipEventKind[];
  /**
   * One comparable figure for how its post did (metricValue), already
   * chosen by the caller from whichever stats it has. Null when the clip
   * was never posted, or nothing has been read yet.
   */
  score: number | null;
};

/**
 * One number to rank a post by, whatever platform or stats it has.
 * YouTube's average-view-percent (how much of the video people actually
 * watched) is the strongest signal and is used when present; otherwise an
 * engagement rate (likes+comments+shares+saves as a share of views) stands
 * in. Null when there isn't enough to compute either.
 */
export function metricValue(insights: Pick<PostInsights, "views" | "engagements" | "averageViewPercent">): number | null {
  if (typeof insights.averageViewPercent === "number") return insights.averageViewPercent;
  if (insights.views && insights.engagements !== null && insights.engagements !== undefined) {
    return Math.round((insights.engagements / insights.views) * 1000) / 10;
  }
  return null;
}

const EDIT_LABEL: Record<Exclude<ClipEventKind, "title_changed" | "posted" | "deleted">, string> = {
  trimmed: "the trim", layout_changed: "the layout", caption_changed: "the captions",
  zoom_changed: "the zoom", shape_changed: "the shape", headline_changed: "the headline wording",
};

function durationBucket(ms: number | null): string | null {
  if (ms === null) return null;
  if (ms < 30_000) return "under 30s";
  if (ms < 60_000) return "30-60s";
  if (ms < 90_000) return "60-90s";
  return "over 90s";
}

function mostCommon<T>(values: T[]): T | null {
  if (!values.length) return null;
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

/** Cuts to whole lines, never mid-sentence, so what remains always reads cleanly. */
function capped(lines: string[]): string {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = used + (used ? 1 : 0) + line.length;
    if (next > LESSONS_CHAR_CAP) break;
    out.push(line);
    used = next;
  }
  return out.join("\n");
}

export function buildChannelLessons(clips: LessonsClip[]): string | null {
  const posted = clips.filter((c) => c.score !== null);
  if (posted.length < MIN_CLIPS_FOR_LESSONS) return null;

  const ranked = [...posted].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topHalf = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 2)));
  const bottomHalf = ranked.slice(Math.floor(ranked.length / 2));

  const lines: string[] = [];

  const goodHooks = topHalf.map((c) => c.original?.hookLine ?? c.original?.title).filter((v): v is string => Boolean(v)).slice(0, GOOD_EXAMPLES);
  if (goodHooks.length) lines.push(`Best-performing openings here: ${goodHooks.map((h) => `"${h}"`).join("; ")}.`);

  const layout = mostCommon(topHalf.map((c) => c.original?.layout).filter((v): v is string => Boolean(v) && v !== "auto"));
  if (layout) lines.push(`The layout that does best on this channel is "${layout}".`);

  const bucket = mostCommon(topHalf.map((c) => durationBucket(c.original?.durationMs ?? null)).filter((v): v is string => Boolean(v)));
  if (bucket) lines.push(`Clips around ${bucket} tend to do best.`);

  const avoidSource = [...clips.filter((c) => c.deleted), ...bottomHalf.filter((c) => !c.deleted)];
  const avoid = avoidSource.map((c) => c.original?.title).filter((v): v is string => Boolean(v)).slice(0, AVOID_EXAMPLES);
  if (avoid.length) lines.push(`Titles that didn't land or were deleted: ${avoid.map((t) => `"${t}"`).join("; ")}.`);

  const editCounts = new Map<string, number>();
  for (const c of clips) for (const k of c.editKinds) editCounts.set(k, (editCounts.get(k) ?? 0) + 1);
  const editLines: string[] = [];
  for (const [kind, count] of editCounts) {
    const label = EDIT_LABEL[kind as keyof typeof EDIT_LABEL];
    if (label && count >= MIN_EDIT_SAMPLE && count / clips.length >= EDIT_SHARE) {
      editLines.push(`The owner usually changes ${label} after the Engine picks it.`);
    }
  }
  lines.push(...editLines);

  if (!lines.length) return null;
  return capped(lines);
}
