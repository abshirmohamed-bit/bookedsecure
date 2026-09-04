// Applies the completed-quote classification to a lead, server-side.
//
// Staged production behaviour: when a public quote conversation completes and
// every server-verified condition in `classifyCompletedQuoteLead` holds, the
// lead's context becomes `active_form_enquiry`. Nothing else is written.
//
// This module may ONLY write `lead_context` and `context_verified_at`. It never
// touches consent, opt-out, suppression, owner review, quote status, booking
// status, caps, kill switches or campaign authorisation, and it can never send
// a message, contact a provider, create a job, an offer or an agent action.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { classifyCompletedQuoteLead } from "./quote-classification";

export type ClassificationOutcome = {
  applied: boolean;
  leadContext: string | null;
  missing: readonly string[];
};

/**
 * Re-reads the authoritative facts for a completed quote conversation and, only
 * on a full pass, promotes the lead's context. A shortfall leaves the lead
 * exactly as it was.
 */
export async function applyCompletedQuoteClassification(input: {
  businessId: string;
  conversationId: string;
  leadId: string;
}): Promise<ClassificationOutcome> {
  const { businessId, conversationId, leadId } = input;

  const [conversationRes, leadRes, offersRes, jobsRes] = await Promise.all([
    supabaseAdmin
      .from("web_conversations")
      .select("id, lead_id, status, completed_at, selected_service_id, collected")
      .eq("id", conversationId)
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("leads")
      .select("id, source_form, consent_status, lead_context, deleted_at")
      .eq("id", leadId)
      .eq("business_id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("booking_offers")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("status", "confirmed"),
    supabaseAdmin
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("lead_id", leadId)
      .eq("completion_status", "scheduled"),
  ]);

  const conversation = conversationRes.data;
  const lead = leadRes.data;
  if (!conversation || !lead)
    return { applied: false, leadContext: lead?.lead_context ?? null, missing: ["records_not_found"] };

  const collected = (conversation.collected ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

  const classification = classifyCompletedQuoteLead({
    sourceForm: lead.source_form,
    quoteConversationCompleted: Boolean(conversation.completed_at),
    approvedServiceId: conversation.selected_service_id,
    customerName: text(collected["name"]),
    customerContact: text(collected["mobile_number"]) ?? text(collected["email"]),
    vehicle: text(collected["vehicle_type"]),
    suburb: text(collected["suburb"]),
    consentStatus: lead.consent_status,
    hasConfirmedBooking: (offersRes.count ?? 0) > 0,
    hasScheduledJob: (jobsRes.count ?? 0) > 0,
    declinedAllSlots: collected["booking_declined"] === true,
    noSuitableSlotSelected: collected["booking_selected"] == null,
    leadDeleted: Boolean(lead.deleted_at),
  });

  if (!classification.activeEnquiry || classification.leadContext === null)
    return { applied: false, leadContext: lead.lead_context ?? null, missing: classification.missing };

  if (lead.lead_context === classification.leadContext)
    return { applied: false, leadContext: lead.lead_context, missing: [] };

  await supabaseAdmin
    .from("leads")
    .update({
      lead_context: classification.leadContext,
      context_verified_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("business_id", businessId);

  return { applied: true, leadContext: classification.leadContext, missing: [] };
}
