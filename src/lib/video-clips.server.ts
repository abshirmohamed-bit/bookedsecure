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
import { browserUploadsReady, clipVideoKey, publicUrlFor, signedUploadUrl, uploadedSize } from "@/lib/clip-upload.server";
import { clipOriginal, type ClipEvent, deletedEvent, editEvents, lookAfter, titleEvent } from "@/lib/clip-learning";
import { recordClipEvents } from "@/lib/clip-learning.server";
import { channelLessons } from "@/lib/channel-lessons.server";
import { ACTIVE_JOB_STATUSES, applyLineEdits, applyWordFixes, CAPTION_POSITIONS, CAPTION_SIZE, type CaptionLineEdit, type CaptionPosition, type CaptionWord, checkTrim, CLIP_LAYOUTS, CLIP_ZOOMS, type ClipJobOptions, type ClipLayout, type ClipZoom, clipsToRender, FALLBACK_CAPTION_STYLES, isPublicVideoLink, mergeTrimmedWords, readJobOptions, TITLE_STYLES, type TitlePosition, type TitleStyle, isTemporaryEngineError, MAX_CLIP_INSTRUCTIONS, MAX_VIDEO_BYTES, MIN_CLIPS_PER_JOB, type VideoAspect } from "@/lib/video-clips";

type JobRow = Database["public"]["Tables"]["video_clip_jobs"]["Row"];
type ClipRow = Database["public"]["Tables"]["video_clips"]["Row"];
type EngineAsset = { id: string; status?: string; error?: string | null; thumbnail_url?: string; length?: number | null };
type EngineClip = Record<string, unknown>;
type EngineJob = { id: string; status: string; stage: string | null; progress: number; error: string | null; finder_note?: string | null; clips?: EngineClip[] };
type EngineExport = { id: string; status: string; error?: string | null; asset?: Record<string, unknown> | null };
export type ClipOptions = { aspect?: VideoAspect | undefined; clipCount?: number | null | undefined; instructions?: string | undefined; defaults?: ClipJobOptions | undefined };

const STUCK_MS = 5 * 60_000;
const now = () => new Date().toISOString();
const clipOptions = (o: ClipOptions) => ({
  ...(o.aspect ? { aspect: o.aspect } : {}),
  ...(o.clipCount !== undefined ? { clip_count: o.clipCount === null ? null : Math.max(MIN_CLIPS_PER_JOB, o.clipCount) } : {}),
  ...(o.instructions !== undefined ? { instructions: o.instructions.trim().slice(0, MAX_CLIP_INSTRUCTIONS) || null } : {}),
  ...(o.defaults !== undefined ? { options: Object.keys(o.defaults).length ? readJobOptions(o.defaults) : null } : {}),
});

/**
 * video_clip_jobs.options (migration 0059) holds how a video should be
 * clipped. Until Lovable applies it, PostgREST refuses the column; the write
 * is retried without it, so clipping never stops over a missing column.
 */
const MISSING_COLUMN = new Set(["PGRST204", "42703"]);
let warnedOptions = false;
async function writeJob<T>(run: (values: Record<string, unknown>) => PromiseLike<{ data: T | null; error: { code?: string; message: string } | null }>, values: Record<string, unknown>) {
  const first = await run(values);
  if (!first.error || !("options" in values) || !MISSING_COLUMN.has(first.error.code ?? "")) return first;
  if (!warnedOptions) { warnedOptions = true; console.warn("video_clip_jobs.options is missing: apply drizzle/migrations/0059_video_clip_options.sql; clipping defaults are ignored until then"); }
  const { options: _dropped, ...rest } = values;
  return run(rest);
}

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
export async function startUpload(input: { businessId: string; userId: string; filename: string; contentType: string; sizeBytes: number; options?: ClipOptions | undefined }) {
  if (input.sizeBytes > MAX_VIDEO_BYTES) throw new Error("Videos can be up to 4 GB.");
  const r = await engineClient<{ id: string; url: string; method?: string; headers?: Record<string, string> }>("POST", "/v1/uploads", {
    filename: input.filename, content_type: input.contentType, size_bytes: input.sizeBytes,
  });
  if (!r.ok) throw new Error(r.error.message);
  const { data, error } = await writeJob<{ id: string }>((values) => supabaseAdmin.from("video_clip_jobs").insert(values as never).select("id").single(), {
    business_id: input.businessId, created_by: input.userId, source_kind: "upload", source_name: input.filename.slice(0, 200),
    rights_confirmed: true, engine_upload_id: r.data.id, status: "UPLOADING", ...clipOptions(input.options ?? {}),
  });
  if (error || !data) throw new Error(error?.message ?? "The upload couldn't be recorded.");
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
export async function lookUpVideoLink(url: string, opts: { transcript?: boolean } = {}): Promise<VideoLinkDetails> {
  if (!isPublicVideoLink(url)) throw new Error("That needs to be a normal public https link to a video.");
  const r = await engineClient<VideoLinkDetails>("POST", "/v1/analyze", { url, transcript: opts.transcript ?? true }, { timeoutMs: 120_000 });
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

/** Clip a pasted link. The owner must already have confirmed they hold the rights. */
export async function clipFromLink(input: { businessId: string; userId: string; url: string; name?: string | undefined; options: ClipOptions }) {
  if (!isPublicVideoLink(input.url)) throw new Error("That needs to be a normal public https link to a video.");
  const r = await engineClient<EngineAsset>("POST", "/v1/assets", { url: input.url, name: input.name ?? "", rights_confirmed: true });
  if (!r.ok) throw new Error(r.error.message);
  const { data, error } = await writeJob<JobRow>((values) => supabaseAdmin.from("video_clip_jobs").insert(values as never).select("*").single(), {
    business_id: input.businessId, created_by: input.userId, source_kind: "link", source_name: (input.name || input.url).slice(0, 200), source_url: input.url,
    rights_confirmed: true, engine_asset_id: r.data.id, status: "IMPORTING", clip_requested: true, ...clipOptions(input.options),
  });
  if (error || !data) throw new Error(error?.message ?? "That video couldn't be recorded.");
  await advanceJob(data);
  return data;
}

/** Start cutting an uploaded video (or remember to, if it is still being prepared). */
export async function requestClips(businessId: string, jobId: string, options: ClipOptions) {
  const job = await ownJob(businessId, jobId);
  if (job.status === "FAILED" || job.status === "COMPLETED") throw new Error(job.status === "FAILED" ? (job.error ?? "That video couldn't be prepared. Upload it again.") : "That video has already been clipped.");
  const { data, error } = await writeJob<JobRow>((values) => supabaseAdmin.from("video_clip_jobs").update(values as never).eq("id", job.id).select("*").single(), {
    clip_requested: true, updated_at: now(), ...clipOptions(options), ...(job.status === "WAITING" ? { status: "QUEUED" } : {}),
  });
  if (error || !data) throw new Error(error?.message ?? "That video couldn't be updated.");
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
  // Read first: the clips go with their job, and what the Engine made for each is a lesson.
  let clipsQ = supabaseAdmin.from("video_clips").select("*").eq("business_id", businessId);
  if (jobId) clipsQ = clipsQ.eq("job_id", jobId);
  const { data: clips } = await clipsQ;
  let q = supabaseAdmin.from("video_clip_jobs").delete().eq("business_id", businessId);
  if (jobId) q = q.eq("id", jobId);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  if (jobId && !data?.length) throw new Error("That video no longer exists.");
  const gone = new Set((data ?? []).map((j) => j.id));
  await recordClipEvents(businessId, ((clips ?? []) as (ClipRow & { original?: unknown })[]).filter((c) => gone.has(c.job_id)).map((c) => ({
    ...deletedEvent({ title: c.title, status: c.status, original: c.original ?? null }, jobId ? "video" : "all"), clipId: c.id, jobId: c.job_id,
  })));
  return data?.length ?? 0;
}

/** Renames one of the caller's clips. Engine updates never overwrite it: clips are inserted once (ignoreDuplicates). */
export async function renameClip(businessId: string, clipId: string, title: string) {
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 100);
  if (!clean) throw new Error("Give the clip a title.");
  const clip = await ownClip(businessId, clipId);
  const { data, error } = await supabaseAdmin.from("video_clips").update({ title: clean, updated_at: now() }).eq("id", clipId).eq("business_id", businessId).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That clip no longer exists.");
  const event = titleEvent(clip.title, clean);
  if (event) await recordClipEvents(businessId, [{ ...event, clipId: clip.id, jobId: clip.job_id }]);
  return clean;
}

type EngineProject = {
  /** On the original video's timeline here (engineProject adds `offset`); the Engine's own times are offset-free. */
  in_ms: number; out_ms: number; aspect: string; layout: string; caption_style_id: string;
  /** Where the clip's own source starts in the original (a fetched section of a long video), and how long it is. */
  offset: number; sourceEndMs: number | null;
  /** The clip's own source video (a section of a long video, or the whole video), for live previews. */
  sourceUrl: string | null;
  caption_options: Record<string, unknown> | null; captions: CaptionWord[] | null;
  framing: Record<string, unknown> | null; title: Record<string, unknown> | null;
};
export type CatalogItem = { id: string; name: string; hint?: string | null; needs?: string | null };
export type CaptionStyle = { id: string; name: string; font: string; defaults: { size: number; position: string; animation: string } };
export type EngineCatalog = {
  /** False when the Engine could not be asked and these are the app's own copies. */
  live: boolean;
  layouts: CatalogItem[]; zoom: CatalogItem[]; captionPositions: CatalogItem[];
  captionSize: { min: number; max: number; default: number }; captionStyles: CaptionStyle[];
  titleStyles: CatalogItem[]; focus: CatalogItem[]; aspects: { id: string; w: number; h: number }[];
};
type RawCatalog = {
  layouts?: CatalogItem[]; zoom?: CatalogItem[]; caption_positions?: CatalogItem[];
  caption_size?: { min: number; max: number; default: number }; caption_styles?: CaptionStyle[];
  title_styles?: CatalogItem[]; focus?: CatalogItem[]; aspects?: { id: string; w: number; h: number }[];
};
const FALLBACK_CATALOG: EngineCatalog = {
  live: false,
  layouts: CLIP_LAYOUTS.map((l) => ({ id: l.id, name: l.label, hint: l.hint })),
  zoom: CLIP_ZOOMS.map((z) => ({ id: z.id, name: z.label, hint: z.hint })),
  captionPositions: CAPTION_POSITIONS.map((p) => ({ id: p, name: p === "lower" ? "Lower" : p === "middle" ? "Middle" : "Top" })),
  captionSize: { min: CAPTION_SIZE.min, max: CAPTION_SIZE.max, default: 1 },
  captionStyles: FALLBACK_CAPTION_STYLES,
  titleStyles: TITLE_STYLES.map((t) => ({ id: t.id, name: t.label, hint: t.hint })),
  focus: [{ id: "auto", name: "Let the finder decide" }, { id: "speaker", name: "Whoever is talking" }, { id: "reaction", name: "The other person's reaction" }, { id: "everyone", name: "Everyone in the shot" }],
  aspects: [{ id: "9:16", w: 1080, h: 1920 }, { id: "1:1", w: 1080, h: 1080 }, { id: "4:5", w: 1080, h: 1350 }, { id: "16:9", w: 1920, h: 1080 }],
};
let catalogCache: { at: number; catalog: EngineCatalog } | null = null;

/**
 * Every choice the Engine offers (GET /v1/catalog): layouts, zoom, caption
 * styles and positions, title styles, shapes. Studio's controls and the
 * assistants' tools are built from it. Cached briefly; when the Engine can't
 * be asked the app's own copy stands in, marked `live: false`.
 */
export async function engineCatalog(): Promise<EngineCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < 10 * 60_000) return catalogCache.catalog;
  const r = await engineClient<RawCatalog>("GET", "/v1/catalog");
  if (!r.ok) return catalogCache?.catalog ?? FALLBACK_CATALOG;
  const d = r.data;
  const catalog: EngineCatalog = {
    live: true,
    layouts: d.layouts?.length ? d.layouts : FALLBACK_CATALOG.layouts,
    zoom: d.zoom?.length ? d.zoom : FALLBACK_CATALOG.zoom,
    captionPositions: d.caption_positions?.length ? d.caption_positions : FALLBACK_CATALOG.captionPositions,
    captionSize: d.caption_size ?? FALLBACK_CATALOG.captionSize,
    captionStyles: d.caption_styles?.length ? d.caption_styles : FALLBACK_CATALOG.captionStyles,
    titleStyles: d.title_styles?.length ? d.title_styles : FALLBACK_CATALOG.titleStyles,
    focus: d.focus?.length ? d.focus : FALLBACK_CATALOG.focus,
    aspects: d.aspects?.length ? d.aspects : FALLBACK_CATALOG.aspects,
  };
  catalogCache = { at: Date.now(), catalog };
  return catalog;
}

/** The Engine's caption styles (part of the catalog; kept for callers that only need these). */
export async function captionStyles(): Promise<CaptionStyle[]> {
  return (await engineCatalog()).captionStyles;
}

async function ownClip(businessId: string, clipId: string): Promise<ClipRow> {
  const { data } = await supabaseAdmin.from("video_clips").select("*").eq("id", clipId).eq("business_id", businessId).maybeSingle();
  if (!data) throw new Error("That clip no longer exists.");
  return data;
}

async function engineProject(clip: ClipRow): Promise<EngineProject> {
  type Raw = Omit<EngineProject, "offset" | "sourceEndMs" | "sourceUrl"> & { source_offset_ms?: number; source_length_ms?: number; source_url?: string };
  const r = await engineClient<Raw>("GET", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}`);
  if (!r.ok) throw new Error(r.error.code === "NOT_FOUND" ? "The Engine no longer has this clip." : r.error.message);
  // A clip of a long video is cut from a fetched section; everything here works
  // on the original video's timeline, and toEngine() takes the offset back off.
  const offset = Math.max(0, Math.round(r.data.source_offset_ms ?? 0));
  const length = r.data.source_length_ms ?? 0;
  return {
    ...r.data, in_ms: r.data.in_ms + offset, out_ms: r.data.out_ms + offset, offset,
    sourceEndMs: offset && length ? offset + length : null, sourceUrl: r.data.source_url || null,
  };
}

/** A trim on the original timeline, as the Engine's section-relative times. */
function toEngine(project: EngineProject, inMs: number, outMs: number) {
  return { in_ms: inMs - project.offset, out_ms: outMs - project.offset };
}

/** A trim can only use the part of a long video that was fetched for the clip. */
function checkSection(project: EngineProject, inMs: number, outMs: number): string | null {
  if (!project.offset && project.sourceEndMs === null) return null;
  const from = project.offset;
  const to = project.sourceEndMs ?? Number.POSITIVE_INFINITY;
  if (inMs >= from && outMs <= to) return null;
  const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  return `This clip can be trimmed between ${clock(from)} and ${Number.isFinite(to) ? clock(to) : "the end"} of the original video.`;
}

export type ClipSettings = {
  styleId: string; captionsOn: boolean; captionPosition: CaptionPosition | null; captionSize: number;
  layout: string; zoom: string; aspect: string; focus: string; inMs: number; outMs: number;
  /** The latest a trim can end: the end of the fetched section for a long video, else null (the whole video). */
  trimTo: number | null;
  /** A dragged caption position, 0 (top) to 1 (bottom), or null for the preset. */
  captionY: number | null;
  /** For the live preview: the source video, and where its time 0 sits on the original timeline. */
  sourceUrl: string | null; sourceOffsetMs: number;
  headline: { text: string; enabled: boolean; style: string; position: string };
};

function settingsOf(project: EngineProject): ClipSettings {
  const options = project.caption_options ?? {};
  const framing = project.framing ?? {};
  const title = project.title ?? {};
  const size = Number(options["size"]);
  const position = options["position"];
  return {
    styleId: project.caption_style_id, captionsOn: options["enabled"] !== false,
    captionPosition: (CAPTION_POSITIONS as readonly unknown[]).includes(position) ? (position as CaptionPosition) : null,
    captionSize: Number.isFinite(size) && size > 0 ? size : 1,
    captionY: typeof options["y"] === "number" && Number.isFinite(options["y"]) ? (options["y"] as number) : null,
    layout: project.layout, zoom: typeof framing["zoom"] === "string" ? (framing["zoom"] as string) : "auto",
    aspect: project.aspect, focus: typeof framing["focus"] === "string" ? (framing["focus"] as string) : "auto",
    inMs: project.in_ms, outMs: project.out_ms, trimTo: project.sourceEndMs,
    sourceUrl: project.sourceUrl, sourceOffsetMs: project.offset,
    headline: {
      text: typeof title["text"] === "string" ? (title["text"] as string) : "", enabled: title["enabled"] !== false,
      style: typeof title["style"] === "string" ? (title["style"] as string) : "bold_band",
      position: typeof title["position"] === "string" ? (title["position"] as string) : "auto",
    },
  };
}

/** What the editor needs: the clip's current settings, its words and every choice on offer. */
export async function clipEditorData(businessId: string, clipId: string) {
  const clip = await ownClip(businessId, clipId);
  const [project, catalog] = await Promise.all([engineProject(clip), engineCatalog()]);
  return {
    catalog, settings: settingsOf(project), browserUploads: browserUploadsReady(),
    words: (project.captions ?? []).map((w) => ({ text: String(w.text ?? ""), start_ms: Math.round(w.start_ms), end_ms: Math.round(w.end_ms) })),
  };
}

export type ShotPlan = {
  layout: string; zoom: string; aspect: string; people: number;
  source: { w: number; h: number }; output: { w: number; h: number };
  cuts: number[]; summary: Record<string, number>;
  shots: { start_ms: number; end_ms: number; kind: string; zoom: number; why: string; base: string | null; window: PlanBox | null; pan: [number, number][]; cells: PlanBox[]; main: PlanBox | null; inset: PlanBox | null;
    /** The Engine's camera: [ms, x, y, w, h] every few frames (glides, breathing zoom, punch-ins). */
    motion: [number, number, number, number, number][];
    /** How the shot comes in (an ffmpeg xfade name); null for a straight cut. */
    transition: string | null }[];
};
/** A crop of the source, in source pixels. */
export type PlanBox = { x: number; y: number; w: number; h: number };

/**
 * How the Engine will cut this clip into shots and compose each one, for the
 * chosen or a tried layout, zoom and shape. The analysis behind it is cached
 * on the Engine per source and range; the first call on a clip can take a
 * little while.
 */
export async function clipPlan(businessId: string, clipId: string, tryOut: { layout?: string | undefined; zoom?: string | undefined; aspect?: string | undefined } = {}): Promise<ShotPlan> {
  const clip = await ownClip(businessId, clipId);
  const q = new URLSearchParams();
  if (tryOut.layout) q.set("layout", tryOut.layout);
  if (tryOut.zoom) q.set("zoom", tryOut.zoom);
  if (tryOut.aspect) q.set("aspect", tryOut.aspect);
  const r = await engineClient<ShotPlan & { shots: ShotPlan["shots"] }>("GET", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}/framing${q.size ? `?${q}` : ""}`, undefined, { timeoutMs: 150_000 });
  if (!r.ok) throw new Error(r.error.code === "NOT_FOUND" ? "The Engine no longer has this clip." : r.error.message);
  const d = r.data;
  return {
    layout: d.layout, zoom: d.zoom, aspect: d.aspect, people: d.people ?? 0, source: d.source, output: d.output,
    cuts: d.cuts ?? [], summary: d.summary ?? {},
    shots: (d.shots ?? []).map((s) => ({
      start_ms: s.start_ms, end_ms: s.end_ms, kind: s.kind, zoom: s.zoom, why: s.why, base: s.base ?? null,
      window: s.window ?? null, pan: s.pan ?? [], cells: s.cells ?? [], main: s.main ?? null, inset: s.inset ?? null,
      motion: Array.isArray(s.motion) ? s.motion : [], transition: typeof s.transition === "string" ? s.transition : null,
    })),
  };
}

export type ClipEdits = {
  styleId?: string | undefined; captionsOn?: boolean | undefined; captionPosition?: CaptionPosition | null | undefined;
  captionSize?: number | undefined; captionY?: number | null | undefined; layout?: ClipLayout | undefined; zoom?: ClipZoom | undefined; aspect?: VideoAspect | undefined;
  headlineText?: string | undefined; headlineEnabled?: boolean | undefined; headlineStyle?: TitleStyle | undefined; headlinePosition?: TitlePosition | undefined;
  /** Source-video times. */
  inMs?: number | undefined; outMs?: number | undefined;
  lineEdits?: CaptionLineEdit[] | undefined; wordFixes?: { wrong: string; right: string }[] | undefined;
};

/** The Engine's view of the edits: a PATCH body plus what it changes, in the owner's words. */
async function engineChanges(project: EngineProject, edits: ClipEdits): Promise<{ patch: Record<string, unknown>; changed: string[] }> {
  const patch: Record<string, unknown> = {};
  const changed: string[] = [];
  if (edits.styleId !== undefined) {
    const styles = await captionStyles();
    const want = edits.styleId.trim().toLowerCase();
    const style = styles.find((s) => s.id === want || s.name.toLowerCase() === want);
    if (!style) throw new Error(`There's no caption style called "${edits.styleId}". Choose from: ${styles.map((s) => s.name).join(", ")}.`);
    if (style.id !== project.caption_style_id) { patch["caption_style_id"] = style.id; changed.push("caption style"); }
  }
  const options: Record<string, unknown> = {};
  const current = project.caption_options ?? {};
  if (edits.captionsOn !== undefined && edits.captionsOn !== (current["enabled"] !== false)) { options["enabled"] = edits.captionsOn; changed.push(edits.captionsOn ? "captions on" : "captions off"); }
  if (edits.captionPosition !== undefined && (edits.captionPosition ?? null) !== (current["position"] ?? null)) { options["position"] = edits.captionPosition; changed.push("caption position"); }
  if (edits.captionY !== undefined) {
    const y = edits.captionY === null ? null : Math.round(Math.min(1, Math.max(0, edits.captionY)) * 1000) / 1000;
    const was = typeof current["y"] === "number" ? (current["y"] as number) : null;
    if (y !== was) { options["y"] = y; if (!changed.includes("caption position")) changed.push("caption position"); }
  }
  if (edits.captionSize !== undefined) {
    const size = Math.round(Math.min(CAPTION_SIZE.max, Math.max(CAPTION_SIZE.min, edits.captionSize)) * 100) / 100;
    if (size !== (Number(current["size"]) || 1)) { options["size"] = size; changed.push("caption size"); }
  }
  if (Object.keys(options).length) patch["caption_options"] = { ...current, ...options };
  if (edits.layout !== undefined && edits.layout !== project.layout) { patch["layout"] = edits.layout; changed.push("layout"); }
  if (edits.zoom !== undefined && edits.zoom !== ((project.framing ?? {})["zoom"] ?? "auto")) { patch["framing"] = { ...(project.framing ?? {}), zoom: edits.zoom }; changed.push("zoom"); }
  if (edits.aspect !== undefined && edits.aspect !== project.aspect) { patch["aspect"] = edits.aspect; changed.push("shape"); }
  const title = project.title ?? {};
  const titlePatch: Record<string, unknown> = {};
  if (edits.headlineText !== undefined && edits.headlineText.trim() !== ((title["text"] as string | undefined) ?? "")) { titlePatch["text"] = edits.headlineText.trim().slice(0, 120); changed.push("headline"); }
  if (edits.headlineEnabled !== undefined && edits.headlineEnabled !== (title["enabled"] !== false)) { titlePatch["enabled"] = edits.headlineEnabled; changed.push(edits.headlineEnabled ? "headline on" : "headline off"); }
  if (edits.headlineStyle !== undefined && edits.headlineStyle !== ((title["style"] as string | undefined) ?? "bold_band")) { titlePatch["style"] = edits.headlineStyle; changed.push("headline style"); }
  if (edits.headlinePosition !== undefined && edits.headlinePosition !== ((title["position"] as string | undefined) ?? "auto")) { titlePatch["position"] = edits.headlinePosition; changed.push("headline position"); }
  if (Object.keys(titlePatch).length) patch["title"] = { ...title, ...titlePatch };
  return { patch, changed };
}

/**
 * A quick preview of the clip with the editor's unsaved settings, rendered by
 * the Engine at half size. Nothing is saved; the clip's own preview and video
 * are untouched.
 */
export async function previewClipEdits(businessId: string, clipId: string, edits: ClipEdits): Promise<{ url: string }> {
  const clip = await ownClip(businessId, clipId);
  const project = await engineProject(clip);
  const { patch } = await engineChanges(project, edits);
  if (edits.inMs !== undefined || edits.outMs !== undefined) {
    const inMs = Math.round(edits.inMs ?? project.in_ms);
    const outMs = Math.round(edits.outMs ?? project.out_ms);
    const problem = checkTrim(inMs, outMs, null) ?? checkSection(project, inMs, outMs);
    if (problem) throw new Error(problem);
    Object.assign(patch, toEngine(project, inMs, outMs));
  }
  const r = await engineClient<{ preview_url: string }>("POST", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}/preview`, patch, { timeoutMs: 180_000 });
  if (!r.ok) throw new Error(r.error.message);
  return { url: r.data.preview_url };
}

/**
 * Saves the editor's changes to the clip's Engine project and makes the video
 * again. Claimed first from whatever settled status it had (READY included,
 * unlike startRender), so two saves can't race; the old export id is cleared
 * so a late poll of it can't mark the new video ready. A failure before the
 * Engine took the change puts the clip back as it was.
 */
/**
 * Saves the edits to the clip. Then either asks the Engine to make the video
 * again, or (`browser`) hands back everything the browser needs to make it
 * itself, plus a signed link to upload the result to; finishBrowserClip()
 * then puts that video on the clip.
 */
export async function saveClipEdits(businessId: string, clipId: string, edits: ClipEdits, opts: { browser?: boolean } = {}) {
  const clip = await ownClip(businessId, clipId);
  if (clip.status === "EXPORTING") throw new Error("This clip is still being made. Save again once it's finished.");
  const { data: job } = await supabaseAdmin.from("video_clip_jobs").select("duration_ms").eq("id", clip.job_id).eq("business_id", businessId).maybeSingle();

  const { data: claimed } = await supabaseAdmin.from("video_clips").update({ status: "EXPORTING", engine_export_id: null, error: null, updated_at: now() })
    .eq("id", clip.id).eq("status", clip.status).select("id").maybeSingle();
  if (!claimed) throw new Error("This clip is already being changed. Try again in a moment.");
  const restore = () => supabaseAdmin.from("video_clips").update({ status: clip.status, engine_export_id: clip.engine_export_id, error: clip.error, updated_at: now() })
    .eq("id", clip.id).eq("status", "EXPORTING").is("engine_export_id", null);
  const path = `/v1/projects/${encodeURIComponent(clip.engine_project_id)}`;
  let changed: string[] = [];
  let range: { inMs: number; outMs: number };
  let learned: ClipEvent[] = [];
  try {
    const project = await engineProject(clip);
    const plan = await engineChanges(project, edits);
    const patch = plan.patch;
    changed = plan.changed;
    const inMs = Math.round(edits.inMs ?? project.in_ms);
    const outMs = Math.round(edits.outMs ?? project.out_ms);
    const trimmed = inMs !== project.in_ms || outMs !== project.out_ms;
    if (trimmed) {
      const problem = checkTrim(inMs, outMs, job?.duration_ms ?? null) ?? checkSection(project, inMs, outMs);
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
      const r = await engineClient<EngineProject>("PATCH", path, { ...patch, ...toEngine(project, inMs, outMs) });
      if (!r.ok) throw new Error(r.error.message);
      const merged = mergeTrimmedWords(words, project.in_ms, project.out_ms, r.data.captions ?? [], inMs, outMs);
      const w = await engineClient("PATCH", path, { captions: merged });
      if (!w.ok) throw new Error(w.error.message);
    } else {
      const r = await engineClient("PATCH", path, { ...patch, ...(wordsEdited ? { captions: words } : {}) });
      if (!r.ok) throw new Error(r.error.message);
    }
    range = { inMs, outMs };
    // As saved: the style the name resolved to and the clamped caption size, not the raw request.
    const savedOptions = (patch["caption_options"] ?? {}) as Record<string, unknown>;
    const before = settingsOf(project);
    learned = editEvents(before, lookAfter(before, {
      ...edits,
      styleId: typeof patch["caption_style_id"] === "string" ? patch["caption_style_id"] : undefined,
      captionSize: typeof savedOptions["size"] === "number" ? savedOptions["size"] : undefined,
      captionY: "y" in savedOptions ? (savedOptions["y"] as number | null) : undefined,
    }, range), changed);
  } catch (error) {
    await restore();
    throw error;
  }
  await recordClipEvents(businessId, learned.map((e) => ({ ...e, clipId: clip.id, jobId: clip.job_id })));

  // The project has the change now: from here a failure is the video's, not the edit's.
  const times = { start_ms: range.inMs, end_ms: range.outMs, duration_ms: range.outMs - range.inMs, updated_at: now() };
  if (opts.browser && browserUploadsReady()) {
    // Stays EXPORTING with no Engine export until the browser's video arrives;
    // advanceBusiness hands it to the Engine if that never happens.
    await supabaseAdmin.from("video_clips").update(times).eq("id", clip.id);
    const saved = await engineProject(clip);
    const key = clipVideoKey(businessId, clip.id);
    return {
      changed, startMs: range.inMs, endMs: range.outMs,
      render: {
        key, uploadUrl: await signedUploadUrl(key),
        settings: settingsOf(saved),
        words: (saved.captions ?? []).map((w) => ({ text: String(w.text ?? ""), start_ms: Math.round(w.start_ms), end_ms: Math.round(w.end_ms) })),
      },
    };
  }
  const r = await engineClient<{ id: string }>("POST", `${path}/export`, { resolution: "1080p" });
  await supabaseAdmin.from("video_clips").update(
    r.ok ? { engine_export_id: r.data.id, ...times } : { status: "FAILED", error: `Your changes are saved, but the video couldn't be made: ${r.error.message}`.slice(0, 500), ...times },
  ).eq("id", clip.id);
  if (!r.ok) throw new Error("Your changes are saved, but the video couldn't be made. Press Try again.");
  return { changed, startMs: range.inMs, endMs: range.outMs, render: null };
}

/** Puts a video the browser made (and uploaded to `key`) on the clip. */
export async function finishBrowserClip(businessId: string, clipId: string, video: { key: string; width: number; height: number; durationMs: number }) {
  const clip = await ownClip(businessId, clipId);
  if (!video.key.startsWith(`browser-renders/${businessId}/${clip.id}/`)) throw new Error("That video doesn't belong to this clip.");
  const size = await uploadedSize(video.key);
  if (size < 1000) throw new Error("The video didn't upload. Try saving again.");
  const { data, error } = await supabaseAdmin.from("video_clips").update({
    status: "READY", video_url: publicUrlFor(video.key), width: video.width, height: video.height,
    duration_ms: Math.round(video.durationMs), error: null, updated_at: now(),
  }).eq("id", clip.id).eq("status", "EXPORTING").is("engine_export_id", null).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This clip changed while the video was being made. Open it again.");
  return { url: publicUrlFor(video.key), size };
}

/** The browser couldn't make the video: the Engine makes it from the saved settings instead. */
export async function engineFallback(businessId: string, clipId: string) {
  const clip = await ownClip(businessId, clipId);
  if (clip.status !== "EXPORTING" || clip.engine_export_id) return { started: false };
  const r = await engineClient<{ id: string }>("POST", `/v1/projects/${encodeURIComponent(clip.engine_project_id)}/export`, { resolution: "1080p" });
  await supabaseAdmin.from("video_clips").update(
    r.ok ? { engine_export_id: r.data.id, updated_at: now() } : { status: "FAILED", error: `The video couldn't be made: ${r.error.message}`.slice(0, 500), updated_at: now() },
  ).eq("id", clip.id).eq("status", "EXPORTING").is("engine_export_id", null);
  if (!r.ok) throw new Error("The video couldn't be made. Press Try again.");
  return { started: true };
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
  // A video the browser was making but never delivered (the tab closed, say): the Engine makes it instead.
  const { data: abandoned } = await supabaseAdmin.from("video_clips").select("id").eq("business_id", businessId).eq("status", "EXPORTING")
    .is("engine_export_id", null).lt("updated_at", new Date(Date.now() - BROWSER_RENDER_GRACE_MS).toISOString()).limit(6);
  for (const clip of abandoned ?? []) await engineFallback(businessId, clip.id).catch((e: unknown) => console.error("video fallback", clip.id, e));
}

/** How long a browser has to deliver a video it is making before the Engine takes over. */
const BROWSER_RENDER_GRACE_MS = 20 * 60_000;

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
  const o = readJobOptions(job.options);
  // Clip learning step 3: what has worked on this channel before, as data for the finder (never an instruction).
  const notes = await channelLessons(job.business_id).catch((e: unknown) => { console.error("channel lessons", e); return null; });
  const r = await engineClient<{ id: string }>("POST", "/v1/autoclip", {
    asset_id: job.engine_asset_id, coverage: "best", clip_count: job.clip_count ?? "auto", clip_length: "auto", genre: "auto", mode: "auto",
    prompt: job.instructions ?? "", confirm_count: false, edit_level: "full", aspect: job.aspect, formats: [o.layout ?? "auto"], framing: "auto",
    zoom: o.zoom ?? "auto", caption_style_id: o.captionStyleId ?? "bold_white",
    ...(o.captionPosition ? { caption_position: o.captionPosition } : {}), ...(o.captionSize ? { caption_size: o.captionSize } : {}),
    title_enabled: o.titleEnabled ?? true, title_style: o.titleStyle ?? "bold_band",
    ...(notes ? { channel_notes: notes } : {}),
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

let warnedOriginal = false;
const num = (v: unknown) => (typeof v === "number" ? Math.round(v) : null);
const text = (v: unknown) => (typeof v === "string" ? v : null);

async function jobCompleted(job: JobRow, clips: EngineClip[], note: string | null = null) {
  const rows = clips.filter((c) => typeof c["project_id"] === "string").map((c, i) => ({
    business_id: job.business_id, job_id: job.id, engine_project_id: c["project_id"] as string, position: num(c["index"]) ?? i + 1,
    title: text(c["title"]), reason: text(c["reason"]), score: typeof c["score"] === "number" ? c["score"] : null,
    // source_*: where the clip sits in the original (it differs for a long video's fetched sections)
    start_ms: num(c["source_start_ms"] ?? c["start_ms"]), end_ms: num(c["source_end_ms"] ?? c["end_ms"]),
    duration_ms: num(c["duration_ms"]), thumbnail_url: text(c["thumbnail_url"]),
    // What the Engine picked, kept unchanged so the owner's later edits can be compared with it.
    original: clipOriginal(c, job),
  }));
  // Unique per job and project, so a webhook racing a poll can't duplicate clips.
  if (rows.length) {
    const upsert = (values: Record<string, unknown>[]) => supabaseAdmin.from("video_clips").upsert(values as never, { onConflict: "job_id,engine_project_id", ignoreDuplicates: true });
    let { error } = await upsert(rows);
    // video_clips.original (docs/clip-learning.sql) may not be applied yet: save the clips without it.
    if (error && MISSING_COLUMN.has(error.code ?? "")) {
      if (!warnedOriginal) { warnedOriginal = true; console.warn("video_clips.original is missing: apply docs/clip-learning.sql; clips are saved without the Engine's picks until then"); }
      ({ error } = await upsert(rows.map(({ original: _dropped, ...rest }) => rest)));
    }
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
  // The finished file's own length is the truth; the finder's estimate can be missing or 0.
  const seconds = typeof asset["length"] === "number" && asset["length"] > 0 ? asset["length"] : null;
  await supabaseAdmin.from("video_clips").update({
    ...(seconds ? { duration_ms: Math.round(seconds * 1000) } : {}),
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
