/**
 * Owner assistant: applying a confirmed single-customer update.
 *
 * Every read and write is scoped by `business_id`, so one tenant can never see
 * or change another tenant's customer. Nothing here messages the customer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  describeLeadUpdate,
  type LeadDetailPatch,
  type LeadUpdateRequest,
} from "@/lib/owner-lead-actions";

export type LeadUpdateProposal = {
  kind: "lead_update";
  leadId: string;
  leadName: string;
  lines: string[];
  summary: string;
  details: LeadDetailPatch;
  markCompleted: boolean;
  paidAmount: number | null;
  bookAt: string | null;
};

/** Finds the tenant's own lead by the name the owner typed. */
async function findLead(
  businessId: string,
  name: string,
): Promise<{ id: string; name: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id, name, created_at")
    .eq("business_id", businessId)
    .is("deleted_at", null)
    .ilike("name", `%${name}%`)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = data ?? [];
  if (rows.length === 0) return null;
  // Prefer an exact (case-insensitive) name match when several people match.
  const exact = rows.find((row) => (row.name ?? "").trim().toLowerCase() === name.toLowerCase());
  const chosen = exact ?? rows[0]!;
  return { id: chosen.id as string, name: (chosen.name as string | null) ?? null };
}

/** Prepares a proposal for the owner to confirm. Writes nothing. */
export async function proposeLeadUpdate(input: {
  businessId: string;
  request: LeadUpdateRequest;
}): Promise<{ message: string; proposal: LeadUpdateProposal | null }> {
  const lead = await findLead(input.businessId, input.request.name);
  if (!lead) {
    return {
      message: `I could not find a customer called ${input.request.name} in your leads, so nothing was changed.`,
      proposal: null,
    };
  }

  const leadName = lead.name ?? input.request.name;
  const lines = describeLeadUpdate({ leadName, request: input.request });
  if (lines.length === 0) {
    return { message: "I could not tell what to update, so nothing was changed.", proposal: null };
  }

  return {
    message: `Here is what I will do for ${leadName}. Nothing changes until you confirm.`,
    proposal: {
      kind: "lead_update",
      leadId: lead.id,
      leadName,
      lines,
      summary: lines.join(" "),
      details: input.request.details,
      markCompleted: input.request.markCompleted,
      paidAmount: input.request.paidAmount,
      bookAt: input.request.bookAt,
    },
  };
}

/** Applies a confirmed single-customer update. Sends no message to anyone. */
export async function applyLeadUpdate(input: {
  businessId: string;
  userId: string;
  leadId: string;
  details: LeadDetailPatch;
  markCompleted: boolean;
  paidAmount: number | null;
  bookAt: string | null;
}): Promise<{ updatedDetails: number; completed: boolean; booked: boolean }> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("business_id", input.businessId)
    .eq("id", input.leadId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) throw new Error("That customer is no longer in your leads.");

  const leadPatch: Record<string, unknown> = { ...input.details };
  const nowIso = new Date().toISOString();

  if (input.markCompleted) {
    // The most recent visit is the one the owner just finished.
    const { data: jobs } = await supabaseAdmin
      .from("jobs")
      .select("id, scheduled_at, created_at")
      .eq("business_id", input.businessId)
      .eq("lead_id", input.leadId)
      .order("created_at", { ascending: false })
      .limit(1);
    const existing = (jobs ?? [])[0];
    const completion = {
      completion_status: "completed",
      completed_at: nowIso,
      ...(input.paidAmount === null ? {} : { completed_value: input.paidAmount }),
    };
    if (existing) {
      const { error } = await supabaseAdmin
        .from("jobs")
        .update(completion as never)
        .eq("business_id", input.businessId)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("jobs").insert({
        business_id: input.businessId,
        lead_id: input.leadId,
        scheduled_at: nowIso,
        ...completion,
      } as never);
      if (error) throw new Error(error.message);
    }
    leadPatch["status"] = "completed";
    leadPatch["customer_status"] = "previous_customer";
  }

  if (input.bookAt) {
    const { error } = await supabaseAdmin.from("jobs").insert({
      business_id: input.businessId,
      lead_id: input.leadId,
      scheduled_at: input.bookAt,
      completion_status: "scheduled",
    } as never);
    if (error) throw new Error(error.message);
    leadPatch["status"] = "scheduled";
    leadPatch["booking_status"] = "scheduled";
  }

  if (Object.keys(leadPatch).length > 0) {
    const { error } = await supabaseAdmin
      .from("leads")
      .update(leadPatch as never)
      .eq("business_id", input.businessId)
      .eq("id", input.leadId);
    if (error) throw new Error(error.message);
  }

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: "owner_assistant_lead_updated",
    entity_type: "lead",
    entity_id: input.leadId,
    metadata: {
      details: input.details,
      completed: input.markCompleted,
      paid_amount: input.paidAmount,
      booked_at: input.bookAt,
    } as never,
  } as never);

  return {
    updatedDetails: Object.keys(input.details).length,
    completed: input.markCompleted,
    booked: Boolean(input.bookAt),
  };
}
