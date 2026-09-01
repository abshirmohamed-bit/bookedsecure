// Owner-only permanent deletion of already soft-deleted leads.
//
// SAFETY BOUNDARY: this module only ever deletes `public.leads` rows that
// belong to the caller's business AND already have `deleted_at` set, plus the
// dependent records the database cascades (conversations, ai_outputs,
// notifications, automation_jobs). Retention-protected records — messages,
// consent_events, jobs/revenue — block the deletion instead. AI usage events
// and CRM import rows are retained and detached. No provider, SMS, AI,
// automation-rule or usage-total write happens anywhere in this path.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  PENDING_AUTOMATION_STATUSES,
  blockReasonText,
  normaliseSelection,
  planPermanentDelete,
  retainedText,
  type LeadDependencies,
  type PurgeOutcome,
  type PurgeResult,
} from "@/lib/lead-purge";
import type { DeletableLead } from "@/lib/lead-deletion";

type Client = SupabaseClient<Database>;

type RequestRow = {
  id: string;
  request_id: string;
  status: string;
  requested_count: number;
  deleted_count: number;
  failed_count: number;
  failures: unknown;
};

function outcomesOf(value: unknown): PurgeOutcome[] {
  return Array.isArray(value) ? (value as PurgeOutcome[]) : [];
}

async function loadDependencies(
  client: Client,
  businessId: string,
  leadIds: string[],
): Promise<Record<string, Partial<LeadDependencies>>> {
  const empty: Record<string, Partial<LeadDependencies>> = {};
  if (leadIds.length === 0) return empty;

  const [messages, consents, jobs, automation, conversations, aiOutputs, notifications, usage, importRows] =
    await Promise.all([
      client.from("messages").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client.from("consent_events").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client.from("jobs").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client
        .from("automation_jobs")
        .select("lead_id, status")
        .eq("business_id", businessId)
        .in("lead_id", leadIds),
      client.from("conversations").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client.from("ai_outputs").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client.from("notifications").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client.from("ai_usage_events").select("lead_id").eq("business_id", businessId).in("lead_id", leadIds),
      client
        .from("lead_import_rows")
        .select("resulting_lead_id, dedupe_match_lead_id")
        .eq("business_id", businessId),
    ]);

  const deps: Record<string, Partial<LeadDependencies>> = {};
  const bump = (leadId: unknown, key: keyof LeadDependencies) => {
    if (typeof leadId !== "string" || !leadIds.includes(leadId)) return;
    const entry = (deps[leadId] ??= {});
    entry[key] = (entry[key] ?? 0) + 1;
  };

  for (const row of messages.data ?? []) bump(row.lead_id, "messages");
  for (const row of consents.data ?? []) bump(row.lead_id, "consentEvents");
  for (const row of jobs.data ?? []) bump(row.lead_id, "jobs");
  for (const row of automation.data ?? []) {
    if (PENDING_AUTOMATION_STATUSES.has(String(row.status))) bump(row.lead_id, "pendingAutomationJobs");
  }
  for (const row of conversations.data ?? []) bump(row.lead_id, "conversations");
  for (const row of aiOutputs.data ?? []) bump(row.lead_id, "aiOutputs");
  for (const row of notifications.data ?? []) bump(row.lead_id, "notifications");
  for (const row of usage.data ?? []) bump(row.lead_id, "aiUsageEvents");
  for (const row of importRows.data ?? []) {
    bump(row.resulting_lead_id, "importRows");
    bump(row.dedupe_match_lead_id, "importRows");
  }
  return deps;
}

/**
 * Permanently deletes the selected soft-deleted leads.
 *
 * Idempotent: replaying the same `requestId` returns the recorded outcome and
 * deletes nothing further. Eligibility is re-checked from the database inside
 * this call, immediately before each delete, so a lead restored or changed in
 * the meantime is skipped rather than destroyed.
 */
export async function permanentlyDeleteLeads(
  client: Client,
  input: {
    businessId: string;
    actorUserId: string;
    requestId: string;
    leadIds: string[];
    reason?: string | null;
  },
): Promise<PurgeResult> {
  const requestedIds = normaliseSelection(input.leadIds);
  const reason = input.reason?.trim() || null;

  const { data: existing } = (await client
    .from("lead_deletion_requests")
    .select("id, request_id, status, requested_count, deleted_count, failed_count, failures")
    .eq("business_id", input.businessId)
    .eq("request_id", input.requestId)
    .maybeSingle()) as { data: RequestRow | null };

  if (existing) {
    if (existing.status === "processing") {
      throw new Error("A permanent deletion request for these leads is already processing.");
    }
    return {
      requestId: input.requestId,
      requested: existing.requested_count,
      deleted: existing.deleted_count,
      blocked: existing.failed_count,
      outcomes: outcomesOf(existing.failures),
      idempotentReplay: true,
    };
  }

  const { data: created, error: createError } = await client
    .from("lead_deletion_requests")
    .insert({
      business_id: input.businessId,
      request_id: input.requestId,
      actor_user_id: input.actorUserId,
      action: "permanent_delete",
      reason,
      requested_lead_ids: requestedIds,
      requested_count: requestedIds.length,
      status: "processing",
    })
    .select("id")
    .single();
  if (createError || !created) {
    throw new Error(createError?.message ?? "Could not open a permanent deletion request.");
  }

  // Tenant-scoped, soft-deleted-only re-read: the client never supplies scope.
  const { data: leadRows } = await client
    .from("leads")
    .select("id, name, mobile_number, source_channel, lead_origin, source_metadata, import_batch_id, deleted_at")
    .eq("business_id", input.businessId)
    .not("deleted_at", "is", null)
    .in("id", requestedIds);

  const leads = (leadRows ?? []) as unknown as (DeletableLead & { deleted_at?: string | null })[];
  const dependenciesByLead = await loadDependencies(
    client,
    input.businessId,
    leads.map((lead) => lead.id),
  );
  const plan = planPermanentDelete({ requestedIds, leads, dependenciesByLead });
  const byId = new Map(leads.map((lead) => [lead.id, lead]));

  const outcomes: PurgeOutcome[] = [...plan.blocked];
  let deleted = 0;

  for (const leadId of plan.toPurge) {
    const lead = byId.get(leadId)!;
    const eligibility = plan.eligibility.find((entry) => entry.leadId === leadId)!;
    const retained = retainedText(eligibility.retained);

    // Retention: detach records policy requires keeping, before the delete.
    await client
      .from("ai_usage_events")
      .update({ lead_id: null })
      .eq("business_id", input.businessId)
      .eq("lead_id", leadId);
    await client
      .from("lead_import_rows")
      .update({ resulting_lead_id: null })
      .eq("business_id", input.businessId)
      .eq("resulting_lead_id", leadId);
    await client
      .from("lead_import_rows")
      .update({ dedupe_match_lead_id: null })
      .eq("business_id", input.businessId)
      .eq("dedupe_match_lead_id", leadId);

    // Audit trail written BEFORE completion. Ids and counts only.
    await client.from("audit_events").insert({
      business_id: input.businessId,
      user_id: input.actorUserId,
      event_type: "lead_permanently_deleted",
      entity_type: "lead",
      entity_id: leadId,
      metadata: {
        request_id: input.requestId,
        lead_id: leadId,
        tenant_id: input.businessId,
        actor_user_id: input.actorUserId,
        reason,
        deleted_at: new Date().toISOString(),
        retained_dependencies: retained,
        removed_dependencies: eligibility.removes,
      },
    });

    // Final race guard: only a still-soft-deleted row of this tenant is removed.
    const { data: removed, error } = await client
      .from("leads")
      .delete()
      .eq("business_id", input.businessId)
      .eq("id", leadId)
      .not("deleted_at", "is", null)
      .select("id");

    if (error || (removed ?? []).length === 0) {
      outcomes.push({
        leadId,
        name: lead.name ?? null,
        status: "blocked",
        reason: error?.message ?? "Lead was no longer eligible when the deletion ran",
        retained,
      });
      continue;
    }

    deleted += 1;
    outcomes.push({ leadId, name: lead.name ?? null, status: "deleted", reason: null, retained });
  }

  const blocked = outcomes.filter((outcome) => outcome.status === "blocked").length;

  await client
    .from("lead_deletion_requests")
    .update({
      status: "completed",
      deleted_count: deleted,
      failed_count: blocked,
      failures: outcomes,
    })
    .eq("id", created.id);

  await client.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.actorUserId,
    event_type: "leads_permanently_deleted",
    entity_type: "lead",
    entity_id: null,
    metadata: {
      request_id: input.requestId,
      selected_lead_ids: requestedIds,
      requested_count: requestedIds.length,
      deleted_count: deleted,
      blocked_count: blocked,
      blocked_reasons: outcomes
        .filter((outcome) => outcome.status === "blocked")
        .map((outcome) => ({ lead_id: outcome.leadId, reason: outcome.reason })),
      reason,
    },
  });

  void blockReasonText;

  return {
    requestId: input.requestId,
    requested: requestedIds.length,
    deleted,
    blocked,
    outcomes,
    idempotentReplay: false,
  };
}
