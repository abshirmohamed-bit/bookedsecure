// Production-owned, server-authoritative SMS bodies for agent action templates.
//
// Pure. No I/O, no sends. This is the SINGLE renderer for automated agent
// messages: the live executor and the sandbox both call `renderAgentMessage`,
// so a sandbox recording is byte-identical to what production would send.
//
// No model ever generates customer text. Every substitution names the exact
// server-side source it came from, so a recorded message is auditable.

import { firstName, renderTemplate } from "@/lib/domain";
import { countSegments, type SegmentInfo } from "@/lib/sms/segments";
import type { TemplateId } from "./sequence-actions";

/** Bumped only when a body changes; the gates require an approved version. */
export const AGENT_TEMPLATE_VERSION = 1 as const;

export const AGENT_TEMPLATE_BODIES: Record<TemplateId, string> = {
  consent_intro_neutral:
    "Hi {{first_name}}, it's {{business}}. Is it OK to text you about a mobile detail quote? Reply YES to continue or STOP to opt out.",
  quote_chat_completion_step:
    "Hi {{first_name}}, {{business}} here about your {{service}} quote. Reply with your suburb and preferred day and we'll finish it off. Reply STOP to opt out.",
  active_enquiry_qualification_step:
    "Hi {{first_name}}, {{business}} here about your {{service}} enquiry. What day suits you best? Reply STOP to opt out.",
  abandoned_quote_recovery_step:
    "Hi {{first_name}}, your {{service}} quote with {{business}} is still open. Reply YES and we'll pick it up. Reply STOP to opt out.",
  historical_booking_link:
    "Hi {{first_name}}, {{business}} here. You can book your {{service}} any time here: {{booking_link}}. Reply STOP to opt out.",
  previous_customer_reactivation:
    "Hi {{first_name}}, {{business}} here. Due for another {{service}}? Book here: {{booking_link}}. Reply STOP to opt out.",
  contact_only_introduction_neutral:
    "Hi {{first_name}}, it's {{business}}. Would you like a quote? Reply YES, or STOP to opt out.",
  booking_intent_fast_path_link:
    "Hi {{first_name}}, {{business}} here. Grab a time for your {{service}}: {{booking_link}}. Reply STOP to opt out.",
  slot_offer:
    "Hi {{first_name}}, {{business}} can do your {{service}} at: {{options}}. Reply with the time that suits and we'll confirm. Reply STOP to opt out.",
};

/** Where each substitution value came from. Never a model, never the client. */
export type SubstitutionSource =
  | "leads.name"
  | "businesses.name"
  | "approved_services.name"
  | "businesses.booking_link"
  | "booking_offers.slot_start";

export type RenderFacts = {
  leadName: string;
  businessName: string;
  /** Approved (allow-listed) service name, or null when none is approved. */
  approvedServiceName: string | null;
  bookingLink: string | null;
  /** Server-computed slot labels from the calendar, never client input. */
  slotLabels?: readonly string[];
};

export type Substitution = {
  key: string;
  value: string;
  source: SubstitutionSource;
};

export type RenderedAgentMessage = {
  templateId: TemplateId;
  templateVersion: typeof AGENT_TEMPLATE_VERSION;
  body: string;
  substitutions: readonly Substitution[];
  segmentInfo: SegmentInfo;
};

const PLACEHOLDER_SOURCES: Record<string, SubstitutionSource> = {
  first_name: "leads.name",
  business: "businesses.name",
  service: "approved_services.name",
  booking_link: "businesses.booking_link",
  options: "booking_offers.slot_start",
};

/**
 * Render one agent template. Deterministic: the same facts always produce the
 * same body, segment count and substitution list.
 */
export function renderAgentMessage(
  templateId: TemplateId,
  facts: RenderFacts,
): RenderedAgentMessage {
  const template = AGENT_TEMPLATE_BODIES[templateId];
  const values: Record<string, string> = {
    first_name: firstName(facts.leadName),
    business: facts.businessName,
    service: facts.approvedServiceName ?? "detail",
    booking_link: facts.bookingLink ?? "",
    options: (facts.slotLabels ?? []).join(" or "),
  };

  const used = new Set<string>();
  for (const match of template.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)) {
    used.add(match[1]!.toLowerCase());
  }

  const body = renderTemplate(template, values);
  const substitutions: Substitution[] = [...used]
    .filter((key) => PLACEHOLDER_SOURCES[key])
    .map((key) => ({ key, value: values[key] ?? "", source: PLACEHOLDER_SOURCES[key]! }));

  return {
    templateId,
    templateVersion: AGENT_TEMPLATE_VERSION,
    body,
    substitutions,
    segmentInfo: countSegments(body),
  };
}
