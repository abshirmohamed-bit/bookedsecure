/**
 * Writing clip-learning rows (video_clip_events, docs/clip-learning.sql).
 *
 * Learning must never get in the way of the work it watches: a failed write
 * is logged and dropped, and until Lovable applies the migration nothing is
 * written at all (one warning per process). Rows are server-written and
 * read only by the business they belong to.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ClipEvent } from "@/lib/clip-learning";

const db = () => supabaseAdmin as unknown as SupabaseClient;

/** PostgREST / Postgres codes for a table or column that doesn't exist yet. */
export const MISSING_SCHEMA = new Set(["42P01", "PGRST205", "PGRST204", "42703"]);
let warned = false;
function warnMissing() {
  if (warned) return;
  warned = true;
  console.warn("video_clip_events is missing: apply docs/clip-learning.sql (drizzle 0065); clip learning records nothing until then");
}

export type ClipRef = { clipId: string | null; jobId: string | null };

/** Records what happened to clips of one business. Never throws. */
export async function recordClipEvents(businessId: string, rows: (ClipEvent & ClipRef)[], createdBy?: string | null): Promise<void> {
  if (!rows.length) return;
  try {
    const { error } = await db().from("video_clip_events").insert(rows.map((r) => ({
      business_id: businessId, clip_id: r.clipId, job_id: r.jobId, kind: r.kind,
      before: r.before, after: r.after, created_by: createdBy ?? null,
    })));
    if (!error) return;
    if (MISSING_SCHEMA.has(error.code ?? "")) warnMissing();
    else console.error("clip learning", error.message);
  } catch (e) {
    console.error("clip learning", e);
  }
}
