import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_STATUSES, quoteSubjectLabel } from "@/lib/domain";
import { DEFAULT_PAGE_SIZE } from "@/lib/lead-pagination";

const LeadIdSchema = z.object({ leadId: z.string().uuid() });

const InboxQuerySchema = z.object({
  page: z.number().int().optional(),
  pageSize: z.number().int().optional(),
  status: z.string().max(64).optional(),
  source: z.string().max(64).optional(),
  sms: z.string().max(64).optional(),
  search: z.string().max(120).optional(),
});

export const getSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("id", app.businessId)
      .single();
    return { ...app, business };
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InboxQuerySchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { computeMetrics } = await import("@/lib/reporting.server");
    const { queryLeadInbox } = await import("@/lib/lead-query.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);

    // Pagination and filtering happen in the shared tenant-scoped query: the
    // browser never receives the full lead table.
    const [metrics, inbox, business] = await Promise.all([
      computeMetrics(app.businessId),
      queryLeadInbox(supabaseAdmin, {
        businessId: app.businessId,
        page: data.page ?? 1,
        pageSize: data.pageSize ?? DEFAULT_PAGE_SIZE,
        filters: {
          scope: "active",
          ...(data.status === undefined ? {} : { status: data.status }),
          ...(data.source === undefined ? {} : { source: data.source }),
          ...(data.sms === undefined ? {} : { sms: data.sms as never }),
          ...(data.search === undefined ? {} : { search: data.search }),
        },
      }),
      supabaseAdmin
        .from("businesses")
        .select("id, name, slug, logo_url")
        .eq("id", app.businessId)
        .single(),
    ]);

    return {
      role: app.role,
      metrics,
      leads: inbox.leads,
      page: inbox.page,
      filters: inbox.filters,
      // Authenticated tenant identity for shell branding and the tenant-scoped
      // public quote URL. Never includes another tenant's row.
      tenant: {
        name: business.data?.name ?? null,
        slug: business.data?.slug ?? null,
        logoUrl: business.data?.logo_url ?? null,
      },
    };
  });


export const getLead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LeadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const [lead, messages, ai, job, services] = await Promise.all([
      supabaseAdmin.from("leads").select("*").eq("id", data.leadId).single(),
      supabaseAdmin
        .from("messages")
        .select("*")
        .eq("lead_id", data.leadId)
        .neq("recipient_role", "owner")
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("ai_outputs")
        .select("*")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin.from("jobs").select("*").eq("lead_id", data.leadId).maybeSingle(),
      supabaseAdmin
        .from("services")
        .select("id, name, price_guidance")
        .eq("business_id", app.businessId)
        .eq("active", true),
    ]);

    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("*")
      .eq("lead_id", data.leadId)
      .maybeSingle();

    // AI web-chat transcript (separate table from SMS messages, so it can never
    // be mistaken for a sent message).
    const { data: webConversation } = await supabaseAdmin
      .from("web_conversations")
      .select("id, status, requires_owner_review, unsupported_request, service_name_snapshot, consent_outcome, created_at")
      .eq("lead_id", data.leadId)
      .eq("business_id", app.businessId)
      .maybeSingle();
    const webChatMessages = webConversation
      ? ((
          await supabaseAdmin
            .from("web_conversation_messages")
            .select("role, body, created_at")
            .eq("conversation_id", webConversation.id)
            .order("created_at", { ascending: true })
        ).data ?? [])
      : [];

    const [notifications, automationJobs, business] = await Promise.all([
      supabaseAdmin
        .from("notifications")
        .select("id, kind, title, body, created_at, read_at")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: true })
        .then((response) => response.data),
      supabaseAdmin
        .from("automation_jobs")
        .select(
          "id, job_type, step, status, attempt_count, max_attempts, run_at, next_attempt_at, last_attempt_at, failure_reason, created_at",
        )
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: true })
        .then((response) => response.data),
      supabaseAdmin
        .from("businesses")
        .select("quote_subject_label, timezone")
        .eq("id", app.businessId)
        .single()
        .then((response) => response.data),
    ]);

    return {
      role: app.role,
      lead: lead.data,
      messages: messages.data ?? [],
      conversation,
      webConversation: webConversation ?? null,
      webChatMessages,
      ai: ai.data ?? null,
      job: job.data ?? null,
      services: services.data ?? [],
      notifications: notifications ?? [],
      automationJobs: automationJobs ?? [],
      quoteSubjectLabel: quoteSubjectLabel(business?.quote_subject_label),
      // Booking times are shown and typed in the business's own timezone.
      timeZone: business?.timezone ?? "Australia/Sydney",
    };
  });

export const getNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const { data } = await supabaseAdmin
      .from("notifications")
      .select("id, lead_id, kind, title, body, metadata, created_at, read_at")
      .eq("business_id", app.businessId)
      .order("created_at", { ascending: false })
      .limit(30);
    const notifications = data ?? [];
    return {
      notifications,
      unread: notifications.filter((row) => !row.read_at).length,
    };
  });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).max(50).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    let query = supabaseAdmin
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("business_id", app.businessId)
      .is("read_at", null);
    if (data.ids?.length) query = query.in("id", data.ids);
    const { error } = await query;
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const sendManualReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), body: z.string().min(2).max(600), fromAi: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { sendSms } = await import("@/lib/lead-engine.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const result = await sendSms({
      businessId: app.businessId,
      leadId: data.leadId,
      body: data.body,
      kind: data.fromAi ? "approved_reply" : "manual",
      respectAutomation: false,
      userId: app.userId,
    });

    if (data.fromAi && result.sent) {
      const { data: latest } = await supabaseAdmin
        .from("ai_outputs")
        .select("id")
        .eq("lead_id", data.leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        await supabaseAdmin
          .from("ai_outputs")
          .update({ approved_by: app.userId, approved_at: new Date().toISOString() })
          .eq("id", latest.id);
      }
    }

    return result;
  });

export const updateLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        status: z.enum(LEAD_STATUSES).optional(),
        notes: z.string().max(4000).optional(),
        suburb: z.string().max(80).optional(),
        vehicle_type: z.string().max(60).optional(),
        last_cleaned_at: z.string().max(60).optional(),
        main_concerns: z.string().max(500).optional(),
        service_intent: z.string().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const { leadId, ...fields } = data;
    const update = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    // "completed" is only reachable through the explicit completed-job action.
    if (update["status"] === "completed") {
      throw new Error("Use Record completed job to mark a lead completed.");
    }
    if (Object.keys(update).length === 0) return { ok: true };

    const { error } = await supabaseAdmin
      .from("leads")
      .update(update as never)
      .eq("id", leadId);
    if (error) throw new Error(error.message);

    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "lead_updated",
      entityType: "lead",
      entityId: leadId,
      metadata: update,
    });
    return { ok: true };
  });

export const setAutomationPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), paused: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    await supabaseAdmin
      .from("conversations")
      .update({
        automation_paused: data.paused,
        next_follow_up_at: data.paused ? null : new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .eq("lead_id", data.leadId);
    return { ok: true };
  });

export const recordCompletedJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        service_id: z.string().uuid().nullable().optional(),
        service_performed: z.string().min(2).max(120),
        completed_at: z.string().min(8),
        completed_value: z.number().min(0).max(100000),
        notes: z.string().max(2000).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const payload = {
      business_id: app.businessId,
      lead_id: data.leadId,
      service_id: data.service_id ?? null,
      service_performed: data.service_performed,
      completed_at: new Date(data.completed_at).toISOString(),
      completed_value: data.completed_value,
      completion_status: "completed",
      notes: data.notes ?? null,
    };

    const { data: existing } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("lead_id", data.leadId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin.from("jobs").update(payload).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("jobs").insert(payload);
    }

    await supabaseAdmin.from("leads").update({ status: "completed" }).eq("id", data.leadId);
    await supabaseAdmin
      .from("conversations")
      .update({ next_follow_up_at: null, status: "closed" })
      .eq("lead_id", data.leadId);

    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "job_completed",
      entityType: "lead",
      entityId: data.leadId,
      metadata: { completed_value: data.completed_value },
    });
    return { ok: true };
  });

export const scheduleJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), scheduled_at: z.string().min(8) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    // The owner types a plain "18/09/2026 09:00" with no timezone. It must be
    // read in the business timezone, or the booking lands hours away.
    const { localDateTimeToIso, DEFAULT_TIME_ZONE } = await import("@/lib/business-time");
    const { data: businessRow } = await supabaseAdmin
      .from("businesses")
      .select("timezone")
      .eq("id", app.businessId)
      .maybeSingle();
    const scheduledAt = localDateTimeToIso(
      data.scheduled_at,
      businessRow?.timezone ?? DEFAULT_TIME_ZONE,
    );
    const { data: existing } = await supabaseAdmin
      .from("jobs")
      .select("id")
      .eq("lead_id", data.leadId)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin.from("jobs").update({ scheduled_at: scheduledAt }).eq("id", existing.id);
    } else {
      await supabaseAdmin.from("jobs").insert({
        business_id: app.businessId,
        lead_id: data.leadId,
        scheduled_at: scheduledAt,
        completion_status: "scheduled",
      });
    }
    await supabaseAdmin.from("leads").update({ status: "scheduled" }).eq("id", data.leadId);
    return { ok: true };
  });

export const analyseConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LeadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    const { analyseLead } = await import("@/lib/ai.server");
    try {
      return await analyseLead({ businessId: app.businessId, leadId: data.leadId });
    } catch (error) {
      const { AI_ANALYSIS_FAILURE_MESSAGE } = await import("@/lib/ai-analysis-contract");
      const message = error instanceof Error ? error.message : String(error);
      // Already owner-facing (concise reason + correlation ref) — pass it through.
      if (message.startsWith(AI_ANALYSIS_FAILURE_MESSAGE)) throw new Error(message);
      throw new Error(`AI analysis failed: ${message}`);
    }
  });

export const createManualLead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(80),
        mobile_number: z.string().min(8).max(20),
        suburb: z.string().max(80).optional().nullable(),
        service_address: z.string().max(200).optional().nullable(),
        vehicle_type: z.string().max(60).optional().nullable(),
        main_concerns: z.string().max(500).optional().nullable(),
        service_intent: z.string().max(120).optional().nullable(),
        source_channel: z.enum(["meta", "website", "hosted_page", "manual", "unknown"]),
        source_campaign: z.string().max(80).optional().nullable(),
        consent: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { captureLead } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await captureLead({
      ...data,
      businessId: app.businessId,
      consent_text: "Consent recorded by the business when adding the lead manually.",
    });
  });

export const runFollowUpsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { processDueFollowUps } = await import("@/lib/lead-engine.server");
    const { processDueReactivationReminders } = await import("@/lib/reactivation.server");
    await requireWriteContext(context.supabase, context.userId);
    const result = await processDueFollowUps();
    // The single automatic win-back reminder rides the same due pass.
    const reminders = await processDueReactivationReminders();
    return { ...result, reminders };

  });

export const simulateInboundReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), body: z.string().min(1).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { handleInboundMessage, resolveSender } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("mobile_number")
      .eq("id", data.leadId)
      .single();

    const sender = await resolveSender({ businessId: app.businessId, leadId: data.leadId });
    if (!sender) throw new Error("No sender number is configured for this business yet.");

    return await handleInboundMessage({
      providerName: "simulated",
      payload: {
        From: lead?.mobile_number ?? "",
        To: sender.phoneNumber,
        Body: data.body,
        MessageSid: `sim_test_${crypto.randomUUID()}`,
      },
      sender,
    });
  });


export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getProvider } = await import("@/lib/sms/provider.server");
    const app = await requireAppContext(context.supabase, context.userId);

    const [business, services, rules, team, availability, addons] = await Promise.all([
      supabaseAdmin.from("businesses").select("*").eq("id", app.businessId).single(),
      supabaseAdmin
        .from("services")
        .select("*")
        .eq("business_id", app.businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("automation_rules")
        .select("*")
        .eq("business_id", app.businessId)
        .order("step", { ascending: true }),
      supabaseAdmin
        .from("profiles")
        .select("id, name, email, active")
        .eq("business_id", app.businessId),
      supabaseAdmin
        .from("booking_availability")
        .select(
          "active, lead_time_minutes, horizon_days, offer_ttl_minutes, weekly_windows",
        )
        .eq("business_id", app.businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("service_addons")
        .select(
          "id, name, category, description, price_guidance, duration_minutes, active, image_url, service_addon_links(service_id)",
        )
        .eq("business_id", app.businessId)
        .order("name", { ascending: true }),
    ]);

    const provider = getProvider(business.data?.default_sms_provider);
    const balance = await provider.checkBalance();

    return {
      role: app.role,
      business: business.data,
      services: services.data ?? [],
      rules: rules.data ?? [],
      team: team.data ?? [],
      provider: { name: provider.name, ...balance },
      availability: availability.data ?? null,
      addons: (addons.data ?? []).map((addon) => ({
        id: addon.id,
        name: addon.name,
        category: addon.category ?? null,
        description: addon.description ?? null,
        price_guidance: addon.price_guidance ?? null,
        duration_minutes: addon.duration_minutes ?? null,
        active: addon.active !== false,
        image_url: addon.image_url ?? null,
        serviceIds: (
          (addon as { service_addon_links?: { service_id: string }[] }).service_addon_links ?? []
        ).map((link) => link.service_id),
      })),
    };
  });

export const saveBusinessSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(2).max(80),
        phone_number: z.string().max(20).nullable(),
        service_area: z.string().max(300).nullable(),
        opening_hours: z.string().max(200).nullable(),
        sms_signature: z.string().max(80).nullable(),
        privacy_policy_url: z.string().max(300).nullable(),
        logo_url: z.string().max(500).nullable(),
        timezone: z.string().max(60),
        automation_enabled: z.boolean(),
        default_sms_provider: z.enum(["simulated", "twilio", "telnyx"]),
        quiet_hours_start: z.number().int().min(0).max(23),
        quiet_hours_end: z.number().int().min(0).max(23),
        quote_subject_label: z.string().max(40).nullable(),
        quote_subject_options: z.array(z.string().max(80)).max(50).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin.from("businesses").update(data).eq("id", app.businessId);
    if (error) throw new Error(error.message);
    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "business_settings_updated",
      entityType: "business",
      entityId: app.businessId,
    });
    return { ok: true };
  });

/** Owner-only switch between the manual quote form and the AI quote conversation. */
export const saveQuotePageMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ quote_mode: z.enum(["manual_sms", "ai_chat"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin
      .from("businesses")
      .update({ quote_mode: data.quote_mode })
      .eq("id", app.businessId);
    if (error) throw new Error(error.message);
    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "quote_page_mode_changed",
      entityType: "business",
      entityId: app.businessId,
      metadata: { quote_mode: data.quote_mode },
    });
    return { ok: true as const };
  });

/** Owner-only choice for how services appear inside the public AI quote conversation. */
export const saveQuoteServiceLayout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        quote_service_layout: z.enum([
          "focused_list",
          "compact_grid",
          "guided_conversation",
        ]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin
      .from("businesses")
      .update({ quote_service_layout: data.quote_service_layout })
      .eq("id", app.businessId);
    if (error) throw new Error(error.message);
    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "quote_service_layout_changed",
      entityType: "business",
      entityId: app.businessId,
      metadata: { quote_service_layout: data.quote_service_layout },
    });
    return { ok: true as const };
  });

/** Owner-only switch between the AI agent and the fixed step-by-step flow on the quote page. */
export const saveQuoteAgentEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ quote_agent_enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin
      .from("businesses")
      .update({ quote_agent_enabled: data.quote_agent_enabled })
      .eq("id", app.businessId);
    if (error) throw new Error(error.message);
    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "quote_agent_enabled_changed",
      entityType: "business",
      entityId: app.businessId,
      metadata: { quote_agent_enabled: data.quote_agent_enabled },
    });
    return { ok: true as const };
  });

export const getSmsSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getUsageLimits, monthlySmsSegments, monthlyAiCost } = await import(
      "@/lib/usage.server"
    );
    const app = await requireAppContext(context.supabase, context.userId);

    const [senders, limits, segments, aiCost, business] = await Promise.all([
      supabaseAdmin
        .from("sms_senders")
        .select("id, phone_number, provider, credential_mode, messaging_profile_id, label, is_primary, active")
        .eq("business_id", app.businessId)
        .order("is_primary", { ascending: false })
        .then((response) => response.data ?? []),
      getUsageLimits(app.businessId),
      monthlySmsSegments(app.businessId),
      monthlyAiCost(app.businessId),
      supabaseAdmin
        .from("businesses")
        .select("name, automation_enabled")
        .eq("id", app.businessId)
        .maybeSingle()
        .then((response) => response.data ?? null),
    ]);

    return { role: app.role, senders, limits, usage: { segments, aiCost }, business };

  });

/**
 * Owner-facing sender save: display label only. The number, provider, tenant
 * assignment, active/primary flags and routing fields are platform-managed and
 * cannot be created or mutated from this path.
 */
export const saveSenderLabel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        label: z.string().max(80).nullable(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildOwnerSenderPatch } = await import("@/lib/sender-settings");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);

    // Tenant context comes from the authenticated profile, never the client.
    const { data: existing, error: loadError } = await supabaseAdmin
      .from("sms_senders")
      .select("id, business_id, phone_number, provider, active, is_primary, label")
      .eq("id", data.id)
      .eq("business_id", app.businessId)
      .maybeSingle();
    if (loadError) throw new Error(loadError.message);
    if (!existing) throw new Error("Sender not found for this business.");

    const patch = buildOwnerSenderPatch(existing, data);
    const { error } = await supabaseAdmin
      .from("sms_senders")
      .update(patch)
      .eq("id", existing.id)
      .eq("business_id", app.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const saveUsageLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        monthly_segment_cap: z.number().int().min(0).max(1000000),
        monthly_ai_cost_cap: z.number().min(0).max(10000),
        alert_threshold_pct: z.number().int().min(10).max(100),
        hard_block: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin
      .from("usage_limits")
      .update(data)
      .eq("business_id", app.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        name: z.string().min(2).max(80),
        category: z.string().max(40).nullable(),
        description: z.string().max(600).nullable(),
        price_guidance: z.string().max(200).nullable(),
        included_items: z.string().max(600).nullable(),
        excluded_items: z.string().max(600).nullable(),
        // Required appointment length for this service. Bookings use only this.
        duration_minutes: z.number().int().min(15).max(1440),
        campaign_eligible: z.boolean(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { id, ...fields } = data;
    if (id) {
      const { error } = await supabaseAdmin
        .from("services")
        .update(fields)
        .eq("id", id)
        .eq("business_id", app.businessId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("services")
        .insert({ ...fields, business_id: app.businessId });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Permanently removes one of the owner's own services and its customer-facing picture. */
export const deleteService = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isOwnServiceImagePath } = await import("@/lib/service-images");
    const { TENANT_LOGO_BUCKET } = await import("@/lib/tenant-logo");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);

    const { data: service } = await supabaseAdmin
      .from("services")
      .select("id, name, image_storage_path")
      .eq("id", data.id)
      .eq("business_id", app.businessId)
      .maybeSingle();
    if (!service) throw new Error("That service was not found in your business.");

    // This older relationship predates the other ON DELETE SET NULL links.
    // Clear it first so historic leads stay intact while the service can be removed.
    const { error: leadError } = await supabaseAdmin
      .from("leads")
      .update({ verified_service_id: null })
      .eq("business_id", app.businessId)
      .eq("verified_service_id", service.id);
    if (leadError) throw new Error(leadError.message);

    const { error } = await supabaseAdmin
      .from("services")
      .delete()
      .eq("id", service.id)
      .eq("business_id", app.businessId);
    if (error) throw new Error(error.message);

    const imagePath = service.image_storage_path ?? null;
    if (imagePath && isOwnServiceImagePath(app.businessId, imagePath)) {
      await supabaseAdmin.storage.from(TENANT_LOGO_BUCKET).remove([imagePath]);
    }

    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "service_removed",
      entityType: "service",
      entityId: service.id,
      metadata: { name: service.name },
    });
    return { ok: true as const };
  });

/**
 * Owner-only add-on service. An add-on always belongs to the caller's own
 * business and is always linked to at least one of that business's own approved
 * services, so it can never be offered on its own or across tenants.
 */
export const saveServiceAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        name: z.string().min(2).max(80),
        category: z.string().max(40).nullable(),
        description: z.string().max(600).nullable(),
        price_guidance: z.string().max(200).nullable(),
        duration_minutes: z.number().int().min(5).max(1440).nullable(),
        active: z.boolean(),
        service_ids: z.array(z.string().uuid()).min(1).max(50),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);

    // Only the caller's own approved services may be linked.
    const { data: owned } = await supabaseAdmin
      .from("services")
      .select("id")
      .eq("business_id", app.businessId)
      .in("id", data.service_ids);
    const serviceIds = (owned ?? []).map((service) => service.id);
    if (serviceIds.length === 0) throw new Error("Choose at least one of your own services.");

    const fields = {
      name: data.name,
      category: data.category,
      description: data.description,
      price_guidance: data.price_guidance,
      duration_minutes: data.duration_minutes,
      active: data.active,
    };

    let addonId = data.id ?? null;
    if (addonId) {
      const { error } = await supabaseAdmin
        .from("service_addons")
        .update(fields)
        .eq("id", addonId)
        .eq("business_id", app.businessId);
      if (error) throw new Error(error.message);
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("service_addons")
        .insert({ ...fields, business_id: app.businessId })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      addonId = created.id;
    }

    await supabaseAdmin
      .from("service_addon_links")
      .delete()
      .eq("addon_id", addonId)
      .eq("business_id", app.businessId);
    const { error: linkError } = await supabaseAdmin.from("service_addon_links").insert(
      serviceIds.map((serviceId) => ({
        business_id: app.businessId,
        addon_id: addonId!,
        service_id: serviceId,
      })),
    );
    if (linkError) throw new Error(linkError.message);
    return { ok: true, id: addonId };
  });

export const deleteServiceAddon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    const { error } = await supabaseAdmin
      .from("service_addons")
      .delete()
      .eq("id", data.id)
      .eq("business_id", app.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const saveAutomationRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        delay_minutes: z.number().int().min(0).max(20160),
        message_template: z.string().min(10).max(600),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireWriteContext(context.supabase, context.userId, "automation_custom");
    requireOwner(app);
    const { id, ...fields } = data;
    const { error } = await supabaseAdmin
      .from("automation_rules")
      .update(fields)
      .eq("id", id)
      .eq("business_id", app.businessId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        from: z.string().nullable().optional(),
        to: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { computeMetrics } = await import("@/lib/reporting.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await computeMetrics(app.businessId, {
      from: data.from ?? null,
      to: data.to ?? null,
      source: data.source ?? null,
    });
  });

// ---------------------------------------------------------------------------
// Phase 3: availability and booking
// ---------------------------------------------------------------------------

const WeeklyWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/** Owner-controlled bookable availability. Opening hours stay free text. */
export const saveAvailabilitySettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        active: z.boolean(),
        lead_time_minutes: z.number().int().min(0).max(10080),
        horizon_days: z.number().int().min(1).max(30),
        offer_ttl_minutes: z.number().int().min(15).max(1440),
        weekly_windows: z.array(WeeklyWindowSchema).max(21),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const { isValidTimezone } = await import("@/lib/availability");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);

    for (const window of data.weekly_windows) {
      if (window.end <= window.start)
        throw new Error("Each bookable window must end after it starts.");
    }

    // A valid tenant timezone is a hard requirement for offering any slot.
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("timezone")
      .eq("id", app.businessId)
      .single();
    if (!isValidTimezone(business?.timezone))
      throw new Error("Set a valid business timezone before switching on availability.");

    const { error } = await supabaseAdmin.from("booking_availability").upsert(
      {
        business_id: app.businessId,
        active: data.active,
        
        lead_time_minutes: data.lead_time_minutes,
        horizon_days: data.horizon_days,
        offer_ttl_minutes: data.offer_ttl_minutes,
        weekly_windows: data.weekly_windows as never,
      },
      { onConflict: "business_id" },
    );
    if (error) throw new Error(error.message);

    await recordAuditEvent({
      businessId: app.businessId,
      userId: app.userId,
      eventType: "booking_availability_updated",
      entityType: "business",
      entityId: app.businessId,
      metadata: { active: data.active, windows: data.weekly_windows.length },
    });
    return { ok: true };
  });

/** Read-only booking view for one lead: config, valid options, existing offers. */
export const getBookingOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LeadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { getBookingView } = await import("@/lib/availability.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    return await getBookingView({ businessId: app.businessId, leadId: data.leadId });
  });

/** Offers the server-computed options to the customer via the approved send path. */
export const offerBookingSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => LeadIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { sendSlotOffer } = await import("@/lib/availability.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    const result = await sendSlotOffer({
      businessId: app.businessId,
      leadId: data.leadId,
      userId: app.userId,
    });
    return {
      sent: result.sent,
      reason: result.reason ?? null,
      offers: result.offers.map((offer) => ({ id: offer.id, slot_start: offer.slot_start })),
    };
  });

/** Records the customer's own explicit choice of one offered option. */
export const selectBookingSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        leadId: z.string().uuid(),
        offerId: z.string().uuid(),
        messageId: z.string().uuid(),
      })
      .strict()
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { recordCustomerSlotSelection } = await import("@/lib/availability.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    return await recordCustomerSlotSelection({
      businessId: app.businessId,
      leadId: data.leadId,
      offerId: data.offerId,
      messageId: data.messageId,
      userId: app.userId,
    });
  });

/** Owner approval: the only action that can reach `scheduled` (Booked). */
export const confirmLeadBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), offerId: z.string().uuid() }).strict().parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext, requireOwner, assertLeadOwnership } = await import(
      "@/lib/app-context.server"
    );
    const { confirmBooking } = await import("@/lib/availability.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    requireOwner(app);
    await assertLeadOwnership(app.businessId, data.leadId);
    const result = await confirmBooking({
      businessId: app.businessId,
      leadId: data.leadId,
      offerId: data.offerId,
      userId: app.userId,
    });
    return {
      ok: result.ok,
      reason: result.reason ?? null,
      alreadyConfirmed: result.alreadyConfirmed ?? false,
      needsHumanReview: result.decision.needsHumanReview,
    };
  });
