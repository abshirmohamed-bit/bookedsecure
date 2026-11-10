import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Facebook and Instagram posting for the Social media page (LinkedIn keeps linkedin.functions). */
const PLATFORM = z.enum(["facebook", "instagram"]);
const PATH = z.string().regex(/^[0-9a-f-]{36}\/social-[0-9a-f-]{36}\.jpg$/);

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

/** Whether the Page (and its Instagram account) can be posted to, plus recent posts. */
export const getSocialPosting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { metaPostingStatus, listMetaPosts } = await import("./meta-publish.server");
    const [status, posts] = await Promise.all([metaPostingStatus(ctx.businessId), listMetaPosts(ctx.businessId, data.platform)]);
    return { ...status, isOwner: ctx.role !== "staff", posts };
  });

/** One picture for a post, already converted to JPEG in the browser. */
export const uploadSocialPicture = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ data_base64: z.string().min(100).max(12_000_000) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { storeSocialImage } = await import("./meta-publish.server");
    return storeSocialImage(ctx.businessId, data.data_base64);
  });

export const writeSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM, brief: z.string().max(2000), chips: z.array(z.string().max(60)).max(8).default([]) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await member(context);
    const { draftLinkedInPost } = await import("./linkedin.server");
    return draftLinkedInPost({ businessId: ctx.businessId, brief: data.brief, chips: data.chips, platform: data.platform });
  });

/** Posting happens only when the owner presses Post. */
export const publishSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM, text: z.string().max(5000), imagePaths: z.array(PATH).max(10).default([]) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { publishMetaPost } = await import("./meta-publish.server");
    return publishMetaPost({ businessId: ctx.businessId, userId: ctx.userId, platform: data.platform, text: data.text, imagePaths: data.imagePaths, source: "app" });
  });

/** Saves a post to go out later (the 10-minute hook publishes it). */
export const scheduleSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ platform: PLATFORM, text: z.string().max(5000), imagePaths: z.array(PATH).max(10).default([]), when: z.string().datetime({ offset: true }) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { scheduleMetaPost } = await import("./meta-publish.server");
    return scheduleMetaPost({ businessId: ctx.businessId, userId: ctx.userId, platform: data.platform, text: data.text, imagePaths: data.imagePaths, when: data.when, source: "app" });
  });

export const cancelSocialPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await owner(context);
    const { cancelScheduledPost } = await import("./meta-publish.server");
    return cancelScheduledPost(ctx.businessId, data.id);
  });
