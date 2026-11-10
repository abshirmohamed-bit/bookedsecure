/**
 * Marks booked jobs as done once their time has passed, for businesses that
 * turned on "Complete jobs automatically". Cancelled jobs are never touched,
 * and a job already marked done by the owner keeps the owner's figures. The
 * job's value comes from the business's own service price, so "Completed work"
 * rises as soon as the job is done. Runs from the 10-minute follow-ups hook.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isDueForAutoComplete, jobEndsAt, jobValueFromPrice } from "@/lib/job-autocomplete";

// businesses.auto_complete_jobs arrives with migration 0047.
const db = () => supabaseAdmin as unknown as SupabaseClient;

export async function processDueAutoCompletions(now = new Date()): Promise<{ completed: number; businesses: number }> {
  const { data: businesses, error } = await db().from("businesses").select("id").eq("auto_complete_jobs", true).limit(500);
  if (error) return { completed: 0, businesses: 0 }; // Before migration 0047 nothing is switched on.
  let completed = 0;
  for (const business of (businesses ?? []) as { id: string }[]) {
    completed += await completeDueJobsFor(business.id, now);
  }
  return { completed, businesses: (businesses ?? []).length };
}

async function completeDueJobsFor(businessId: string, now: Date): Promise<number> {
  const { data: jobs, error } = await supabaseAdmin
    .from("jobs")
    .select("id, lead_id, service_id, scheduled_at, completion_status, completed_value")
    .eq("business_id", businessId)
    .eq("completion_status", "scheduled")
    .lte("scheduled_at", now.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(200);
  if (error || !jobs?.length) return 0;

  const serviceIds = [...new Set(jobs.map((j) => j.service_id).filter(Boolean) as string[])];
  const { data: services } = serviceIds.length
    ? await supabaseAdmin.from("services").select("id, name, price_guidance, duration_minutes").eq("business_id", businessId).in("id", serviceIds)
    : { data: [] as { id: string; name: string; price_guidance: string | null; duration_minutes: number | null }[] };
  const byId = new Map((services ?? []).map((s) => [s.id, s]));

  let done = 0;
  for (const job of jobs) {
    const service = job.service_id ? byId.get(job.service_id) : undefined;
    if (!isDueForAutoComplete(job, service?.duration_minutes, now)) continue;
    const value = job.completed_value ?? jobValueFromPrice(service?.price_guidance);
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("jobs")
      .update({
        completion_status: "completed",
        completed_at: jobEndsAt(job.scheduled_at!, service?.duration_minutes).toISOString(),
        ...(value !== null ? { completed_value: value } : {}),
        ...(service?.name ? { service_performed: service.name } : {}),
      } as never)
      .eq("business_id", businessId)
      .eq("id", job.id)
      // Only if it is still booked: a cancellation or manual completion in the meantime wins.
      .eq("completion_status", "scheduled")
      .select("id")
      .maybeSingle();
    if (updateError || !updated) continue;
    done++;

    if (job.lead_id) {
      // The customer becomes a past customer once nothing else is booked for them.
      const { count } = await supabaseAdmin
        .from("jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .eq("lead_id", job.lead_id)
        .eq("completion_status", "scheduled");
      if (!count) {
        await supabaseAdmin
          .from("leads")
          .update({ status: "completed", booking_status: "completed", customer_status: "previous_customer" } as never)
          .eq("business_id", businessId)
          .eq("id", job.lead_id);
      }
    }
    await supabaseAdmin.from("audit_events").insert({
      business_id: businessId,
      user_id: null,
      event_type: "job_auto_completed",
      entity_type: "job",
      entity_id: job.id,
      metadata: { lead_id: job.lead_id, value, from_price: job.completed_value === null && value !== null },
    } as never);
  }
  return done;
}

/** Owner setting: read and change "Complete jobs automatically". */
export async function getAutoCompleteSetting(businessId: string): Promise<{ enabled: boolean; available: boolean }> {
  const { data, error } = await db().from("businesses").select("auto_complete_jobs").eq("id", businessId).maybeSingle();
  if (error) return { enabled: false, available: false };
  return { enabled: Boolean((data as { auto_complete_jobs?: boolean } | null)?.auto_complete_jobs), available: true };
}

export async function setAutoCompleteSetting(businessId: string, userId: string, enabled: boolean): Promise<void> {
  const { error } = await db().from("businesses").update({ auto_complete_jobs: enabled }).eq("id", businessId);
  if (error) throw new Error("This setting is waiting for a BookedSecure update (migration 0047).");
  await supabaseAdmin.from("audit_events").insert({
    business_id: businessId,
    user_id: userId,
    event_type: enabled ? "auto_complete_jobs_on" : "auto_complete_jobs_off",
    entity_type: "business",
    entity_id: businessId,
    metadata: {},
  } as never);
}
