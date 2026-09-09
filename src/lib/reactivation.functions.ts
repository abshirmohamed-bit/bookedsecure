import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The tenant's current open reactivation draft, if there is one. */
export const getReactivationCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { loadOpenCampaign, loadReactivationCandidates } =
      await import("@/lib/reactivation.server");
    const { getPlanForBusiness } = await import("@/lib/plans.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const [view, candidates, plan] = await Promise.all([
      loadOpenCampaign(app.businessId),
      loadReactivationCandidates(app.businessId),
      getPlanForBusiness(app.businessId),
    ]);
    return {
      ...view,
      candidates: candidates.candidates.length,
      excluded: candidates.excluded,
      // Reactivation is a Pro feature; the panel shows an upgrade note instead
      // of the controls when the plan does not include it.
      planName: plan.name,
      reactivationEnabled: plan.reactivationEnabled,
    };
  });

/** Drafts (or refreshes) the campaign. Sends nothing. */
export const draftReactivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ offerText: z.string().max(120).optional().nullable() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { draftReactivationCampaign } = await import("@/lib/reactivation.server");
    const { requireReactivationPlan } = await import("@/lib/plans.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await requireReactivationPlan(app.businessId);
    return await draftReactivationCampaign({
      businessId: app.businessId,
      userId: app.userId,
      offerText: data.offerText ?? null,
    });
  });


export const editReactivationDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        draftId: z.string().uuid(),
        body: z.string().min(2).max(320).optional(),
        status: z.enum(["draft", "skipped"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { updateReactivationDraft } = await import("@/lib/reactivation.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await updateReactivationDraft({
      businessId: app.businessId,
      draftId: data.draftId,
      ...(data.body !== undefined ? { body: data.body } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    });
  });

export const approveReactivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        campaignId: z.string().uuid(),
        attested: z.boolean(),
        draftIds: z.array(z.string().uuid()).max(500).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { approveReactivationCampaign } = await import("@/lib/reactivation.server");
    const { requireReactivationPlan } = await import("@/lib/plans.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await requireReactivationPlan(app.businessId);

    return await approveReactivationCampaign({
      businessId: app.businessId,
      userId: app.userId,
      campaignId: data.campaignId,
      attested: data.attested,
      draftIds: data.draftIds ?? null,
    });
  });

export const cancelReactivation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { cancelReactivationCampaign } = await import("@/lib/reactivation.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await cancelReactivationCampaign({
      businessId: app.businessId,
      campaignId: data.campaignId,
    });
  });
