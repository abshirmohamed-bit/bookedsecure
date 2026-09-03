import { describe, expect, it } from "vitest";
import {
  classifyLeadContext,
  deriveProvenance,
  mayReferenceHistory,
  requiresNeutralLanguage,
  CRM_IMPORT_ORIGIN,
} from "./lead-provenance";

const sparse = { lead_origin: CRM_IMPORT_ORIGIN };

describe("lead provenance classification", () => {
  it("treats a name/email/phone-only import as contact-only unqualified", () => {
    expect(classifyLeadContext(sparse)).toBe("contact_only_unqualified");
  });

  it("never turns a sparse record into a historical enquiry", () => {
    expect(classifyLeadContext(sparse)).not.toBe("verified_historical_enquiry");
    expect(classifyLeadContext(sparse)).not.toBe("previous_customer");
    expect(classifyLeadContext(sparse)).not.toBe("booked_lead");
  });

  it("forbids history-implying language for sparse records", () => {
    expect(requiresNeutralLanguage(classifyLeadContext(sparse))).toBe(true);
    expect(mayReferenceHistory(classifyLeadContext(sparse))).toBe(false);
  });

  it("only calls an import historical when verified context exists", () => {
    expect(
      classifyLeadContext({ lead_origin: CRM_IMPORT_ORIGIN, main_concerns: "swirl marks" }),
    ).toBe("verified_historical_enquiry");
    expect(
      classifyLeadContext({ lead_origin: CRM_IMPORT_ORIGIN, suburb: "   " }),
    ).toBe("contact_only_unqualified");
  });

  it("classifies a quote chat lead from a real conversation row", () => {
    expect(
      classifyLeadContext({ lead_origin: "web", hasQuoteChatConversation: true }),
    ).toBe("quote_chat_lead");
  });

  it("prefers real jobs over conversation context", () => {
    expect(
      classifyLeadContext({ hasQuoteChatConversation: true, hasScheduledJob: true }),
    ).toBe("booked_lead");
    expect(
      classifyLeadContext({ hasQuoteChatConversation: true, hasCompletedJob: true }),
    ).toBe("previous_customer");
  });

  it("routes conflicting or flagged records to owner review", () => {
    expect(
      classifyLeadContext({ requires_owner_review: true, hasCompletedJob: true }),
    ).toBe("owner_review");
  });

  it("keeps a manual contact with no context neutral", () => {
    const context = classifyLeadContext({ lead_origin: "manual" });
    expect(context).toBe("contact_only_unqualified");
    expect(requiresNeutralLanguage(context)).toBe(true);
  });

  it("reads consent and suppression from records only", () => {
    expect(deriveProvenance({}).consentStatus).toBe("unknown");
    expect(deriveProvenance({ consent_record: { text: "ok" } }).consentStatus).toBe("granted");
    expect(
      deriveProvenance({ consent_record: { text: "ok" }, sms_suppressed_at: "2026-01-01" })
        .consentStatus,
    ).toBe("suppressed");
    expect(
      deriveProvenance({ consent_record: { text: "ok" }, opted_out_at: "2026-01-01" }).consentStatus,
    ).toBe("opted_out");
  });

  it("copies verified fields verbatim and never invents them", () => {
    const derived = deriveProvenance({
      approved_service_id: "svc-1",
      vehicle_type: " Ford Ranger ",
      suburb: "",
      main_concerns: null,
    });
    expect(derived.verifiedServiceId).toBe("svc-1");
    expect(derived.verifiedVehicle).toBe("Ford Ranger");
    expect(derived.verifiedSuburb).toBeNull();
    expect(derived.verifiedConcern).toBeNull();
    expect(derived.hasVerifiedContext).toBe(true);
  });

  it("marks a booked lead as a prospect and a completed job as a previous customer", () => {
    expect(deriveProvenance({ hasScheduledJob: true }).customerStatus).toBe("prospect");
    expect(deriveProvenance({ hasCompletedJob: true }).customerStatus).toBe("previous_customer");
    expect(deriveProvenance({}).customerStatus).toBe("unknown");
  });
});
