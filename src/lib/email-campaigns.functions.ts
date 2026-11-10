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
    z.object({ query: z.string().max(120).optional(), ids: z.array(z.string().uuid()).max(500).optional() }).parse(input ?? {}),
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
      .limit(data.ids?.length ? 500 : 50);
    // Customers chosen on the Leads page (always within this business).
    if (data.ids?.length) query = query.in("id", data.ids);
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
        followUp: z
          .object({
            subject: z.string().min(2).max(160),
            bodyText: z.string().min(2).max(5000),
            delayDays: z.number().int().min(1).max(30),
            stopOnBooking: z.boolean(),
          })
          .nullable()
          .optional(),
        audienceLabel: z.string().max(80).nullable().optional(),
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
      followUp: data.followUp ?? null,
      audienceLabel: data.audienceLabel ?? null,
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

const campaignIdInput = (input: unknown) => z.object({ campaignId: z.string().uuid() }).parse(input);

/** One campaign with every recipient and result (the campaign workspace). */
export const getEmailCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(campaignIdInput)
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { getEmailCampaign: load } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await load(app.businessId, data.campaignId);
  });

/** Customers in one of the quick audiences (everyone, quoted, past customers…). */
export const getCampaignAudience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ audience: z.enum(["all", "enquiries", "quoted", "booked", "past", "lost", "lead_finder"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { campaignAudience } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await campaignAudience(app.businessId, data.audience);
  });

/** Owner approval to send a draft later. */
export const scheduleEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ campaignId: z.string().uuid(), scheduledAt: z.string().datetime({ offset: true }) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { scheduleEmailCampaign: schedule } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await schedule({ businessId: app.businessId, campaignId: data.campaignId, scheduledAt: data.scheduledAt });
  });

export const unscheduleEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(campaignIdInput)
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { unscheduleEmailCampaign: unschedule } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await unschedule({ businessId: app.businessId, campaignId: data.campaignId });
  });

export const stopCampaignFollowUps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(campaignIdInput)
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { stopCampaignFollowUps: stop } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await stop({ businessId: app.businessId, campaignId: data.campaignId });
  });

/** AI writes the first email or the follow-up from the owner's instructions. Saves nothing. */
export const draftCampaignEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: z.enum(["first", "follow_up"]),
        instructions: z.string().max(2000),
        chips: z.array(z.string().max(60)).max(8),
        firstEmail: z.object({ subject: z.string().max(160), bodyText: z.string().max(5000) }).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { draftCampaignEmail: draft } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    return await draft({ businessId: app.businessId, ...data, firstEmail: data.firstEmail ?? null });
  });

/** Edit a draft or scheduled campaign's wording and follow-up from the campaign page. */
export const updateEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        campaignId: z.string().uuid(),
        name: z.string().min(2).max(120),
        subject: z.string().min(2).max(160),
        bodyText: z.string().min(2).max(5000),
        replyTo: z.string().max(200).nullable(),
        followUp: z
          .object({ subject: z.string().min(2).max(160), bodyText: z.string().min(2).max(5000), delayDays: z.number().int().min(1).max(30), stopOnBooking: z.boolean() })
          .nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { updateEmailCampaignDraft } = await import("@/lib/email-campaigns.server");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);
    const result = await updateEmailCampaignDraft({
      businessId: app.businessId,
      campaignId: data.campaignId,
      name: data.name,
      subject: data.subject,
      bodyText: data.bodyText,
      replyTo: data.replyTo ?? "",
      followUp: data.followUp,
    });
    return { ok: true, status: result.campaign.status };
  });

/** Campaign emails sent to one customer and their replies, newest first (lead page). */
export const getLeadEmailHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ leadId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { data: recipients } = await supabaseAdmin.from("email_campaign_recipients")
      .select("id, campaign_id, status, sent_at, follow_up_sent_at")
      .eq("business_id", app.businessId).eq("lead_id", data.leadId).order("created_at", { ascending: false }).limit(20);
    const campaignIds = [...new Set((recipients ?? []).map((r) => r.campaign_id as string))];
    const [{ data: campaigns }, { data: replies }] = await Promise.all([
      campaignIds.length ? supabaseAdmin.from("email_campaigns").select("id, name, subject").in("id", campaignIds).eq("business_id", app.businessId) : Promise.resolve({ data: [] as { id: string; name: string | null; subject: string }[] }),
      supabaseAdmin.from("email_messages").select("recipient_id, direction, created_at").eq("business_id", app.businessId).eq("lead_id", data.leadId).limit(200),
    ]);
    return (recipients ?? []).map((r) => {
      const c = (campaigns ?? []).find((x) => x.id === r.campaign_id);
      const mine = (replies ?? []).filter((m) => m.recipient_id === r.id);
      return {
        recipientId: r.id as string,
        campaignId: r.campaign_id as string,
        subject: (c?.subject as string | undefined) ?? (c?.name as string | undefined) ?? "Campaign email",
        status: r.status as string,
        sentAt: (r.sent_at as string | null) ?? null,
        followUpSentAt: (r.follow_up_sent_at as string | null) ?? null,
        replies: mine.filter((m) => m.direction === "in").length,
      };
    });
  });
