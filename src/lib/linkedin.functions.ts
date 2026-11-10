import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LINKEDIN_POST_MAX } from "./linkedin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownerContext(context: { supabase: any; userId: string }) {
  const { requireAppContext, requireOwner } = await import("./app-context.server");
  const ctx = await requireAppContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function memberContext(context: { supabase: any; userId: string }) {
  const { requireAppContext } = await import("./app-context.server");
  return requireAppContext(context.supabase, context.userId);
}

/** Connection state and recent posts for the LinkedIn page. */
export const getLinkedIn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await memberContext(context);
    const { linkedInStatus, listLinkedInPosts } = await import("./linkedin.server");
    const [status, posts] = await Promise.all([linkedInStatus(ctx.businessId), listLinkedInPosts(ctx.businessId)]);
    return { ...status, isOwner: ctx.role !== "staff", posts };
  });

/** Step 1 of connecting: the LinkedIn sign-in address for this owner. */
export const startLinkedInConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await ownerContext(context);
    const { linkedInLoginUrl } = await import("./linkedin.server");
    return { url: linkedInLoginUrl(ctx.businessId, ctx.userId) };
  });

/** Company Pages through the separate Pages app: the LinkedIn sign-in address. */
export const startLinkedInPagesConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await ownerContext(context);
    const { linkedInPagesLoginUrl } = await import("./linkedin.server");
    return { url: linkedInPagesLoginUrl(ctx.businessId, ctx.userId) };
  });

export const disconnectLinkedInAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await ownerContext(context);
    const { disconnectLinkedIn } = await import("./linkedin.server");
    await disconnectLinkedIn(ctx.businessId, ctx.userId);
    return { ok: true };
  });

export const setLinkedInAuthor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ authorUrn: z.string().regex(/^urn:li:(person|organization):[\w-]+$/) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await ownerContext(context);
    const { setDefaultLinkedInAuthor } = await import("./linkedin.server");
    await setDefaultLinkedInAuthor(ctx.businessId, data.authorUrn);
    return { ok: true };
  });

export const writeLinkedInPost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ brief: z.string().max(2000), chips: z.array(z.string().max(60)).max(8).default([]) }).parse(input))
  .handler(async ({ context, data }) => {
    const ctx = await memberContext(context);
    const { draftLinkedInPost } = await import("./linkedin.server");
    return draftLinkedInPost({ businessId: ctx.businessId, brief: data.brief, chips: data.chips });
  });

/** Posting happens only when the owner presses Post in the app. */
export const postToLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ text: z.string().trim().min(1).max(LINKEDIN_POST_MAX), authorUrn: z.string().regex(/^urn:li:(person|organization):[\w-]+$/).nullable().default(null) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const ctx = await ownerContext(context);
    const { publishLinkedInPost } = await import("./linkedin.server");
    return publishLinkedInPost({ businessId: ctx.businessId, userId: ctx.userId, text: data.text, authorUrn: data.authorUrn, source: "app" });
  });
