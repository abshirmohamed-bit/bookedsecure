import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  activeEnquiryTemplate,
  classifyCompletedQuoteLead,
  type CompletedQuoteFacts,
} from "./quote-classification";
import { classifyLeadContext } from "./lead-provenance";
import { selectSequence } from "./sequences";
import {
  buildOutboundDecision,
  classifyMessagePath,
  NEW_LEAD_RESPONSE_TEMPLATES,
  type NewLeadResponseFacts,
} from "./message-path";

const LEAD_ID = "cd1efc35-f955-4f96-a1ba-b641220c94b6";

const completedQuote: CompletedQuoteFacts = {
  sourceForm: "ai_chat:glocast",
  formUrl: "https://bookedsecure.lovable.app/quote/glocast",
  quoteConversationCompleted: true,
  conversationDeleted: false,
  approvedServiceId: "710cdf04-0000-0000-0000-000000000001",
  customerName: "Abshir",
  customerContact: "+61466907824",
  vehicle: "Ford Ranger",
  suburb: "Auburn",
  consentStatus: "granted",
  hasConfirmedBooking: false,
  hasScheduledJob: false,
  leadDeleted: false,
};

const outboundFacts = (over: Partial<NewLeadResponseFacts> = {}): NewLeadResponseFacts => ({
  customerInitiated: true,
  quoteFlowActive: true,
  directResponseToCurrentEnquiry: true,
  consentGranted: true,
  consentLeadId: LEAD_ID,
  leadId: LEAD_ID,
  optedOut: false,
  suppressed: false,
  requiresOwnerReview: false,
  humanTakeoverActive: false,
  automationPaused: false,
  templateId: "active_enquiry_qualification_step",
  templateVersion: 1,
  promotional: false,
  serviceRelated: true,
  alreadyBooked: false,
  tenantKillSwitchAt: null,
  globalKillSwitchAt: null,
  idempotencyKey: `lead:${LEAD_ID}:active_enquiry_qualification_step:1`,
  sourceAttribution: "agent:active_enquiry_qualification",
  sequenceId: "active_enquiry_qualification",
  ...over,
});

const quietHours = { timezone: "Australia/Sydney", quiet_hours_start: 21, quiet_hours_end: 8 };
// 2026-09-04 22:30 Sydney — inside the quiet window.
const insideQuietHours = new Date("2026-09-04T12:30:00.000Z");

describe("completed public quote conversation classification", () => {
  it("1. a completed quote lead with consent becomes an active enquiry", () => {
    const result = classifyCompletedQuoteLead(completedQuote);
    expect(result.activeEnquiry).toBe(true);
    expect(result.leadContext).toBe("active_form_enquiry");
    expect(result.sequence).toBe("active_enquiry_qualification");
    expect(result.missing).toEqual([]);
    expect(
      classifyLeadContext({ lead_origin: "web", completedQuoteActiveEnquiry: true }),
    ).toBe("active_form_enquiry");
  });

  it("2. declining every slot keeps it an active enquiry, not a cold contact", () => {
    for (const variant of [
      { declinedAllSlots: true },
      { noSuitableSlotSelected: true },
      { declinedAllSlots: true, noSuitableSlotSelected: true },
    ]) {
      const result = classifyCompletedQuoteLead({ ...completedQuote, ...variant });
      expect(result.activeEnquiry).toBe(true);
      expect(result.leadContext).toBe("active_form_enquiry");
      expect(result.leadContext).not.toBe("contact_only_unqualified");
      const decision = selectSequence({
        leadContext: "active_form_enquiry",
        consentStatus: "granted",
        bookingStatus: "none",
      });
      expect(decision.sequence).toBe("active_enquiry_qualification");
      expect(decision.sequence).not.toBe("contact_only_introduction");
      expect(decision.neutralLanguageRequired).toBe(false);
      expect(decision.wouldSend).toBe(false);
    }
  });

  it("3. the resulting path is new_lead_response", () => {
    expect(classifyMessagePath(outboundFacts())).toBe("new_lead_response");
  });

  it("4. quiet_hours_applied is false for this customer-initiated response", () => {
    const decision = buildOutboundDecision({
      facts: outboundFacts(),
      quietHours,
      at: insideQuietHours,
      otherGatesPassed: true,
    });
    expect(decision.message_path).toBe("new_lead_response");
    expect(decision.quiet_hours_applied).toBe(false);
    expect(decision.exemption_failures).toEqual([]);
    expect(decision.consent_result).toBe("granted");
    expect(decision.booking_result).toBe("none");
  });

  it("5. an approved new-lead template is selected", () => {
    const template = activeEnquiryTemplate();
    expect(template).not.toBeNull();
    expect(template!.templateId).toBe("active_enquiry_qualification_step");
    expect(NEW_LEAD_RESPONSE_TEMPLATES[template!.templateId]).toBe(template!.templateVersion);
    expect(NEW_LEAD_RESPONSE_TEMPLATES["contact_only_introduction_neutral"]).toBeUndefined();
  });

  it("6. a genuinely contact-only lead still uses sequence_follow_up", () => {
    const contactOnly = classifyCompletedQuoteLead({
      sourceForm: "ai_chat:glocast",
      quoteConversationCompleted: false,
    });
    expect(contactOnly.activeEnquiry).toBe(false);
    expect(contactOnly.missing).toContain("completed_quote_conversation");
    expect(classifyLeadContext({ lead_origin: "manual" })).toBe("contact_only_unqualified");
    const path = classifyMessagePath(
      outboundFacts({
        templateId: "contact_only_introduction_neutral",
        sequenceId: "contact_only_introduction",
      }),
    );
    expect(path).toBe("sequence_follow_up");
    const decision = buildOutboundDecision({
      facts: outboundFacts({
        templateId: "contact_only_introduction_neutral",
        sequenceId: "contact_only_introduction",
      }),
      quietHours,
      at: insideQuietHours,
      otherGatesPassed: true,
    });
    expect(decision.quiet_hours_applied).toBe(true);
  });

  it("6b. every other missing condition also refuses the active-enquiry upgrade", () => {
    const cases: Array<[Partial<CompletedQuoteFacts>, string]> = [
      [{ approvedServiceId: null }, "approved_service"],
      [{ vehicle: " " }, "vehicle_details"],
      [{ suburb: null }, "suburb"],
      [{ customerContact: null }, "customer_details"],
      [{ consentStatus: "unknown" }, "sms_consent_granted"],
      [{ hasConfirmedBooking: true }, "no_confirmed_booking"],
      [{ hasScheduledJob: true }, "no_scheduled_job"],
      [{ conversationDeleted: true }, "conversation_not_deleted"],
      [{ leadDeleted: true }, "lead_not_deleted"],
      [{ sourceForm: null, formUrl: null }, "public_quote_flow_source"],
    ];
    for (const [over, reason] of cases) {
      const result = classifyCompletedQuoteLead({ ...completedQuote, ...over });
      expect(result.activeEnquiry).toBe(false);
      expect(result.leadContext).toBeNull();
      expect(result.missing).toContain(reason);
    }
  });

  it("6c. quote_status semantics are untouched by classification", () => {
    const source = readFileSync("src/lib/quote-classification.ts", "utf8");
    expect(source).not.toContain("quote_status");
    expect(source).not.toContain("requires_owner_review =");
    expect(source).not.toContain("booking_status");
  });

  it("7. no database, provider, campaign, booking, consent or ledger side effects", () => {
    const source = readFileSync("src/lib/quote-classification.ts", "utf8");
    for (const forbidden of [
      ".insert(",
      ".update(",
      ".upsert(",
      ".delete(",
      ".rpc(",
      "supabase",
      "fetch(",
      "sendSms",
      "agent_actions",
      "sequence_campaigns",
      "booking_offers",
      "consent_events",
      "process.env",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    const plan = selectSequence({
      leadContext: "active_form_enquiry",
      consentStatus: "granted",
      bookingStatus: "none",
    });
    expect(plan.wouldSend).toBe(false);
  });
});
