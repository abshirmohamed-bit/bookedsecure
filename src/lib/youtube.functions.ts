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

// ----- Insights and comments -----

/** Channel totals, latest uploads (long/short by the 4-minute rule) and 28-day analytics. Read-only. */
export const getYouTubeInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await member(context);
    const { channelInsights } = await import("./youtube-insights.server");
    return channelInsights(ctx.businessId);
  });

/** AI title ideas for the latest long-form videos. Nothing is changed on YouTube. */
export const suggestYouTubeVideoTitles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ videos: z.array(z.object({ id: z.string().max(40), title: z.string().max(200), views: z.number().int().min(0) })).max(5) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { suggestYouTubeTitles } = await import("./youtube-insights.server");
    return suggestYouTubeTitles(ctx.businessId, data.videos);
  });

export const getYouTubeComments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await member(context);
    const { listYouTubeComments } = await import("./youtube-insights.server");
    return listYouTubeComments(ctx.businessId);
  });

export const suggestYouTubeCommentReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ text: z.string().max(2000), videoTitle: z.string().max(200).nullable().default(null) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { suggestYouTubeReply } = await import("./youtube-insights.server");
    return suggestYouTubeReply(ctx.businessId, data);
  });

/** Posts a reply only when the owner presses Post reply. */
export const postYouTubeCommentReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ parentId: z.string().max(100), text: z.string().max(10_000) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { replyToYouTubeComment } = await import("./youtube-insights.server");
    return replyToYouTubeComment({ businessId: ctx.businessId, userId: ctx.userId, parentId: data.parentId, text: data.text });
  });
