// Owner-confirmed clearing of the SMS automation pause for one lead.
//
// SAFETY BOUNDARY: this module only clears `sms_suppressed_at` /
// `sms_suppression_reason` on one tenant-scoped lead and appends one audit
// event. It never sends an SMS, never calls a provider, never creates or edits a
// message or conversation, never touches automation jobs, usage, jobs, revenue,
// attribution, quiet hours, delivery history or reachability evidence.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assessSuppressionRecovery,
  type SuppressionRecoveryLead,
} from "@/lib/sms/suppression-recovery";

type Client = SupabaseClient<Database>;

const LEAD_COLUMNS =
  "id, business_id, sms_suppressed_at, sms_suppression_reason, last_sms_failure_code, last_sms_failure_reason, reachability_state, reachability_evidence, reachability_evidence_at, last_successful_delivery_at, last_permanent_failure_at, last_inbound_reply_at";

export type ResumeAutomationResult = {
  status: "resumed" | "already_resumed" | "not_found";
  leadId: string;
  message: string;
  /** Suppression state that was cleared, for the caller's confirmation copy. */
  previousSuppressionReason?: string | null;
  previousSuppressedAt?: string | null;
};

export async function resumeSuppressedAutomation(
  client: Client,
  input: {
    businessId: string;
    actorUserId: string;
    leadId: string;
    confirmedAt?: string;
  },
): Promise<ResumeAutomationResult> {
  const { data: lead } = await client
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .maybeSingle();

  if (!lead) {
    return {
      status: "not_found",
      leadId: input.leadId,
      message: "Lead not found for this business.",
    };
  }

  const record = lead as unknown as SuppressionRecoveryLead;
  const view = assessSuppressionRecovery(record);

  // Idempotent: a repeated submission finds no active pause, changes nothing
  // and writes no second audit event.
  if (!view.suppressed) {
    return {
      status: "already_resumed",
      leadId: input.leadId,
      message: "Automated SMS is no longer paused for this lead.",
    };
  }

  const confirmedAt = input.confirmedAt ?? new Date().toISOString();

  // Clear ONLY the active suppression state read by sendSms. Permanent-failure
  // history and reachability evidence are untouched.
  await client
    .from("leads")
    .update({ sms_suppressed_at: null, sms_suppression_reason: null } as never)
    .eq("id", input.leadId)
    .eq("business_id", input.businessId)
    .not("sms_suppressed_at", "is", null);

  await client.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.actorUserId,
    event_type: "sms_suppression_resumed_by_owner",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      action: "review_and_resume_automation",
      previous_suppression_reason: view.pausedReason,
      previous_suppressed_at: view.pausedAt,
      reachability_state: record.reachability_state ?? null,
      reachability_evidence: view.evidence,
      reachability_evidence_at: view.evidenceAt,
      last_permanent_failure_at: record.last_permanent_failure_at ?? null,
      confirmed_at: confirmedAt,
    } as never,
  });

  return {
    status: "resumed",
    leadId: input.leadId,
    message: "Automated SMS is eligible again. Nothing was sent.",
    previousSuppressionReason: view.pausedReason,
    previousSuppressedAt: view.pausedAt,
  };
}
