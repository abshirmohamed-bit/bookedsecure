/**
 * Driving the video Engine for each business. The Engine cuts the video and
 * knows nothing about businesses; every row here carries business_id, and every
 * engine id is only ever reached through a row of the caller's own business.
 * Completion normally arrives by signed webhook; advancing is the fallback when
 * one is lost, and both end up in the same conditional updates.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { engineClient, engineConfigured } from "@/lib/engine.server";
import { ACTIVE_JOB_STATUSES, applyLineEdits, applyWordFixes, type CaptionLineEdit, type CaptionWord, checkTrim, type ClipLayout, clipsToRender, isPublicVideoLink, mergeTrimmedWords, isTemporaryEngineError, MAX_CLIP_INSTRUCTIONS, MAX_VIDEO_BYTES, MIN_CLIPS_PER_JOB, type VideoAspect } from "@/lib/video-clips";

type JobRow = Database["public"]["Tables"]["video_clip_jobs"]["Row"];
type ClipRow = Database["public"]["Tables"]["video_clips"]["Row"];
type EngineAsset = { id: string; status?: string; error?: string | null; thumbnail_url?: string; length?: number | null };
type EngineClip = Record<string, unknown>;
type EngineJob = { id: string; status: string; stage: string | null; progress: number; error: string | null; finder_note?: string | null; clips?: EngineClip[] };
type EngineExport = { id: string; status: string; error?: string | null; asset?: Record<string, unknown> | null };
export type ClipOptions = { aspect?: VideoAspect | undefined; clipCount?: number | null | undefined; instructions?: string | undefined };

const STUCK_MS = 5 * 60_000;
const now = () => new Date().toISOString();
const clipOptions = (o: ClipOptions) => ({
  ...(o.aspect ? { aspect: o.aspect } : {}),
  ...(o.clipCount !== undefined ? { clip_count: o.clipCount === null ? null : Math.max(MIN_CLIPS_PER_JOB, o.clipCount) } : {}),
  ...(o.instructions !== undefined ? { instructions: o.instructions.trim().slice(0, MAX_CLIP_INSTRUCTIONS) || null } : {}),
});

export { engineConfigured };

export async function listVideoJobs(businessId: string) {
  await advanceBusiness(businessId).catch((e: unknown) => console.error("video advance", e));
  const { data: jobs, error } = await supabaseAdmin.from("video_clip_jobs").select("*").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  const ids = (jobs ?? []).map((j) => j.id);
  const { data: clips, error: clipError } = ids.length
    ? await supabaseAdmin.from("video_clips").select("*").eq("business_id", businessId).in("job_id", ids).order("position")
    : { data: [] as ClipRow[], error: null };
  if (clipError) throw new Error(clipError.message);
  return (jobs ?? []).map((job) => ({ ...job, clips: (clips ?? []).filter((c) => c.job_id === job.id) }));
}

/** Reserves an upload on the Engine. The browser then sends the file straight there. */
export async function startUpload(input: { businessId: string; userId: string; filename: string; contentType: string; sizeBytes: number }) {
  if (input.sizeBytes > MAX_VIDEO_BYTES) throw new Error("Videos can be up to 4 GB.");
  const r = await engineClient<{ id: string; url: string; method?: string; headers?: Record<string, string> }>("POST", "/v1/uploads", {
    filename: input.filename, content_type: input.contentType, size_bytes: input.sizeBytes,
  });
  if (!r.ok) throw new Error(r.error.message);
  const { data, error } = await supabaseAdmin.from("video_clip_jobs").insert({
    business_id: input.businessId, created_by: input.userId, source_kind: "upload", source_name: input.filename.slice(0, 200),
    rights_confirmed: true, engine_upload_id: r.data.id, status: "UPLOADING",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { jobId: data.id, url: r.data.url, method: r.data.method ?? "PUT", headers: r.data.headers ?? {} };
}

export async function finishUpload(businessId: string, jobId: string, failure?: string) {
  const job = await ownJob(businessId, jobId);
  if (job.status !== "UPLOADING") return job.status;
  if (failure) { await failJob(job, failure); return "FAILED"; }
  await supabaseAdmin.from("video_clip_jobs").update({ status: "INGESTING", updated_at: now() }).eq("id", job.id).eq("status", "UPLOADING");
  // A long video can take minutes to prepare. If this answer times out the Engine
  // carries on, and advancing picks the result up from GET /v1/uploads/{id}.
  const r = await engineClient<EngineAsset>("POST", `/v1/uploads/${encodeURIComponent(job.engine_upload_id ?? "")}/complete`, undefined, { timeoutMs: 25_000, wake: false });
  if (r.ok) { await assetReached({ ...job, status: "INGESTING" }, r.data); return "INGESTING"; }
  if (isTemporaryEngineError(r.error.code)) return "INGESTING";
  await failJob(job, r.error.message);
  return "FAILED";
}

export type VideoLinkDetails = {
  url: string; title: string; channel: string; duration_ms: number; thumbnail_url: string; quality: string;
  description: string; transcript: { start_ms: number; end_ms: number; text: string }[]; transcript_language: string;
  subtitle_languages: string[]; chapters: { title: string; start_ms: number; end_ms: number }[]; needs_rights: boolean;
};

/** Read a pasted link's details and captions. Nothing is downloaded or stored. */
export async function lookUpVideoLink(url: string): Promise<VideoLinkDetails> {
  if (!isPublicVideoLink(url)) throw new Error("That needs to be a normal public https link to a video.");
  const r = await engineClient<VideoLinkDetails>("POST", "/v1/analyze", { url, transcript: true }, { timeoutMs: 120_000 });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

/** Clip a pasted link. The owner must already have confirmed they hold the rights. */
export async function clipFromLink(input: { businessId: string; userId: string; url: string; name?: string | undefined; options: ClipOptions }) {
  if (!isPublicVideoLink(input.url)) throw new Error("That needs to be a normal public https link to a video.");
  const r = await engineClient<EngineAsset>("POST", "/v1/assets", { url: input.url, name: input.name ?? "", rights_confirmed: true });
  if (!r.ok) throw new Error(r.error.message);
  const { data, error } = await supabaseAdmin.from("video_clip_jobs").insert({
    business_id: input.businessId, created_by: input.userId, source_kind: "link", source_name: (input.name || input.url).slice(0, 200), source_url: input.url,
    rights_confirmed: true, engine_asset_id: r.data.id, status: "IMPORTING", clip_requested: true, ...clipOptions(input.options),
  }).select("*").single();
  if (error) throw new Error(error.message);
  await advanceJob(data);
  return data;
}

/** Start cutting an uploaded video (or remember to, if it is still being prepared). */
export async function requestClips(businessId: string, jobId: string, options: ClipOptions) {
  const job = await ownJob(businessId, jobId);
  if (job.status === "FAILED" || job.status === "COMPLETED") throw new Error(job.status === "FAILED" ? (job.error ?? "That video couldn't be prepared. Upload it again.") : "That video has already been clipped.");
  const { data, error } = await supabaseAdmin.from("video_clip_jobs").update({
    clip_requested: true, updated_at: now(), ...clipOptions(options), ...(job.status === "WAITING" ? { status: "QUEUED" } : {}),
  }).eq("id", job.id).select("*").single();
  if (error) throw new Error(error.message);
  await advanceJob(data);
  return data;
}

export async function renderClip(businessId: string, clipId: string) {
  const { data: clip } = await supabaseAdmin.from("video_clips").select("*").eq("id", clipId).eq("business_id", businessId).maybeSingle();
  if (!clip) throw new Error("That clip no longer exists.");
  await startRender(clip);
}

/**
 * Removes clip work from the business's Results: one job (jobId) or all of it.
 * Clips go with their job (ON DELETE CASCADE); late Engine webhooks find no row
 * and are ignored. Files already on the Engine stay there until its retention.
 */
export async function deleteClipJobs(businessId: string, jobId?: string) {
  let q = supabaseAdmin.from("video_clip_jobs").delete().eq("business_id", businessId);
  if (jobId) q = q.eq("id", jobId);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  if (jobId && !data?.length) throw new Error("That video no longer exists.");
  return data?.length ?? 0;
}

/** Renames one of the caller's clips. Engine updates never overwrite it: clips are inserted once (ignoreDuplicates). */
export async function renameClip(businessId: string, clipId: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!clean) throw new Error("Give the clip a title.");
  const { data, error } = await supabaseAdmin.from("video_clips").update({ title: clean, updated_at: now() }).eq("id", clipId).eq("business_id", businessId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That clip no longer exists.");
  return clean;
}

type EngineProject = {
  in_ms: number; out_ms: number; aspect: string; layout: string; caption_style_id: string;
  caption_options: Record<string, unknown> | null; captions: CaptionWord[] | null;
};
export type CaptionStyle = { id: string; name: string; font: string; defaults: { size: number; position: string; animation: string } };
let styleCache: { at: number; styles: CaptionStyle[] } | null = null;

/** The Engine's caption styles. They are code on the Engine, so a short cache is safe. */
export async function captionStyles(): Promise<CaptionStyle[]> {
  if (styleCache && Date.now() - styleCache.at < 10 * 60_000) return styleCache.styles;
  const r = await engineClient<{ styles: CaptionStyle[] }>("GET", "/v1/subtitle-styles");
  if (!r.ok) throw new Error(r.error.message);
  styleCache = { at: Date.now(), styles: r.data.styles ?? [] };
  return styleCache.styles;
}

async function ownClip(businessId: string, clipId: string): Promise<ClipRow> {
  const { data } = await supabaseAdmin.from("video_clips").select("*").eq("id", clipId).eq("business_id", businessId).maybeSingle();
  if (!data) throw new Error("That clip no longer exists.");
  return data;
}

async function engineProject(clip: ClipRow): Promise<EngineProject> {
  const r = await engineClient<EngineProject>("GET", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}`);
  if (!r.ok) throw new Error(r.error.code === "NOT_FOUND" ? "The Engine no longer has this clip." : r.error.message);
  return r.data;
}

/** What the editor needs: the clip's current settings, its words and the styles on offer. */
export async function clipEditorData(businessId: string, clipId: string) {
  const clip = await ownClip(businessId, clipId);
  const [project, styles] = await Promise.all([engineProject(clip), captionStyles()]);
  return {
    styles,
    settings: {
      styleId: project.caption_style_id, captionsOn: project.caption_options?.["enabled"] !== false,
      layout: project.layout, aspect: project.aspect, inMs: project.in_ms, outMs: project.out_ms,
    },
    words: (project.captions ?? []).map((w) => ({ text: String(w.text ?? ""), start_ms: Math.round(w.start_ms), end_ms: Math.round(w.end_ms) })),
  };
}

export type ClipEdits = {
  styleId?: string | undefined; captionsOn?: boolean | undefined; layout?: ClipLayout | undefined; aspect?: VideoAspect | undefined;
  /** Source-video times. */
  inMs?: number | undefined; outMs?: number | undefined;
  lineEdits?: CaptionLineEdit[] | undefined; wordFixes?: { wrong: string; right: string }[] | undefined;
};

/**
 * Saves the editor's changes to the clip's Engine project and makes the video
 * again. Claimed first from whatever settled status it had (READY included,
 * unlike startRender), so two saves can't race; the old export id is cleared
 * so a late poll of it can't mark the new video ready. A failure before the
 * Engine took the change puts the clip back as it was.
 */
export async function saveClipEdits(businessId: string, clipId: string, edits: ClipEdits) {
  const clip = await ownClip(businessId, clipId);
  if (clip.status === "EXPORTING") throw new Error("This clip is still being made. Save again once it's finished.");
  const { data: job } = await supabaseAdmin.from("video_clip_jobs").select("duration_ms").eq("id", clip.job_id).eq("business_id", businessId).maybeSingle();

  const { data: claimed } = await supabaseAdmin.from("video_clips").update({ status: "EXPORTING", engine_export_id: null, error: null, updated_at: now() })
    .eq("id", clip.id).eq("status", clip.status).select("id").maybeSingle();
  if (!claimed) throw new Error("This clip is already being changed. Try again in a moment.");
  const restore = () => supabaseAdmin.from("video_clips").update({ status: clip.status, engine_export_id: clip.engine_export_id, error: clip.error, updated_at: now() })
    .eq("id", clip.id).eq("status", "EXPORTING").is("engine_export_id", null);
  const path = `/v1/projects/${encodeURIComponent(clip.engine_project_id)}`;
  const changed: string[] = [];
  let range: { inMs: number; outMs: number };
  try {
    const project = await engineProject(clip);
    const patch: Record<string, unknown> = {};
    if (edits.styleId !== undefined) {
      const styles = await captionStyles();
      const want = edits.styleId.trim().toLowerCase();
      const style = styles.find((s) => s.id === want || s.name.toLowerCase() === want);
      if (!style) throw new Error(`There's no caption style called "${edits.styleId}". Choose from: ${styles.map((s) => s.name).join(", ")}.`);
      if (style.id !== project.caption_style_id) { patch["caption_style_id"] = style.id; changed.push("caption style"); }
    }
    if (edits.captionsOn !== undefined && edits.captionsOn !== (project.caption_options?.["enabled"] !== false)) {
      patch["caption_options"] = { ...(project.caption_options ?? {}), enabled: edits.captionsOn };
      changed.push(edits.captionsOn ? "captions on" : "captions off");
    }
    if (edits.layout !== undefined && edits.layout !== project.layout) { patch["layout"] = edits.layout; changed.push("layout"); }
    if (edits.aspect !== undefined && edits.aspect !== project.aspect) { patch["aspect"] = edits.aspect; changed.push("shape"); }
    const inMs = Math.round(edits.inMs ?? project.in_ms);
    const outMs = Math.round(edits.outMs ?? project.out_ms);
    const trimmed = inMs !== project.in_ms || outMs !== project.out_ms;
    if (trimmed) {
      const problem = checkTrim(inMs, outMs, job?.duration_ms ?? null);
      if (problem) throw new Error(problem);
      changed.push("trim");
    }
    let words = project.captions ?? [];
    const wordsBefore = JSON.stringify(words);
    if (edits.lineEdits?.length) words = applyLineEdits(words, edits.lineEdits);
    if (edits.wordFixes?.length) {
      const fixed = applyWordFixes(words, edits.wordFixes);
      if (!fixed.changed) throw new Error(`None of ${edits.wordFixes.map((f) => `"${f.wrong}"`).join(", ")} is said in this clip's captions.`);
      words = fixed.words;
    }
    const wordsEdited = JSON.stringify(words) !== wordsBefore;
    if (wordsEdited) changed.push("caption words");
    if (!changed.length) throw new Error("Nothing has changed, so there's nothing to re-make.");

    if (trimmed) {
      // The Engine re-cuts the words from the transcript on a trim; put the
      // corrected ones (this save's or an earlier one's) back over the top.
      const r = await engineClient<EngineProject>("PATCH", path, { ...patch, in_ms: inMs, out_ms: outMs });
      if (!r.ok) throw new Error(r.error.message);
      const merged = mergeTrimmedWords(words, project.in_ms, project.out_ms, r.data.captions ?? [], inMs, outMs);
      const w = await engineClient("PATCH", path, { captions: merged });
      if (!w.ok) throw new Error(w.error.message);
    } else {
      const r = await engineClient("PATCH", path, { ...patch, ...(wordsEdited ? { captions: words } : {}) });
      if (!r.ok) throw new Error(r.error.message);
    }
    range = { inMs, outMs };
  } catch (error) {
    await restore();
    throw error;
  }

  // The project has the change now: from here a failure is the video's, not the edit's.
  const r = await engineClient<{ id: string }>("POST", `${path}/export`, { resolution: "1080p" });
  const times = { start_ms: range.inMs, end_ms: range.outMs, duration_ms: range.outMs - range.inMs, updated_at: now() };
  await supabaseAdmin.from("video_clips").update(
    r.ok ? { engine_export_id: r.data.id, ...times } : { status: "FAILED", error: `Your changes are saved, but the video couldn't be made: ${r.error.message}`.slice(0, 500), ...times },
  ).eq("id", clip.id);
  if (!r.ok) throw new Error("Your changes are saved, but the video couldn't be made. Press Try again.");
  return { changed, startMs: range.inMs, endMs: range.outMs };
}

async function startRender(clip: ClipRow) {
  const { data: claimed } = await supabaseAdmin.from("video_clips").update({ status: "EXPORTING", error: null, updated_at: now() })
    .eq("id", clip.id).in("status", ["FOUND", "FAILED"]).select("id").maybeSingle();
  if (!claimed) return;
  const r = await engineClient<{ id: string }>("POST", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}/export`, { resolution: "1080p" });
  await supabaseAdmin.from("video_clips").update(
    r.ok ? { engine_export_id: r.data.id, updated_at: now() } : { status: "FAILED", error: r.error.message, updated_at: now() },
  ).eq("id", clip.id);
}

/** Move this business's unfinished work along. Called while its Social page is open. */
async function advanceBusiness(businessId: string) {
  if (!engineConfigured()) return;
  const { data: jobs } = await supabaseAdmin.from("video_clip_jobs").select("*").eq("business_id", businessId).in("status", [...ACTIVE_JOB_STATUSES]).order("created_at").limit(3);
  for (const job of jobs ?? []) await advanceJob(job).catch((e: unknown) => console.error("video job", job.id, e));
  const { data: clips } = await supabaseAdmin.from("video_clips").select("*").eq("business_id", businessId).eq("status", "EXPORTING").not("engine_export_id", "is", null).limit(6);
  for (const clip of clips ?? []) await pollExport(clip).catch((e: unknown) => console.error("video export", clip.id, e));
}

/** The safety net for lost webhooks, run by the scheduled follow-ups hook. */
export async function advanceAllVideoJobs(limit = 10): Promise<number> {
  if (!engineConfigured()) return 0;
  const { data: jobs } = await supabaseAdmin.from("video_clip_jobs").select("*").in("status", [...ACTIVE_JOB_STATUSES]).order("updated_at").limit(limit);
  for (const job of jobs ?? []) await advanceJob(job).catch((e: unknown) => console.error("video job", job.id, e));
  const { data: clips } = await supabaseAdmin.from("video_clips").select("*").eq("status", "EXPORTING").not("engine_export_id", "is", null).order("updated_at").limit(limit);
  for (const clip of clips ?? []) await pollExport(clip).catch((e: unknown) => console.error("video export", clip.id, e));
  return (jobs?.length ?? 0) + (clips?.length ?? 0);
}

async function advanceJob(job: JobRow): Promise<void> {
  if (job.status === "INGESTING" && job.engine_upload_id) {
    const r = await engineClient<{ asset: EngineAsset | null }>("GET", `/v1/uploads/${encodeURIComponent(job.engine_upload_id)}`);
    if (r.ok && r.data.asset) await assetReached(job, r.data.asset);
  } else if (job.status === "IMPORTING" && job.engine_asset_id) {
    const r = await engineClient<EngineAsset>("GET", `/v1/assets/${encodeURIComponent(job.engine_asset_id)}`);
    if (r.ok) await assetReached(job, r.data);
    else if (r.error.code === "NOT_FOUND") await failJob(job, "The Engine no longer has that video. Send the link again.");
  } else if (job.status === "QUEUED") {
    await submit(job);
  } else if (job.status === "PROCESSING") {
    if (job.engine_job_id) await pollJob(job);
    else if (Date.now() - Date.parse(job.updated_at) > STUCK_MS) {
      await supabaseAdmin.from("video_clip_jobs").update({ status: "QUEUED", updated_at: now() }).eq("id", job.id).eq("status", "PROCESSING").is("engine_job_id", null);
    }
  }
}

async function assetReached(job: JobRow, asset: EngineAsset) {
  if (asset.status === "failed") { await failJob(job, typeof asset.error === "string" ? asset.error : "That video couldn't be prepared."); return; }
  if (asset.status !== "ready") {
    if (asset.id !== job.engine_asset_id) await supabaseAdmin.from("video_clip_jobs").update({ engine_asset_id: asset.id }).eq("id", job.id);
    return;
  }
  const { data } = await supabaseAdmin.from("video_clip_jobs").update({
    engine_asset_id: asset.id, status: "WAITING", thumbnail_url: asset.thumbnail_url || job.thumbnail_url,
    duration_ms: asset.length != null ? Math.round(asset.length * 1000) : job.duration_ms, error: null, updated_at: now(),
  }).eq("id", job.id).in("status", ["INGESTING", "IMPORTING"]).select("*").maybeSingle();
  if (!data) return;
  // Asked for clips while the video was still being prepared: start now.
  const { data: queued } = await supabaseAdmin.from("video_clip_jobs").update({ status: "QUEUED", updated_at: now() }).eq("id", data.id).eq("status", "WAITING").eq("clip_requested", true).select("*").maybeSingle();
  if (queued) await submit(queued);
}

async function submit(job: JobRow) {
  if (!job.engine_asset_id) { await failJob(job, "That video isn't ready to be cut."); return; }
  // Claimed first, so two open tabs can't start the same job twice.
  const { data: claimed } = await supabaseAdmin.from("video_clip_jobs").update({ status: "PROCESSING", stage: "TRANSCRIBING", progress: 5, updated_at: now() }).eq("id", job.id).eq("status", "QUEUED").select("id").maybeSingle();
  if (!claimed) return;
  const r = await engineClient<{ id: string }>("POST", "/v1/autoclip", {
    asset_id: job.engine_asset_id, coverage: "best", clip_count: job.clip_count ?? "auto", clip_length: "auto", genre: "auto", mode: "auto",
    prompt: job.instructions ?? "", confirm_count: false, edit_level: "full", aspect: job.aspect, formats: ["auto"], framing: "auto", caption_style_id: "bold_white",
  });
  if (r.ok) { await supabaseAdmin.from("video_clip_jobs").update({ engine_job_id: r.data.id, updated_at: now() }).eq("id", job.id); return; }
  if (isTemporaryEngineError(r.error.code)) {
    await supabaseAdmin.from("video_clip_jobs").update({ status: "QUEUED", stage: null, progress: 0, updated_at: now() }).eq("id", job.id);
    return;
  }
  await failJob(job, r.error.message);
}

async function pollJob(job: JobRow) {
  const r = await engineClient<EngineJob>("GET", `/v1/autoclip/${encodeURIComponent(job.engine_job_id ?? "")}`);
  if (!r.ok) return;
  if (r.data.status === "completed") await jobCompleted(job, r.data.clips ?? [], r.data.finder_note ?? null);
  else if (r.data.status === "failed") await failJob(job, r.data.error ?? "The clips couldn't be made.");
  else if (r.data.progress !== job.progress || (r.data.stage ?? "").toUpperCase() !== job.stage) {
    await supabaseAdmin.from("video_clip_jobs").update({ stage: (r.data.stage ?? "").toUpperCase() || job.stage, progress: Math.round(r.data.progress), updated_at: now() }).eq("id", job.id);
  }
}

const num = (v: unknown) => (typeof v === "number" ? Math.round(v) : null);
const text = (v: unknown) => (typeof v === "string" ? v : null);

async function jobCompleted(job: JobRow, clips: EngineClip[], note: string | null = null) {
  const rows = clips.filter((c) => typeof c["project_id"] === "string").map((c, i) => ({
    business_id: job.business_id, job_id: job.id, engine_project_id: c["project_id"] as string, position: num(c["index"]) ?? i + 1,
    title: text(c["title"]), reason: text(c["reason"]), score: typeof c["score"] === "number" ? c["score"] : null,
    start_ms: num(c["start_ms"]), end_ms: num(c["end_ms"]), duration_ms: num(c["duration_ms"]), thumbnail_url: text(c["thumbnail_url"]),
  }));
  // Unique per job and project, so a webhook racing a poll can't duplicate clips.
  if (rows.length) {
    const { error } = await supabaseAdmin.from("video_clips").upsert(rows, { onConflict: "job_id,engine_project_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  const { data: first } = await supabaseAdmin.from("video_clip_jobs").update({ status: "COMPLETED", stage: null, progress: 100, error: note, updated_at: now() }).eq("id", job.id).neq("status", "COMPLETED").select("id").maybeSingle();
  if (!first) return;
  const { data: saved } = await supabaseAdmin.from("video_clips").select("*").eq("job_id", job.id);
  for (const clip of clipsToRender(saved ?? [])) await startRender(clip);
}

async function failJob(job: JobRow, message: string) {
  await supabaseAdmin.from("video_clip_jobs").update({ status: "FAILED", stage: null, error: message.slice(0, 500), updated_at: now() }).eq("id", job.id).neq("status", "COMPLETED");
}

async function pollExport(clip: ClipRow) {
  const r = await engineClient<EngineExport>("GET", `/v1/exports/${encodeURIComponent(clip.engine_export_id ?? "")}`);
  if (!r.ok) return;
  if (r.data.status === "completed" && r.data.asset) await exportFinished(clip.id, r.data.asset);
  else if (r.data.status === "failed") await exportFailed(clip.id, r.data.error ?? "The clip couldn't be rendered.");
}

async function exportFinished(clipId: string, asset: Record<string, unknown>) {
  await supabaseAdmin.from("video_clips").update({
    status: "READY", video_url: text(asset["url"]), width: num(asset["width"]), height: num(asset["height"]),
    ...(typeof asset["thumbnail_url"] === "string" ? { thumbnail_url: asset["thumbnail_url"] } : {}), error: null, updated_at: now(),
  }).eq("id", clipId).eq("status", "EXPORTING");
}

async function exportFailed(clipId: string, message: string) {
  await supabaseAdmin.from("video_clips").update({ status: "FAILED", error: message.slice(0, 500), updated_at: now() }).eq("id", clipId).eq("status", "EXPORTING");
}

/** Applies one signed Engine webhook. Anything that isn't ours is ignored. */
export async function applyVideoEngineEvent(ev: { type: string; data: Record<string, unknown> | null }): Promise<void> {
  const d = ev.data ?? {};
  if (ev.type === "autoclip.completed" || ev.type === "autoclip.failed") {
    const { data: job } = await supabaseAdmin.from("video_clip_jobs").select("*").eq("engine_job_id", String(d["autoclip_id"] ?? "")).maybeSingle();
    if (!job) return;
    if (ev.type === "autoclip.failed") await failJob(job, text(d["error"]) ?? "The clips couldn't be made.");
    else await jobCompleted(job, Array.isArray(d["clips"]) ? (d["clips"] as EngineClip[]) : [], text(d["finder_note"]));
  } else if (ev.type === "export.completed" || ev.type === "export.failed") {
    const { data: clip } = await supabaseAdmin.from("video_clips").select("id").eq("engine_export_id", String(d["export_id"] ?? "")).maybeSingle();
    if (!clip) return;
    if (ev.type === "export.failed") await exportFailed(clip.id, text(d["error"]) ?? "The clip couldn't be rendered.");
    else await exportFinished(clip.id, (d["asset"] ?? {}) as Record<string, unknown>);
  } else if (ev.type === "asset.imported" || ev.type === "asset.failed") {
    const { data: job } = await supabaseAdmin.from("video_clip_jobs").select("*").eq("engine_asset_id", String(d["asset_id"] ?? "")).in("status", ["INGESTING", "IMPORTING"]).maybeSingle();
    if (!job) return;
    if (ev.type === "asset.failed") await failJob(job, text(d["error"]) ?? "That video couldn't be prepared.");
    else await assetReached(job, { id: String(d["asset_id"]), status: "ready", ...(typeof d["thumbnail_url"] === "string" ? { thumbnail_url: d["thumbnail_url"] } : {}), length: typeof d["length_ms"] === "number" ? d["length_ms"] / 1000 : null });
  }
}

async function ownJob(businessId: string, jobId: string): Promise<JobRow> {
  const { data } = await supabaseAdmin.from("video_clip_jobs").select("*").eq("id", jobId).eq("business_id", businessId).maybeSingle();
  if (!data) throw new Error("That video no longer exists.");
  return data;
}
