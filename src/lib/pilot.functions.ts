import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { PILOT_STATUSES, PilotApplicationSchema } from "@/lib/pilot-schema";

const ListSchema = z.object({
  status: z.enum(["all", ...PILOT_STATUSES]).default("all"),
  utmSource: z.string().trim().max(120).optional().nullable(),
  search: z.string().trim().max(120).optional().nullable(),
  from: z.string().trim().max(40).optional().nullable(),
  to: z.string().trim().max(40).optional().nullable(),
});

const UpdateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PILOT_STATUSES).optional(),
  internal_notes: z.string().max(4000).optional().nullable(),
});

export const submitPilotApplication = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => PilotApplicationSchema.parse(input))
  .handler(async ({ data }) => {
    // Silently accept honeypot hits so bots get no signal.
    if (data.company) return { ok: true as const, duplicate: false };

    const ip =
      getRequestHeader("cf-connecting-ip") ??
      getRequestHeader("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";

    const { allowPublicFormAttempt } = await import("@/lib/rate-limit.server");
    if (!(await allowPublicFormAttempt(ip))) {
      return {
        ok: false as const,
        error: "Too many submissions from this device. Please try again shortly.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { auditPilotEvent } = await import("@/lib/pilot.server");

    const { company: _company, ...application } = data;

    // Duplicates are kept as separate rows (never overwritten) and flagged for
    // admin review, so no application is ever lost.
    const { data: existing } = await supabaseAdmin
      .from("pilot_applications")
      .select("id")
      .ilike("email", application.email)
      .order("submitted_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: inserted, error } = await supabaseAdmin
      .from("pilot_applications")
      .insert({
        ...application,
        weekly_enquiry_volume: application.weekly_enquiry_volume ?? null,
        duplicate_of: existing?.id ?? null,
      })
      .select("id")
      .single();

    if (error || !inserted) {
      console.error("[pilot] insert failed", error);
      return {
        ok: false as const,
        error: "We couldn't save your application. Please try again shortly.",
      };
    }

    await auditPilotEvent({
      eventType: "pilot_application_submitted",
      applicationId: inserted.id,
      metadata: {
        utm_source: application.utm_source,
        landing_page: application.landing_page,
        duplicate_of: existing?.id ?? null,
      },
    });

    return { ok: true as const, duplicate: Boolean(existing) };
  });

export const listPilotApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListSchema.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    // Keep the scheduler credential mirror fresh so the hourly pilot-expiry
    // cron job can authenticate with the managed server-side cron secret.
    const { syncCronCredential } = await import("@/lib/cron.server");
    await syncCronCredential();



    let query = supabaseAdmin
      .from("pilot_applications")
      .select("*")
      .order("submitted_at", { ascending: false })
      .limit(500);

    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.utmSource) query = query.eq("utm_source", data.utmSource);
    if (data.from) query = query.gte("submitted_at", new Date(data.from).toISOString());
    if (data.to) {
      const to = new Date(data.to);
      to.setUTCHours(23, 59, 59, 999);
      query = query.lte("submitted_at", to.toISOString());
    }
    if (data.search) {
      const term = data.search.replace(/[,%]/g, " ").trim();
      query = query.or(
        [
          `business_name.ilike.%${term}%`,
          `contact_name.ilike.%${term}%`,
          `email.ilike.%${term}%`,
          `phone.ilike.%${term}%`,
        ].join(","),
      );
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const sources = Array.from(
      new Set((rows ?? []).map((row) => row.utm_source).filter((v): v is string => Boolean(v))),
    ).sort();

    return { applications: rows ?? [], sources };
  });

export const updatePilotApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requirePlatformAdmin, auditPilotEvent } = await import("@/lib/pilot.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await requirePlatformAdmin(context.supabase, context.userId);

    const { data: current, error: readError } = await supabaseAdmin
      .from("pilot_applications")
      .select("id, status, internal_notes")
      .eq("id", data.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!current) throw new Error("Application not found.");

    const patch = {
      reviewed_at: new Date().toISOString(),
      reviewed_by: context.userId,
      ...(data.status ? { status: data.status } : {}),
      ...(data.internal_notes !== undefined ? { internal_notes: data.internal_notes || null } : {}),
    };

    const { data: updated, error } = await supabaseAdmin
      .from("pilot_applications")
      .update(patch)
      .eq("id", data.id)
      .select("*")
      .single();
    if (error || !updated) throw new Error(error?.message ?? "Could not save changes.");

    if (data.status && data.status !== current.status) {
      await auditPilotEvent({
        userId: context.userId,
        eventType: "pilot_application_status_changed",
        applicationId: data.id,
        metadata: { previous_status: current.status, new_status: data.status },
      });
    }
    if (data.internal_notes !== undefined && (data.internal_notes || null) !== current.internal_notes) {
      await auditPilotEvent({
        userId: context.userId,
        eventType: "pilot_application_note_updated",
        applicationId: data.id,
      });
    }

    // Status is record management only: no tenant, sender or provisioning work.
    return { application: updated };
  });
