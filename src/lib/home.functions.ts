import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * What is waiting for the owner: leads whose conversation needs a person, and
 * Facebook/Instagram comments with a reply waiting for approval. Tenant-scoped
 * exact counts; read errors are thrown rather than shown as zero.
 */
async function waitingCounts(businessId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [leads, comments] = await Promise.all([
    supabaseAdmin
      .from("lead_inbox_rows")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .is("deleted_at", null)
      .eq("conversation_status", "needs_attention"),
    supabaseAdmin
      .from("social_comments")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "pending_review")
      .eq("needs_response", true),
  ]);
  if (leads.error) throw new Error("Lead counts could not be loaded.");
  // Social tables may not exist on a workspace that never connected Facebook.
  return { leads: leads.count ?? 0, social: comments.error ? 0 : (comments.count ?? 0) };
}

/** Sidebar badges. Small and cheap so it can refresh every couple of minutes. */
export const getNavCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await waitingCounts(app.businessId);
  });

/** Everything Home shows: today's to-dos, this week's numbers, latest leads and next bookings. */
export const getHomeSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { computeMetrics } = await import("@/lib/reporting.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    const [waiting, week, latest, upcoming, business] = await Promise.all([
      waitingCounts(app.businessId),
      computeMetrics(app.businessId, { from: weekAgo }),
      supabaseAdmin
        .from("lead_inbox_rows")
        .select("id, name, service_intent, vehicle_type, suburb, status, conversation_status, created_at")
        .eq("business_id", app.businessId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(6),
      supabaseAdmin
        .from("jobs")
        .select("id, lead_id, scheduled_at, service_performed")
        .eq("business_id", app.businessId)
        .eq("completion_status", "scheduled")
        .gte("scheduled_at", now.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(4),
      supabaseAdmin.from("businesses").select("name").eq("id", app.businessId).single(),
    ]);
    if (latest.error) throw new Error("Latest leads could not be loaded.");
    if (upcoming.error) throw new Error("Upcoming bookings could not be loaded.");

    const jobs = upcoming.data ?? [];
    const leadIds = [...new Set(jobs.map((job) => job.lead_id))];
    const names = new Map<string, string | null>();
    if (leadIds.length) {
      const { data, error } = await supabaseAdmin
        .from("leads")
        .select("id, name")
        .eq("business_id", app.businessId)
        .in("id", leadIds);
      if (error) throw new Error("Upcoming bookings could not be loaded.");
      for (const row of data ?? []) names.set(row.id, row.name);
    }

    return {
      role: app.role,
      businessName: business.data?.name ?? null,
      waiting,
      week: {
        enquiries: week.funnel.enquiries,
        withinFiveMinutes: week.withinFiveMinutes,
        booked: week.funnel.scheduled,
        completedRevenue: week.completedRevenue,
      },
      latestLeads: (latest.data ?? []).map((lead) => ({
        id: lead.id!,
        name: lead.name,
        service: lead.service_intent ?? lead.vehicle_type ?? null,
        suburb: lead.suburb,
        status: lead.status,
        needsReply: lead.conversation_status === "needs_attention",
        createdAt: lead.created_at,
      })),
      nextBookings: jobs.map((job) => ({
        id: job.id,
        leadId: job.lead_id,
        name: names.get(job.lead_id) ?? null,
        service: job.service_performed,
        scheduledAt: job.scheduled_at!,
      })),
    };
  });
