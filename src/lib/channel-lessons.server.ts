/**
 * Clip learning, step 3: loading one business's clip history and turning it
 * into the short summary sent to the Engine as `channel_notes`.
 *
 * Reads only (video_clips, video_clip_events, linkedin_posts): nothing here
 * writes. Never throws — a failure here must never stop a clip job, so the
 * caller (video-clips.server.ts submit()) gets null and the Engine works
 * exactly as it did before clip learning existed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ClipEventKind, ClipOriginal } from "@/lib/clip-learning";
import { buildChannelLessons, type LessonsClip, metricValue } from "@/lib/channel-lessons";

const db = () => supabaseAdmin as unknown as SupabaseClient;
/** How many of a business's most recent clips/events feed the lessons. */
const HISTORY_LIMIT = 300;

type ClipRow = { id: string; job_id: string; title: string | null; original: ClipOriginal | null };
type EventRow = { clip_id: string | null; kind: ClipEventKind; before: Record<string, unknown> | null };
type PostRow = { id: string; video_clip_id: string | null; platform: string; insights: Record<string, unknown> | null };

export async function channelLessons(businessId: string): Promise<string | null> {
  try {
    const [clipsRes, eventsRes, postsRes] = await Promise.all([
      db().from("video_clips").select("id, job_id, title, original").eq("business_id", businessId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
      db().from("video_clip_events").select("clip_id, kind, before").eq("business_id", businessId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
      db().from("linkedin_posts").select("id, video_clip_id, platform, insights").eq("business_id", businessId).not("video_clip_id", "is", null).limit(HISTORY_LIMIT),
    ]);
    if (clipsRes.error || eventsRes.error || postsRes.error) return null;

    const clips = (clipsRes.data ?? []) as ClipRow[];
    const events = (eventsRes.data ?? []) as EventRow[];
    const posts = (postsRes.data ?? []) as PostRow[];

    const scoreByClip = new Map<string, number>();
    for (const post of posts) {
      if (!post.video_clip_id || !post.insights) continue;
      const score = metricValue(post.insights as never);
      if (score === null) continue;
      // Best of several posts (e.g. YouTube and Instagram for the same clip).
      const was = scoreByClip.get(post.video_clip_id);
      if (was === undefined || score > was) scoreByClip.set(post.video_clip_id, score);
    }

    const editsByClip = new Map<string, ClipEventKind[]>();
    const deletedIds = new Set<string>();
    const deletedExtras: LessonsClip[] = [];
    for (const e of events) {
      if (!e.clip_id) {
        // The clip row (and any live edits) are gone, but the delete kept what the Engine made.
        if (e.kind === "deleted" && e.before) {
          deletedExtras.push({ id: `deleted-${deletedExtras.length}`, deleted: true, editKinds: [], score: null, original: (e.before["original"] as ClipOriginal | undefined) ?? null });
        }
        continue;
      }
      if (e.kind === "deleted") { deletedIds.add(e.clip_id); continue; }
      if (e.kind === "title_changed" || e.kind === "posted") continue;
      const list = editsByClip.get(e.clip_id) ?? [];
      list.push(e.kind);
      editsByClip.set(e.clip_id, list);
    }

    const lessonsClips: LessonsClip[] = [
      ...clips.map((c) => ({
        id: c.id, original: c.original, deleted: deletedIds.has(c.id),
        editKinds: editsByClip.get(c.id) ?? [], score: scoreByClip.get(c.id) ?? null,
      })),
      ...deletedExtras,
    ];
    return buildChannelLessons(lessonsClips);
  } catch (e) {
    console.error("channel lessons", e);
    return null;
  }
}
