import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FEEDBACK_KINDS, FEEDBACK_STATUSES } from "@/lib/feedback";

/** Any signed-in tenant member can send feedback for their own business. */
export const sendFeedback = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(FEEDBACK_KINDS),
        message: z.string().trim().min(5).max(4000),
        pagePath: z.string().trim().max(300).nullable().optional(),
        contactEmail: z.string().trim().email().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { recordFeedback } = await import("@/lib/feedback.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const result = await recordFeedback({
      businessId: app.businessId,
      userId: app.userId,
      kind: data.kind,
      message: data.message,
      pagePath: data.pagePath ?? null,
      contactEmail: data.contactEmail ?? null,
    });
    return { ok: true as const, id: result.id };
  });

/** Platform review queue. */
export const listFeedbackSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ status: z.enum(["all", ...FEEDBACK_STATUSES]).default("all") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    const { listFeedback } = await import("@/lib/feedback.server");
    await requirePlatformAdmin(context.supabase, context.userId);
    return { submissions: await listFeedback({ status: data.status }) };
  });

export const updateFeedbackSubmission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(FEEDBACK_STATUSES).optional(),
        internalNote: z.string().max(4000).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    const { updateFeedback } = await import("@/lib/feedback.server");
    await requirePlatformAdmin(context.supabase, context.userId);
    await updateFeedback({
      id: data.id,
      ...(data.status ? { status: data.status } : {}),
      ...(data.internalNote === undefined ? {} : { internalNote: data.internalNote }),
    });
    return { ok: true as const };
  });
