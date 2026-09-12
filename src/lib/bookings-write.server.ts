/**
 * Booking writes for the owner assistant.
 *
 * `jobs` is the authoritative schedule, so every change here writes that table
 * and keeps the lead's own booking state in step, exactly as the web-chat
 * booking commit does. Every statement is scoped by `business_id`, so one
 * tenant can never move, cancel or complete another tenant's work. Nothing here
 * messages a customer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type BookingWriteResult = {
  jobId: string;
  leadId: string;
  scheduledAt: string | null;
  clash: boolean;
};

async function assertLead(businessId: string, leadId: string): Promise<{ id: string; name: string | null }> {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, name")
    .eq("business_id", businessId)
    .eq("id", leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) throw new Error("That customer is not in your leads.");
  return { id: data.id as string, name: (data.name as string | null) ?? null };
}

async function assertJob(businessId: string, jobId: string) {
  const { data } = await supabaseAdmin
    .from("jobs")
    .select("id, lead_id, scheduled_at, completion_status")
    .eq("business_id", businessId)
    .eq("id", jobId)
    .maybeSingle();
  if (!data) throw new Error("That booking is not in your schedule.");
  return data;
}

/** True when another scheduled job already holds that exact start time. */
async function hasClash(businessId: string, startsAt: string, exceptJobId?: string): Promise<boolean> {
  let query = supabaseAdmin
    .from("jobs")
    .select("id")
    .eq("business_id", businessId)
    .eq("scheduled_at", startsAt)
    .eq("completion_status", "scheduled");
  if (exceptJobId) query = query.neq("id", exceptJobId);
  const { data } = await query;
  return (data ?? []).length > 0;
}

async function audit(input: {
  businessId: string;
  userId: string;
  eventType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}) {
  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: input.eventType,
    entity_type: "job",
    entity_id: input.entityId,
    metadata: input.metadata as never,
  } as never);
}

export async function createBooking(input: {
  businessId: string;
  userId: string;
  leadId: string;
  startsAt: string;
  serviceName?: string | null;
  notes?: string | null;
}): Promise<BookingWriteResult> {
  await assertLead(input.businessId, input.leadId);
  const clash = await hasClash(input.businessId, input.startsAt);

  const { data, error } = await supabaseAdmin
    .from("jobs")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId,
      scheduled_at: input.startsAt,
      completion_status: "scheduled",
      ...(input.serviceName ? { service_performed: input.serviceName } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    } as never)
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "That booking could not be saved.");

  await supabaseAdmin
    .from("leads")
    .update({ status: "scheduled", booking_status: "scheduled" } as never)
    .eq("business_id", input.businessId)
    .eq("id", input.leadId);

  await audit({
    businessId: input.businessId,
    userId: input.userId,
    eventType: "owner_assistant_booking_created",
    entityId: data.id as string,
    metadata: { lead_id: input.leadId, scheduled_at: input.startsAt, clash },
  });

  return { jobId: data.id as string, leadId: input.leadId, scheduledAt: input.startsAt, clash };
}

export async function rescheduleBooking(input: {
  businessId: string;
  userId: string;
  jobId: string;
  startsAt: string;
}): Promise<BookingWriteResult> {
  const job = await assertJob(input.businessId, input.jobId);
  const clash = await hasClash(input.businessId, input.startsAt, input.jobId);

  const { error } = await supabaseAdmin
    .from("jobs")
    .update({ scheduled_at: input.startsAt, completion_status: "scheduled" } as never)
    .eq("business_id", input.businessId)
    .eq("id", input.jobId);
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("leads")
    .update({ status: "scheduled", booking_status: "scheduled" } as never)
    .eq("business_id", input.businessId)
    .eq("id", job.lead_id as string);

  await audit({
    businessId: input.businessId,
    userId: input.userId,
    eventType: "owner_assistant_booking_moved",
    entityId: input.jobId,
    metadata: { from: job.scheduled_at, to: input.startsAt, clash },
  });

  return {
    jobId: input.jobId,
    leadId: job.lead_id as string,
    scheduledAt: input.startsAt,
    clash,
  };
}

export async function cancelBooking(input: {
  businessId: string;
  userId: string;
  jobId: string;
  reason?: string | null;
}): Promise<BookingWriteResult> {
  const job = await assertJob(input.businessId, input.jobId);
  const wasCompleted = job.completion_status === "completed";

  const { error } = await supabaseAdmin
    .from("jobs")
    .update({
      completion_status: "cancelled",
      // A completed job that is cancelled was recorded in error, so its money
      // and completion time must leave the totals with it.
      ...(wasCompleted ? { completed_at: null, completed_value: null } : {}),
      ...(input.reason ? { notes: input.reason } : {}),
    } as never)
    .eq("business_id", input.businessId)
    .eq("id", input.jobId);
  if (error) throw new Error(error.message);

  await supabaseAdmin
    .from("leads")
    .update({ booking_status: "cancelled" } as never)
    .eq("business_id", input.businessId)
    .eq("id", job.lead_id as string);

  await audit({
    businessId: input.businessId,
    userId: input.userId,
    eventType: "owner_assistant_booking_cancelled",
    entityId: input.jobId,
    metadata: {
      lead_id: job.lead_id,
      was_scheduled_at: job.scheduled_at,
      was_completed: wasCompleted,
    },
  });

  return {
    jobId: input.jobId,
    leadId: job.lead_id as string,
    scheduledAt: job.scheduled_at as string | null,
    clash: false,
  };
}

/**
 * Permanently removes a job record — for entries logged by mistake, including
 * completed ones. The customer and their message history are kept; only this
 * job leaves the schedule and the revenue totals. Tenant-scoped.
 */
export async function deleteBooking(input: {
  businessId: string;
  userId: string;
  jobId: string;
  reason?: string | null;
}): Promise<{ jobId: string; leadId: string }> {
  const job = await assertJob(input.businessId, input.jobId);
  const leadId = job.lead_id as string;

  // Booking offers point at the job, so release them before the row goes.
  await supabaseAdmin
    .from("booking_offers")
    .update({ job_id: null, status: "withdrawn" } as never)
    .eq("business_id", input.businessId)
    .eq("job_id", input.jobId);

  const { error } = await supabaseAdmin
    .from("jobs")
    .delete()
    .eq("business_id", input.businessId)
    .eq("id", input.jobId);
  if (error) throw new Error(error.message);

  // Rebuild the customer's booking state from whatever jobs remain.
  const { data: remaining } = await supabaseAdmin
    .from("jobs")
    .select("id, completion_status, scheduled_at")
    .eq("business_id", input.businessId)
    .eq("lead_id", leadId)
    .order("scheduled_at", { ascending: false });
  const rows = remaining ?? [];
  const hasScheduled = rows.some((row) => row.completion_status === "scheduled");
  const hasCompleted = rows.some((row) => row.completion_status === "completed");

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("status")
    .eq("business_id", input.businessId)
    .eq("id", leadId)
    .maybeSingle();
  const leadStatus = (lead as { status?: string } | null)?.status ?? null;
  const derivedBooking = hasScheduled ? "scheduled" : hasCompleted ? "completed" : null;
  const patch: Record<string, unknown> = { booking_status: derivedBooking };
  if (!hasScheduled && !hasCompleted && (leadStatus === "scheduled" || leadStatus === "completed")) {
    patch["status"] = "contacted";
  }
  await supabaseAdmin
    .from("leads")
    .update(patch as never)
    .eq("business_id", input.businessId)
    .eq("id", leadId);

  await audit({
    businessId: input.businessId,
    userId: input.userId,
    eventType: "owner_assistant_booking_deleted",
    entityId: input.jobId,
    metadata: {
      lead_id: leadId,
      was_status: job.completion_status,
      was_scheduled_at: job.scheduled_at,
      reason: input.reason ?? null,
    },
  });

  return { jobId: input.jobId, leadId };
}


/**
 * Marks work as done. When no job id is given, the customer's most recent job
 * is completed; when they have none, a completed job is recorded for today so
 * the revenue figures stay truthful.
 */
export async function completeJob(input: {
  businessId: string;
  userId: string;
  leadId: string;
  jobId?: string | null;
  paidAmount?: number | null;
  serviceName?: string | null;
}): Promise<{ jobId: string; paidAmount: number | null }> {
  await assertLead(input.businessId, input.leadId);
  const nowIso = new Date().toISOString();
  const completion = {
    completion_status: "completed",
    completed_at: nowIso,
    ...(input.paidAmount === null || input.paidAmount === undefined
      ? {}
      : { completed_value: input.paidAmount }),
    ...(input.serviceName ? { service_performed: input.serviceName } : {}),
  };

  let jobId = input.jobId ?? null;
  if (jobId) {
    await assertJob(input.businessId, jobId);
  } else {
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, created_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .neq("completion_status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1);
    jobId = ((jobs ?? [])[0]?.id as string | undefined) ?? null;
  }

  if (jobId) {
    const { error } = await supabaseAdmin
      .from("jobs")
      .update(completion as never)
      .eq("business_id", input.businessId)
      .eq("id", jobId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await supabaseAdmin
      .from("jobs")
      .insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        scheduled_at: nowIso,
        ...completion,
      } as never)
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "That job could not be recorded.");
    jobId = data.id as string;
  }

  await supabaseAdmin
    .from("leads")
    .update({
      status: "completed",
      booking_status: "completed",
      customer_status: "previous_customer",
    } as never)
    .eq("business_id", input.businessId)
    .eq("id", input.leadId);

  await audit({
    businessId: input.businessId,
    userId: input.userId,
    eventType: "owner_assistant_job_completed",
    entityId: jobId,
    metadata: { lead_id: input.leadId, paid_amount: input.paidAmount ?? null },
  });

  return { jobId, paidAmount: input.paidAmount ?? null };
}
