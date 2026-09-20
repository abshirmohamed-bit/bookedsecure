// Durable background job queue for automated outbound work.
// Server-only: reached through server functions or the cron server route.
//
// Every automated action (acknowledgement SMS, follow-up SMS, owner alert) is
// first persisted as a job row, then attempted. If the attempt fails the row
// stays queued with a bounded retry schedule, so nothing is lost when a request
// is interrupted (e.g. the visitor closes the browser mid-submission).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AUTOMATION_STOP_STATUSES } from "@/lib/domain";
import {
  attributionFromJobRow,
  jobAttributionColumns,
  normaliseAgentAttribution,
  type AgentAttributionInput,
} from "@/lib/agent-attribution";

export type JobType = "acknowledgement" | "follow_up" | "owner_alert" | "booking_confirmation";

/** Bounded retry: attempt 1 immediately, then +5 min, then +30 min. */
export const RETRY_DELAYS_MINUTES = [5, 30];
export const MAX_ATTEMPTS = 3;

/** Lead states that permanently stop automated outbound work (shared, pure). */
const STOP_STATUSES = new Set<string>(AUTOMATION_STOP_STATUSES);

export type JobRow = {
  id: string;
  business_id: string;
  lead_id: string | null;
  job_type: string;
  step: number;
  idempotency_key: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  sequence_id?: string | null;
  agent_action_id?: string | null;
  sequence_step_template_id?: string | null;
};

const JOB_COLUMNS =
  "id, business_id, lead_id, job_type, step, idempotency_key, payload, status, attempt_count, max_attempts, sequence_id, agent_action_id, sequence_step_template_id";

/** Creates a job unless one with the same idempotency key already exists. */
export async function enqueueJob(input: {
  businessId: string;
  leadId?: string | null;
  jobType: JobType;
  step?: number;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  /** Optional agent-sequence attribution (metadata only. never activates anything). */
  attribution?: AgentAttributionInput | undefined;
}): Promise<{ job: JobRow | null; created: boolean; reason?: string }> {
  const validated = normaliseAgentAttribution(input.attribution);
  if (!validated.ok) return { job: null, created: false, reason: validated.reason };
  const { data: existing } = await supabaseAdmin
    .from("automation_jobs")
    .select(JOB_COLUMNS)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return { job: existing as JobRow, created: false };

  const { data, error } = await supabaseAdmin
    .from("automation_jobs")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      job_type: input.jobType,
      step: input.step ?? 0,
      idempotency_key: input.idempotencyKey,
      payload: (input.payload ?? null) as never,
      run_at: (input.runAt ?? new Date()).toISOString(),
      ...jobAttributionColumns(validated.attribution),
    })
    .select(JOB_COLUMNS)
    .maybeSingle();

  if (error) {
    // Unique-key race: another request enqueued the same job first.
    const { data: raced } = await supabaseAdmin
      .from("automation_jobs")
      .select(JOB_COLUMNS)
      .eq("idempotency_key", input.idempotencyKey)
      .maybeSingle();
    return { job: (raced as JobRow) ?? null, created: false };
  }
  return { job: data as JobRow, created: true };
}

async function finishJob(
  job: JobRow,
  status: "succeeded" | "failed" | "cancelled",
  reason: string | null,
) {
  await supabaseAdmin
    .from("automation_jobs")
    .update({
      status,
      failure_reason: reason,
      next_attempt_at: null,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

async function requeueJob(job: JobRow, attempt: number, reason: string) {
  const delay = RETRY_DELAYS_MINUTES[attempt - 1] ?? RETRY_DELAYS_MINUTES.at(-1) ?? 30;
  const next = new Date(Date.now() + delay * 60 * 1000).toISOString();
  await supabaseAdmin
    .from("automation_jobs")
    .update({
      status: "pending",
      failure_reason: reason,
      next_attempt_at: next,
      run_at: next,
      last_attempt_at: new Date().toISOString(),
    })
    .eq("id", job.id);
}

/** Owner-facing in-app alert. De-duplicated by idempotency key. */
export async function createNotification(input: {
  businessId: string;
  leadId?: string | null;
  kind: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<{ created: boolean; id?: string }> {
  const { data: existing } = await supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) return { created: false, id: existing.id };

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId ?? null,
      kind: input.kind,
      title: input.title,
      body: input.body,
      metadata: (input.metadata ?? null) as never,
      idempotency_key: input.idempotencyKey,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) return { created: false };
  return { created: true, id: data.id };
}

type Outcome =
  | { ok: true; note?: string }
  | { ok: false; retriable: boolean; reason: string };

async function guardLead(job: JobRow): Promise<Outcome | null> {
  if (!job.lead_id) return null;
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id, status, opted_out_at")
    .eq("id", job.lead_id)
    .maybeSingle();
  if (!lead) return { ok: false, retriable: false, reason: "Lead no longer exists." };
  if (lead.opted_out_at)
    return { ok: false, retriable: false, reason: "Lead opted out. automation stopped." };
  if (STOP_STATUSES.has(lead.status))
    return { ok: false, retriable: false, reason: `Lead status "${lead.status}" stops automation.` };

  const { data: conversation } = await supabaseAdmin
    .from("conversations")
    .select("automation_paused")
    .eq("lead_id", job.lead_id)
    .maybeSingle();
  if (conversation?.automation_paused)
    return { ok: false, retriable: false, reason: "Automation paused by the owner." };
  return null;
}

async function performJob(job: JobRow): Promise<Outcome> {
  const payload = (job.payload ?? {}) as Record<string, unknown>;

  if (job.job_type === "owner_alert") {
    const result = await createNotification({
      businessId: job.business_id,
      leadId: job.lead_id,
      kind: "new_lead",
      title: String(payload["title"] ?? "New lead"),
      body: String(payload["body"] ?? ""),
      metadata: (payload["metadata"] ?? null) as Record<string, unknown>,
      idempotencyKey: job.idempotency_key,
    });
    return { ok: true, ...(result.created ? {} : { note: "Notification already existed." }) };
  }

  // Released operational booking confirmation. Eligibility, consent, callback
  // number and idempotency are all re-evaluated at release time.
  if (job.job_type === "booking_confirmation") {
    const offerId = String(payload["offer_id"] ?? "");
    if (!offerId || !job.lead_id)
      return { ok: false, retriable: false, reason: "Booking confirmation job is missing its booking." };
    const { deliverBookingConfirmation } = await import("@/lib/booking-confirmation.server");
    const result = await deliverBookingConfirmation({
      businessId: job.business_id,
      leadId: job.lead_id,
      offerId,
      fromRelease: true,
    });
    if (result.sent || result.outcome === "duplicate_suppressed") return { ok: true, note: result.reason };
    if (result.outcome === "failed") return { ok: false, retriable: true, reason: result.reason };
    return { ok: false, retriable: false, reason: result.reason };
  }

  // SMS jobs share the single outbound path (opt-out, caps, sender, idempotency).
  const blocked = await guardLead(job);
  if (blocked) return blocked;

  const { sendSms } = await import("@/lib/lead-engine.server");
  const result = await sendSms({
    businessId: job.business_id,
    leadId: job.lead_id!,
    body: String(payload["body"] ?? ""),
    kind: job.job_type === "acknowledgement" ? "acknowledgement" : "follow_up",
    idempotencyKey: job.idempotency_key,
    respectAutomation: true,
    // Attribution passthrough: a job created with attribution hands exactly the
    // same values to the outbound path. Jobs without attribution pass nulls,
    // which is byte-identical to the legacy call.
    ...attributionFromJobRow(job),
  });

  if (result.sent) return { ok: true };
  if (result.duplicate) return { ok: true, note: "Duplicate suppressed. already sent." };
  return {
    ok: false,
    retriable: result.retriable === true,
    reason: result.reason ?? "Send failed.",
  };
}

export type JobResult = {
  jobId: string;
  jobType: string;
  status: "succeeded" | "retrying" | "failed" | "cancelled";
  attempt: number;
  reason?: string;
};

/** Runs one job, applying the bounded retry policy. */
export async function runJob(job: JobRow): Promise<JobResult> {
  const attempt = job.attempt_count + 1;
  await supabaseAdmin
    .from("automation_jobs")
    .update({ attempt_count: attempt, last_attempt_at: new Date().toISOString(), status: "running" })
    .eq("id", job.id);

  let outcome: Outcome;
  try {
    outcome = await performJob({ ...job, attempt_count: attempt });
  } catch (error) {
    outcome = {
      ok: false,
      retriable: true,
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (outcome.ok) {
    await finishJob(job, "succeeded", outcome.note ?? null);
    return { jobId: job.id, jobType: job.job_type, status: "succeeded", attempt };
  }

  if (!outcome.retriable) {
    await finishJob(job, "cancelled", outcome.reason);
    return {
      jobId: job.id,
      jobType: job.job_type,
      status: "cancelled",
      attempt,
      reason: outcome.reason,
    };
  }

  if (attempt >= job.max_attempts) {
    await finishJob(job, "failed", outcome.reason);
    await supabaseAdmin.from("audit_events").insert({
      business_id: job.business_id,
      event_type: "automation_job_failed",
      entity_type: "lead",
      entity_id: job.lead_id,
      metadata: { job_type: job.job_type, attempts: attempt, reason: outcome.reason } as never,
    });
    return {
      jobId: job.id,
      jobType: job.job_type,
      status: "failed",
      attempt,
      reason: outcome.reason,
    };
  }

  await requeueJob(job, attempt, outcome.reason);
  return {
    jobId: job.id,
    jobType: job.job_type,
    status: "retrying",
    attempt,
    reason: outcome.reason,
  };
}

/** Runs a single job by id (used right after enqueue, inside the same request). */
export async function runJobById(jobId: string): Promise<JobResult | null> {
  const { data } = await supabaseAdmin
    .from("automation_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .in("status", ["pending"])
    .maybeSingle();
  if (!data) return null;
  return await runJob(data as JobRow);
}

/**
 * Reclaims jobs left in "running" because the request that started them was
 * interrupted (e.g. the visitor closed the browser mid-submission). After the
 * lease window they go back to pending so the scheduler retries them.
 */
const RUNNING_LEASE_MINUTES = 5;

export async function reclaimStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - RUNNING_LEASE_MINUTES * 60 * 1000).toISOString();
  const { data } = await supabaseAdmin
    .from("automation_jobs")
    .update({
      status: "pending",
      run_at: new Date().toISOString(),
      next_attempt_at: new Date().toISOString(),
      failure_reason: "Previous attempt was interrupted before it finished.",
    })
    .eq("status", "running")
    .lt("last_attempt_at", cutoff)
    .select("id");
  return (data ?? []).length;
}

/** Runs every job that is due. Safe to call repeatedly. */
export async function processDueJobs(limit = 50): Promise<JobResult[]> {
  await reclaimStaleJobs();
  const { data: due } = await supabaseAdmin
    .from("automation_jobs")
    .select(JOB_COLUMNS)
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(limit);


  const results: JobResult[] = [];
  for (const job of due ?? []) {
    results.push(await runJob(job as JobRow));
  }
  return results;
}
