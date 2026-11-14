/**
 * Loads one business's clip history and learns its style recipes
 * (lib/style-recipes). Reads only, always filtered by the business, and never
 * throws: a failure here must never stop a clip job, so the caller gets null
 * and the Engine works exactly as before.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ClipEventKind, ClipOriginal } from "@/lib/clip-learning";
import { learnStyleRecipes, type RecipeClip, type RecipeEvent, type StyleRecipes } from "@/lib/style-recipes";

const db = () => supabaseAdmin as unknown as SupabaseClient;
const HISTORY_LIMIT = 400;

type ClipRow = { id: string; original: ClipOriginal | null };
type EventRow = { clip_id: string | null; kind: ClipEventKind; before: Record<string, unknown> | null; after: Record<string, unknown> | null };

export async function styleRecipes(businessId: string): Promise<StyleRecipes | null> {
  try {
    const [clipsRes, eventsRes] = await Promise.all([
      db().from("video_clips").select("id, original").eq("business_id", businessId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT),
      db().from("video_clip_events").select("clip_id, kind, before, after").eq("business_id", businessId).order("created_at", { ascending: false }).limit(HISTORY_LIMIT * 3),
    ]);
    if (clipsRes.error || eventsRes.error) return null;
    // Oldest first, so the last change to a field is the one that counts.
    const events = ((eventsRes.data ?? []) as EventRow[]).reverse();
    const byClip = new Map<string, RecipeEvent[]>();
    const deletedGone: RecipeClip[] = [];
    for (const e of events) {
      if (!e.clip_id) {
        // The clip row went with its video; the delete kept what the Engine made.
        if (e.kind === "deleted" && e.before?.["original"]) {
          deletedGone.push({ original: e.before["original"] as ClipOriginal, deleted: true, posted: false, events: [] });
        }
        continue;
      }
      const list = byClip.get(e.clip_id) ?? [];
      list.push({ kind: e.kind, before: e.before, after: e.after });
      byClip.set(e.clip_id, list);
    }
    const clips: RecipeClip[] = ((clipsRes.data ?? []) as ClipRow[]).map((c) => {
      const ev = byClip.get(c.id) ?? [];
      return { original: c.original, events: ev, posted: ev.some((e) => e.kind === "posted"), deleted: ev.some((e) => e.kind === "deleted") };
    });
    return learnStyleRecipes([...clips, ...deletedGone]);
  } catch (e) {
    console.error("style recipes", e);
    return null;
  }
}
