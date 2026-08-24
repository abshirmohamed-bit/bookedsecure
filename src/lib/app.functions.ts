import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { LEAD_STATUSES } from "@/lib/domain";

const LeadIdSchema = z.object({ leadId: z.string().uuid() });

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
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { computeMetrics } = await import("@/lib/reporting.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);

    const [metrics, leads, conversations, jobs] = await Promise.all([
      computeMetrics(app.businessId),
      supabaseAdmin
        .from("leads")
        .select(
          "id, name, mobile_number, suburb, vehicle_type, service_intent, source_channel, status, readiness_classification, created_at, first_contacted_at, first_reply_at, updated_at",
        )
        .eq("business_id", app.businessId)
        .order("created_at", { ascending: false })
        .limit(200)
        .then((response) => response.data),
      supabaseAdmin
        .from("conversations")
        .select("lead_id, status, next_follow_up_at, automation_paused, last_message_at")
        .eq("business_id", app.businessId)
        .then((response) => response.data),
      supabaseAdmin
        .from("jobs")
        .select("lead_id, completed_value, completion_status")
        .eq("business_id", app.businessId)
        .then((response) => response.data),
    ]);

    const conversationByLead = new Map((conversations ?? []).map((row) => [row.lead_id, row]));
    const jobByLead = new Map((jobs ?? []).map((row) => [row.lead_id, row]));

    return {
      role: app.role,
      metrics,
      leads: (leads ?? []).map((lead) => ({
        ...lead,
        conversation: conversationByLead.get(lead.id) ?? null,
        job: jobByLead.get(lead.id) ?? null,
      })),
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

    const [notifications, automationJobs] = await Promise.all([
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
    ]);

    return {
      role: app.role,
      lead: lead.data,
      messages: messages.data ?? [],
      conversation,
      ai: ai.data ?? null,
      job: job.data ?? null,
      services: services.data ?? [],
      notifications: notifications ?? [],
      automationJobs: automationJobs ?? [],
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { sendSms } = await import("@/lib/lead-engine.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);

    const scheduledAt = new Date(data.scheduled_at).toISOString();
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
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    await assertLeadOwnership(app.businessId, data.leadId);
    const { analyseLead } = await import("@/lib/ai.server");
    try {
      return await analyseLead({ businessId: app.businessId, leadId: data.leadId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { captureLead } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await captureLead({
      ...data,
      businessId: app.businessId,
      consent_text: "Consent recorded by the business when adding the lead manually.",
    });
  });

export const runFollowUpsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { processDueFollowUps } = await import("@/lib/lead-engine.server");
    await requireAppContext(context.supabase, context.userId);
    return await processDueFollowUps();
  });

export const simulateInboundReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ leadId: z.string().uuid(), body: z.string().min(1).max(600) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, assertLeadOwnership } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { handleInboundMessage, resolveSender } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
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

    const [business, services, rules, team] = await Promise.all([
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
        timezone: z.string().max(60),
        automation_enabled: z.boolean(),
        default_sms_provider: z.enum(["simulated", "twilio"]),
        quiet_hours_start: z.number().int().min(0).max(23),
        quiet_hours_end: z.number().int().min(0).max(23),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { recordAuditEvent } = await import("@/lib/lead-engine.server");
    const app = await requireAppContext(context.supabase, context.userId);
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

export const getSmsSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getUsageLimits, monthlySmsSegments, monthlyAiCost } = await import(
      "@/lib/usage.server"
    );
    const app = await requireAppContext(context.supabase, context.userId);

    const [senders, limits, segments, aiCost] = await Promise.all([
      supabaseAdmin
        .from("sms_senders")
        .select("id, phone_number, provider, credential_mode, label, is_primary, active")
        .eq("business_id", app.businessId)
        .order("is_primary", { ascending: false })
        .then((response) => response.data ?? []),
      getUsageLimits(app.businessId),
      monthlySmsSegments(app.businessId),
      monthlyAiCost(app.businessId),
    ]);

    return { role: app.role, senders, limits, usage: { segments, aiCost } };
  });

export const saveSender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid().optional().nullable(),
        phone_number: z.string().min(8).max(20),
        label: z.string().max(80).nullable(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseAuMobile } = await import("@/lib/domain");
    const app = await requireAppContext(context.supabase, context.userId);
    requireOwner(app);

    const number = data.phone_number.startsWith("+")
      ? data.phone_number.replace(/[^\d+]/g, "")
      : (normaliseAuMobile(data.phone_number) ?? data.phone_number);

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("sms_senders")
        .update({ phone_number: number, label: data.label, active: data.active })
        .eq("id", data.id)
        .eq("business_id", app.businessId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("sms_senders").insert({
        business_id: app.businessId,
        phone_number: number,
        label: data.label,
        active: data.active,
        provider: "twilio",
        credential_mode: "platform",
      });
      if (error) throw new Error(error.message);
    }
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
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
        description: z.string().max(600).nullable(),
        price_guidance: z.string().max(200).nullable(),
        included_items: z.string().max(600).nullable(),
        excluded_items: z.string().max(600).nullable(),
        active: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
    const { requireAppContext, requireOwner } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
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
