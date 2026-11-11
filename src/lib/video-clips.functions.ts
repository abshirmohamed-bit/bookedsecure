import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

export const startVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    filename: z.string().trim().min(1).max(300),
    contentType: z.string().regex(/^video\//).max(100),
    sizeBytes: z.number().int().positive(),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { startUpload } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    return startUpload({ businessId: ctx.businessId, userId: ctx.userId, ...data });
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
  }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { clipFromLink } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    const job = await clipFromLink({ businessId: ctx.businessId, userId: ctx.userId, url: data.url, name: data.name, options: {} });
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

export const renameVideoClip =createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ clipId: z.string().uuid(), title: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { renameClip } = await import("@/lib/video-clips.server");
    const ctx = await requireWriteContext(context.supabase, context.userId);
    return { title: await renameClip(ctx.businessId, data.clipId, data.title) };
  });
