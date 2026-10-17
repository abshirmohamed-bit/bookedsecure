/**
 * Tenant-scoped booking reads. Every query filters on `business_id`; nothing is
 * written here.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { bookingState, resolveServiceName, type BookingEntry } from "@/lib/bookings";

type JobRow = {
  id: string;
  lead_id: string;
  scheduled_at: string | null;
  completed_at: string | null;
  completed_value: number | null;
  completion_status: string | null;
  service_performed: string | null;
  notes: string | null;
  services: { name: string | null } | null;
};

export async function loadBookings(
  businessId: string,
  range?: { from?: string | null; to?: string | null },
): Promise<BookingEntry[]> {
  let query = supabaseAdmin
    .from("jobs")
    .select(
      "id, lead_id, scheduled_at, completed_at, completed_value, completion_status, service_performed, notes, services(name)",
    )
    .eq("business_id", businessId)
    .order("scheduled_at", { ascending: true });
  if (range?.from) query = query.gte("scheduled_at", range.from);
  if (range?.to) query = query.lte("scheduled_at", range.to);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const jobs = (data ?? []) as JobRow[];
  if (jobs.length === 0) return [];

  const leadIds = [...new Set(jobs.map((job) => job.lead_id))];
  const [{ data: leads }, { data: offers }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("id, name, mobile_number, service_address, suburb, service_intent, deleted_at")
      .eq("business_id", businessId)
      .in("id", leadIds),
    supabaseAdmin
      .from("booking_offers")
      .select("job_id, service_name_snapshot")
      .eq("business_id", businessId)
      .in("job_id", jobs.map((job) => job.id)),
  ]);

  const leadById = new Map((leads ?? []).map((lead) => [lead.id, lead]));
  const offerByJob = new Map(
    (offers ?? []).filter((offer) => offer.job_id).map((offer) => [offer.job_id as string, offer]),
  );

  return jobs
    .filter((job) => {
      const lead = leadById.get(job.lead_id);
      return lead ? !lead.deleted_at : false;
    })
    .map((job) => {
      const lead = leadById.get(job.lead_id);
      return {
        jobId: job.id,
        leadId: job.lead_id,
        customerName: lead?.name ?? null,
        phone: lead?.mobile_number ?? null,
        serviceName: resolveServiceName({
          servicePerformed: job.service_performed,
          offerServiceName: offerByJob.get(job.id)?.service_name_snapshot ?? null,
          jobServiceName: job.services?.name ?? null,
          leadServiceIntent: (lead as { service_intent?: string | null } | undefined)?.service_intent ?? null,
        }),
        scheduledAt: job.scheduled_at,
        state: bookingState(job.completion_status),
        completedValue: job.completed_value === null ? null : Number(job.completed_value),
        completedAt: job.completed_at,
        address: lead?.service_address ?? null,
        suburb: lead?.suburb ?? null,
        notes: job.notes,
      } satisfies BookingEntry;
    });
}

export async function loadBooking(
  businessId: string,
  jobId: string,
): Promise<BookingEntry | null> {
  const all = await loadBookings(businessId);
  return all.find((entry) => entry.jobId === jobId) ?? null;
}
