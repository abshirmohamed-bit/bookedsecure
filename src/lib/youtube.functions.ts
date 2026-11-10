import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { YOUTUBE_DESCRIPTION_MAX, YOUTUBE_MAX_BYTES, YOUTUBE_TITLE_MAX } from "./youtube";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function member(context: { supabase: any; userId: string }) {
  const { requireAppContext } = await import("./app-context.server");
  return requireAppContext(context.supabase, context.userId);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function owner(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

/** Connection state and recent videos for the YouTube tab. */
export const getYouTube = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await member(context);
    const { youTubeStatus, listYouTubeVideos } = await import("./youtube.server");
    const [status, videos] = await Promise.all([youTubeStatus(ctx.businessId), listYouTubeVideos(ctx.businessId)]);
    return { ...status, isOwner: ctx.role !== "staff", videos };
  });

/** The Google sign-in address for this owner. */
export const startYouTubeConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await owner(context);
    const { youTubeLoginUrl } = await import("./youtube.server");
    return { url: youTubeLoginUrl(ctx.businessId, ctx.userId) };
  });

export const disconnectYouTubeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await owner(context);
    const { disconnectYouTube } = await import("./youtube.server");
    await disconnectYouTube(ctx.businessId, ctx.userId);
    return { ok: true };
  });

/** AI writes a title and description from the owner's brief. Nothing is uploaded. */
export const writeYouTubeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brief: z.string().max(2000), chips: z.array(z.string().max(60)).max(8).default([]) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { draftLinkedInPost } = await import("./linkedin.server");
    const { splitDraft } = await import("./youtube");
    const { text } = await draftLinkedInPost({ businessId: ctx.businessId, brief: data.brief, chips: data.chips, platform: "youtube" });
    return splitDraft(text);
  });

/** Uploading starts only when the owner presses Upload; the browser then sends the pieces. */
export const startYouTubeVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    title: z.string().max(YOUTUBE_TITLE_MAX),
    description: z.string().max(YOUTUBE_DESCRIPTION_MAX).default(""),
    privacy: z.enum(["public", "unlisted", "private"]),
    publishAt: z.string().datetime({ offset: true }).nullable().default(null),
    madeForKids: z.boolean(),
    fileSize: z.number().int().positive().max(YOUTUBE_MAX_BYTES),
    mimeType: z.string().max(100),
  }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { startYouTubeUpload } = await import("./youtube.server");
    return startYouTubeUpload({ ...data, businessId: ctx.businessId, userId: ctx.userId, source: "app" });
  });

export const abandonYouTubeVideoUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ postId: z.string().uuid(), reason: z.string().max(300) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { abandonYouTubeUpload } = await import("./youtube.server");
    await abandonYouTubeUpload(ctx.businessId, data.postId, data.reason);
    return { ok: true };
  });
