import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The tenant's email campaigns with per-recipient outcomes. */
export const getEmailCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { listEmailCampaigns } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await listEmailCampaigns(app.businessId);
  });

/** Search this tenant's leads to pick campaign recipients. */
export const searchCampaignLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ query: z.string().max(120).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    let query = supabaseAdmin
      .from("leads")
      .select("id, name, email, suburb, created_at")
      .eq("business_id", app.businessId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);
    const term = (data.query ?? "").trim();
    if (term) {
      const like = `%${term}%`;
      query = query.or(`name.ilike.${like},email.ilike.${like}`);
    }
    const { data: rows } = await query;
    return (rows ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string | null,
      email: row.email as string | null,
      suburb: row.suburb as string | null,
    }));
  });

/** Creates a draft campaign. Sends nothing until the owner approves. */
export const createEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(120),
        subject: z.string().min(2).max(160),
        bodyText: z.string().min(2).max(5000),
        fromAddress: z.string().max(200).optional().nullable(),
        leadIds: z.array(z.string().uuid()).min(1).max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { createEmailCampaign: create } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await create({
      businessId: app.businessId,
      userId: app.userId,
      name: data.name,
      subject: data.subject,
      bodyText: data.bodyText,
      fromAddress: data.fromAddress ?? null,
      leadIds: data.leadIds,
    });
  });

/** Owner approval: sends the draft to every pending recipient. */
export const sendEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { sendEmailCampaign: send } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await send({ businessId: app.businessId, campaignId: data.campaignId });
  });

export const cancelEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { cancelEmailCampaign: cancel } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await cancel({ businessId: app.businessId, campaignId: data.campaignId });
  });

/**
 * One-off email to a single lead from the lead page. The owner writes the
 * message and presses send, which is itself the approval step.
 */
export const sendLeadEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        subject: z.string().min(2).max(160),
        bodyText: z.string().min(2).max(5000),
        fromAddress: z.string().max(200).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner, assertLeadOwnership } = await import(
      "@/lib/app-context.server"
    );
    const { createEmailCampaign: create, sendEmailCampaign: send } = await import(
      "@/lib/email-campaigns.server"
    );
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    await assertLeadOwnership(app.businessId, data.leadId);
    const created = await create({
      businessId: app.businessId,
      userId: app.userId,
      name: "One-off email",
      subject: data.subject,
      bodyText: data.bodyText,
      fromAddress: data.fromAddress ?? null,
      leadIds: [data.leadId],
    });
    const result = await send({ businessId: app.businessId, campaignId: created.campaignId });
    return { ...result, fromDeliverable: created.fromDeliverable };
  });
