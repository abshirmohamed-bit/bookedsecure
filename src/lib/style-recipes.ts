/**
 * Clip learning, step 4 (Hermes phase 4): each business's own style recipes.
 *
 * From what the Engine made (video_clips.original) and what the owner did
 * with it (video_clip_events: layout/caption/zoom/headline changes, posts,
 * deletes) this works out:
 *  - per kind of clip (the style review's vibe), the layout the owner ends up
 *    with, sent to the Engine as `style_recipes` so its style review puts that
 *    look first whenever a clip can take it;
 *  - a house style (caption style, position and size, zoom, headline style)
 *    used as the job's defaults where the owner didn't choose them.
 *
 * A change counts most (the owner moved to that look), a post next (they kept
 * it and put it out), a delete counts against what the Engine made. Nothing
 * is learned until a look has clear support from several clips. Pure: no
 * database here, so every rule is tested.
 */
import type { ClipEventKind, ClipOriginal } from "@/lib/clip-learning";
import { CAPTION_POSITIONS, CAPTION_SIZE, CLIP_ZOOM_IDS, TITLE_STYLE_IDS, layoutName, type CaptionPosition, type ClipZoom, type TitleStyle } from "@/lib/video-clips";

export type RecipeEvent = { kind: ClipEventKind; before: Record<string, unknown> | null; after: Record<string, unknown> | null };
export type RecipeClip = { original: ClipOriginal | null; deleted: boolean; posted: boolean; events: RecipeEvent[] };

export const VIBE_LABELS: Record<string, string> = {
  conversation: "two people talking back and forth", group: "a group with several people talking",
  screen_speaker: "a screen with the speaker on camera", screen: "screen recordings and slides",
  reaction: "one person talking while the other reacts", interview: "interviews (two in shot, one talking)",
  together: "two people close together", talking_head: "one person talking to camera",
  narrated: "footage with someone talking over it", action: "action shots", wide: "wide scenes and places",
  mixed: "mixed clips",
};
const LAYOUTS = new Set(["auto", "full-video", "split", "grid", "screen", "pip", "streamer", "black-box", "title-subtitles"]);

export const WEIGHT = { changedTo: 3, changedFrom: -2, posted: 2, deleted: -1 } as const;
/** A look is learned with at least this score… */
export const MIN_SCORE = 4;
/** …from at least this many clips… */
export const MIN_CLIPS = 2;
/** …and clearly ahead of the next one (the runner-up scores below this share of it). */
export const LEAD = 0.67;

type Tally = Map<string, { score: number; clips: number }>;
const add = (t: Tally, value: string | null | undefined, weight: number) => {
  if (!value) return;
  const row = t.get(value) ?? { score: 0, clips: 0 };
  row.score += weight;
  if (weight > 0) row.clips += 1;
  t.set(value, row);
};

/** The value a tally settles on, or null when nothing is clear yet. */
export function winner(t: Tally): { value: string; score: number; clips: number } | null {
  const ranked = [...t.entries()].sort((a, b) => b[1].score - a[1].score);
  const [top, next] = ranked;
  if (!top) return null;
  const [value, row] = top;
  if (row.score < MIN_SCORE || row.clips < MIN_CLIPS) return null;
  if (next && next[1].score > 0 && next[1].score >= row.score * LEAD) return null;
  return { value, score: row.score, clips: row.clips };
}

/** The last value an event kind set for one field, if the owner changed it. */
function lastAfter(events: RecipeEvent[], kind: ClipEventKind, field: string): unknown {
  let out: unknown;
  for (const e of events) if (e.kind === kind && e.after && field in e.after) out = e.after[field];
  return out;
}

const asStr = (v: unknown, allowed?: ReadonlySet<string> | readonly string[]): string | null => {
  if (typeof v !== "string" || !v) return null;
  if (!allowed) return v.slice(0, 60);
  const ok = allowed instanceof Set ? allowed.has(v) : (allowed as readonly string[]).includes(v);
  return ok ? v : null;
};
const sizeKey = (v: unknown) => (typeof v === "number" && v >= CAPTION_SIZE.min && v <= CAPTION_SIZE.max ? (Math.round(v * 10) / 10).toFixed(1) : null);

/**
 * Votes for one field of one clip: a change moves the owner to its last value
 * (and away from the Engine's), a post keeps whatever it ended with, a delete
 * counts against what the Engine made.
 */
function vote(t: Tally, clip: RecipeClip, original: string | null, changed: string | null) {
  if (changed && changed !== original) {
    add(t, changed, WEIGHT.changedTo);
    add(t, original, WEIGHT.changedFrom);
    return;
  }
  if (clip.posted) add(t, changed ?? original, WEIGHT.posted);
  else if (clip.deleted) add(t, original, WEIGHT.deleted);
}

export type HouseStyle = {
  captionStyleId?: string; captionPosition?: CaptionPosition; captionSize?: number; zoom?: ClipZoom; titleStyle?: TitleStyle;
};
export type StyleRecipes = {
  /** vibe → layout, as sent to the Engine. */
  layouts: Record<string, string>;
  /** How many clips each learned layout rests on. */
  evidence: Record<string, number>;
  house: HouseStyle;
  /** Clips the owner changed, posted or deleted (what anything could be learned from). */
  clipsUsed: number;
};

export function learnStyleRecipes(clips: readonly RecipeClip[]): StyleRecipes {
  const byVibe = new Map<string, Tally>();
  const caption: Tally = new Map(), position: Tally = new Map(), size: Tally = new Map(), zoom: Tally = new Map(), title: Tally = new Map();
  let used = 0;
  for (const clip of clips) {
    const o = clip.original;
    if (!o) continue;
    const touched = clip.posted || clip.deleted || clip.events.some((e) => e.kind !== "title_changed" && e.kind !== "posted");
    if (!touched) continue;
    used += 1;
    const ev = clip.events;
    if (o.vibe) {
      const t = byVibe.get(o.vibe) ?? new Map();
      vote(t, clip, asStr(o.layout, LAYOUTS), asStr(lastAfter(ev, "layout_changed", "layout"), LAYOUTS));
      byVibe.set(o.vibe, t);
    }
    vote(caption, clip, asStr(o.captionStyleId), asStr(lastAfter(ev, "caption_changed", "styleId")));
    vote(position, clip, asStr(o.captionPosition ?? null, CAPTION_POSITIONS), asStr(lastAfter(ev, "caption_changed", "position"), CAPTION_POSITIONS));
    vote(size, clip, sizeKey(o.captionSize), sizeKey(lastAfter(ev, "caption_changed", "size")));
    vote(zoom, clip, asStr(o.zoom, CLIP_ZOOM_IDS), asStr(lastAfter(ev, "zoom_changed", "zoom"), CLIP_ZOOM_IDS));
    vote(title, clip, asStr(o.headline?.style ?? null, TITLE_STYLE_IDS), asStr(lastAfter(ev, "headline_changed", "style"), TITLE_STYLE_IDS));
  }

  const layouts: Record<string, string> = {};
  const evidence: Record<string, number> = {};
  for (const [vibe, t] of byVibe) {
    if (!(vibe in VIBE_LABELS)) continue;
    const w = winner(t);
    if (w) { layouts[vibe] = w.value; evidence[vibe] = w.clips; }
  }
  const house: HouseStyle = {};
  const c = winner(caption); if (c) house.captionStyleId = c.value;
  const p = winner(position); if (p) house.captionPosition = p.value as CaptionPosition;
  const s = winner(size); if (s) house.captionSize = Number(s.value);
  const z = winner(zoom); if (z) house.zoom = z.value as ClipZoom;
  const h = winner(title); if (h) house.titleStyle = h.value as TitleStyle;
  return { layouts, evidence, house, clipsUsed: used };
}

/** The recipes in the owner's words, for Co-Work and Studio. */
export function describeRecipes(r: StyleRecipes, names: { caption?: (id: string) => string } = {}): string[] {
  const lines = Object.entries(r.layouts).map(([vibe, layout]) =>
    `For ${VIBE_LABELS[vibe] ?? vibe}: ${layoutName(layout)} (from ${r.evidence[vibe] ?? 0} clips).`);
  const h = r.house;
  if (h.captionStyleId) lines.push(`Captions: ${names.caption ? names.caption(h.captionStyleId) : h.captionStyleId}.`);
  if (h.captionPosition) lines.push(`Captions sit ${h.captionPosition === "lower" ? "low" : h.captionPosition === "top" ? "at the top" : "in the middle"}.`);
  if (h.captionSize) lines.push(`Caption size ${Math.round(h.captionSize * 100)}%.`);
  if (h.zoom) lines.push(`Zoom: ${h.zoom === "off" ? "no zoom" : h.zoom === "moments" ? "punch in on key moments" : "automatic"}.`);
  if (h.titleStyle) lines.push(`Headline style: ${h.titleStyle.replace(/_/g, " ")}.`);
  return lines;
}
