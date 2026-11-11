import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CAPTION_POSITIONS, CAPTION_SIZE, CLIP_LAYOUT_IDS, CLIP_ZOOM_IDS, TITLE_POSITIONS, TITLE_STYLE_IDS, VIDEO_ASPECTS } from "@/lib/video-clips";

/** How a whole video should be clipped: the same choices the editor offers per clip. */
const JOB_DEFAULTS = z.object({
  layout: z.enum(CLIP_LAYOUT_IDS).optional(),
  zoom: z.enum(CLIP_ZOOM_IDS).optional(),
  captionStyleId: z.string().trim().min(1).max(60).optional(),
  captionPosition: z.enum(CAPTION_POSITIONS).optional(),
  captionSize: z.number().min(CAPTION_SIZE.min).max(CAPTION_SIZE.max).optional(),
  titleEnabled: z.boolean().optional(),
  titleStyle: z.enum(TITLE_STYLE_IDS).optional(),
}).strict();

/** Everything being clipped for this business, and whether clipping is switched on. */
export const getVideoClips = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { engineConfigured, listVideoJobs } = await import("@/lib/video-clips.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    return { configured: engineConfigured(), jobs: await listVideoJobs(ctx.businessId) };
  });

/** Whether the video engine is on, idle or off. Only operators see why. */
export const getEngineState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { isEngineOperator, readEngineState } = await import("@/lib/engine-control.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const [reading, canControl] = await Promise.all([readEngineState(), isEngineOperator(ctx.userId)]);
    if (canControl) return { ...reading, canControl };
    const detail = reading.state === "on" ? "Ready to cut video." : reading.state === "idle" ? "Asleep until a video needs cutting." : "Video clipping is unavailable right now.";
    return { state: reading.state, label: reading.state === "off" ? "Off" : reading.label, detail, canControl };
  });

/** Every choice the Engine offers: layouts, zoom, caption styles and positions, title styles, shapes. */
export const getEngineCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { engineCatalog } = await import("@/lib/video-clips.server");
    await requireAppContext(context.supabase, context.userId);
    return engineCatalog();
  });

export const startVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    filename: z.string().trim().min(1).max(300),
    contentType: z.string().regex(/^video\//).max(100),
    sizeBytes: z.number().int().positive(),
    defaults: JOB_DEFAULTS.optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { startUpload } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { defaults, ...file } = data;
    return startUpload({ businessId: ctx.businessId, userId: ctx.userId, ...file, options: defaults ? { defaults } : undefined });
  });

export const finishVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid(), failure: z.string().max(300).optional() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { finishUpload } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    return { status: await finishUpload(ctx.businessId, data.jobId, data.failure) };
  });

/** The owner ticked that they hold the rights and pressed Clip on Co-Work's card. */
export const clipVideoLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    url: z.string().url().max(2000),
    name: z.string().trim().max(200).optional(),
    rightsConfirmed: z.literal(true),
    defaults: JOB_DEFAULTS.optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { clipFromLink } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const job = await clipFromLink({ businessId: ctx.businessId, userId: ctx.userId, url: data.url, name: data.name, options: data.defaults ? { defaults: data.defaults } : {} });
    return { jobId: job.id };
  });

export const renderVideoClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clipId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { renderClip } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    await renderClip(ctx.businessId, data.clipId);
    return { ok: true };
  });

/** Deletes one clip job (and its clips) or, without jobId, every one of the business's. */
export const deleteVideoJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid().optional() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { deleteClipJobs } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    return { deleted: await deleteClipJobs(ctx.businessId, data.jobId) };
  });

export const renameVideoClip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clipId: z.string().uuid(), title: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { renameClip } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    return { title: await renameClip(ctx.businessId, data.clipId, data.title) };
  });

/** The clip editor's data: current settings, caption words and every choice the Engine offers. */
export const getVideoClipEditor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clipId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { clipEditorData } = await import("@/lib/video-clips.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    return clipEditorData(ctx.businessId, data.clipId);
  });

/** How the Engine would cut this clip into shots for the chosen (or a tried) layout, zoom and shape. */
export const getVideoClipPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    clipId: z.string().uuid(),
    layout: z.enum(CLIP_LAYOUT_IDS).optional(),
    zoom: z.enum(CLIP_ZOOM_IDS).optional(),
    aspect: z.enum(VIDEO_ASPECTS).optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { clipPlan } = await import("@/lib/video-clips.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { clipId, ...tryOut } = data;
    return clipPlan(ctx.businessId, clipId, tryOut);
  });

/** The edits the editor can make to one clip; shared by preview and save. */
const CLIP_EDITS = {
  styleId: z.string().trim().min(1).max(60).optional(),
  captionsOn: z.boolean().optional(),
  captionPosition: z.enum(CAPTION_POSITIONS).nullable().optional(),
  captionSize: z.number().min(CAPTION_SIZE.min).max(CAPTION_SIZE.max).optional(),
  layout: z.enum(CLIP_LAYOUT_IDS).optional(),
  zoom: z.enum(CLIP_ZOOM_IDS).optional(),
  aspect: z.enum(VIDEO_ASPECTS).optional(),
  headlineText: z.string().max(120).optional(),
  headlineEnabled: z.boolean().optional(),
  headlineStyle: z.enum(TITLE_STYLE_IDS).optional(),
  headlinePosition: z.enum(TITLE_POSITIONS).optional(),
  inMs: z.number().int().min(0).optional(),
  outMs: z.number().int().min(0).optional(),
};

/** A quick half-size preview of the clip with unsaved settings. Nothing is saved. */
export const previewVideoClipEdits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clipId: z.string().uuid(), ...CLIP_EDITS }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { previewClipEdits } = await import("@/lib/video-clips.server");
    const ctx = await requireAppContext(context.supabase, context.userId);
    const { clipId, ...edits } = data;
    return previewClipEdits(ctx.businessId, clipId, edits);
  });

/** Saves caption style, words, layout, zoom, shape, headline and trim to the clip, then makes the video again. */
export const saveVideoClipEdits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    clipId: z.string().uuid(),
    ...CLIP_EDITS,
    lineEdits: z.array(z.object({ start_ms: z.number().int(), from: z.string().max(400), to: z.string().max(400) })).max(2000).optional(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { saveClipEdits } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const { clipId, ...edits } = data;
    return saveClipEdits(ctx.businessId, clipId, edits);
  });
