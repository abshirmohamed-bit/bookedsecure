import { authoriseAgentAction } from "@/lib/agent-gates.server";
import { classifyCompletedQuoteLead, activeEnquiryTemplate } from "@/lib/quote-classification";
import { renderAgentMessage } from "@/lib/agent-templates";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LIVE_EXECUTION_ENABLED } from "@/lib/agent-executor";

const businessId = "11111111-1111-1111-1111-111111111111";
const leadId = "cd1efc35-f955-4f96-a1ba-b641220c94b6";

const { data: campaign } = await supabaseAdmin.from("sequence_campaigns").select("*").eq("business_id", businessId).eq("status", "authorised").maybeSingle();
const { data: conv } = await supabaseAdmin.from("web_conversations").select("*").eq("lead_id", leadId).maybeSingle();
const { data: lead } = await supabaseAdmin.from("leads").select("*").eq("id", leadId).maybeSingle();
const collected = (conv?.collected ?? {}) as Record<string, unknown>;

const classification = classifyCompletedQuoteLead({
  sourceForm: lead?.source_form,
  quoteConversationCompleted: Boolean(conv?.completed_at),
  approvedServiceId: conv?.selected_service_id,
  customerName: String(collected["name"] ?? ""),
  customerContact: String(collected["mobile_number"] ?? ""),
  vehicle: String(collected["vehicle_type"] ?? ""),
  suburb: String(collected["suburb"] ?? ""),
  consentStatus: lead?.consent_status,
  hasConfirmedBooking: false,
  hasScheduledJob: false,
  declinedAllSlots: collected["booking_declined"] === true,
});
const template = activeEnquiryTemplate()!;
const idempotencyKey = `canary:${leadId}:${template.templateId}:v${template.templateVersion}`;
const rendered = renderAgentMessage(template.templateId, {
  leadName: String(collected["name"] ?? ""),
  businessName: "Glocast",
  approvedServiceName: conv?.service_name_snapshot ?? null,
  bookingLink: null,
});

const result = await authoriseAgentAction({
  businessId,
  leadId,
  campaignId: campaign!.id,
  actionKind: "send_sms",
  plannedSequenceId: "active_enquiry_qualification",
  plannedTemplateVersion: template.templateVersion,
  planStillCurrent: true,
  templateId: template.templateId,
  templateVersion: template.templateVersion,
  directResponseToCurrentEnquiry: true,
  idempotencyKey,
  sourceAttribution: "agent_canary",
});

console.log(JSON.stringify({
  campaign: { id: campaign!.id, sequence_id: campaign!.sequence_id, template_id: campaign!.template_id, template_version: campaign!.template_version, message_path: campaign!.message_path, lead_context: campaign!.lead_context, scope: campaign!.scope_lead_ids, max_leads: campaign!.max_leads, max_sends: campaign!.max_sends, max_recipients: campaign!.max_recipients, max_segments: campaign!.max_segments, status: campaign!.status },
  classification,
  mode: result.mode, allowed: result.allowed, failures: result.failures,
  decision: result.decision,
  rendered,
  idempotencyKey,
  LIVE_EXECUTION_ENABLED,
}, null, 2));
