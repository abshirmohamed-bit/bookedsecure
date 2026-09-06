import { describe, expect, it } from "vitest";
import {
  checkApproval,
  classifyReactivationCandidate,
  guardReactivationMessage,
  proposeOffer,
  renderReactivationMessage,
  type ReactivationFacts,
} from "@/lib/reactivation";
import { factsFromLead } from "@/lib/reactivation.server";

const dormant: ReactivationFacts = {
  hasMessages: false,
  hasQuoteChat: false,
  hasBooking: false,
  hasVerifiedContext: false,
  optedOut: false,
  suppressed: false,
  deleted: false,
  hasMobileNumber: true,
};

describe("dormant-lead classification", () => {
  it("treats a contact-only imported lead as eligible", () => {
    expect(classifyReactivationCandidate(dormant)).toEqual({ eligible: true });
  });

  it.each([
    ["hasMessages", "Conversation already exists."],
    ["hasQuoteChat", "Quote conversation already exists."],
    ["hasBooking", "Lead already has a booking or job."],
    ["hasVerifiedContext", "Lead has an active enquiry on record."],
    ["optedOut", "Lead has opted out."],
    ["suppressed", "Number is suppressed after delivery failures."],
    ["deleted", "Lead is deleted."],
  ] as const)("excludes when %s is true", (field, reason) => {
    const decision = classifyReactivationCandidate({ ...dormant, [field]: true });
    expect(decision).toEqual({ eligible: false, reason });
  });

  it("excludes a lead with no mobile number", () => {
    expect(classifyReactivationCandidate({ ...dormant, hasMobileNumber: false })).toEqual({
      eligible: false,
      reason: "No mobile number on record.",
    });
  });

  it("derives facts from a lead row and its related sets", () => {
    const facts = factsFromLead(
      {
        id: "lead-1",
        name: "bdeir",
        mobile_number: "+61403620659",
        email: "a@b.com",
        booking_status: "none",
        verified_service_id: null,
        verified_vehicle: null,
        verified_suburb: null,
        verified_concern: null,
        vehicle_type: null,
        suburb: null,
        main_concerns: null,
        approved_service_id: null,
        opted_out_at: null,
        sms_suppressed_at: null,
        deleted_at: null,
        created_at: "2026-08-29T01:16:00Z",
      },
      { messageLeadIds: new Set(), chatLeadIds: new Set(), jobLeadIds: new Set() },
    );
    expect(classifyReactivationCandidate(facts)).toEqual({ eligible: true });
  });

  it("treats any suburb or vehicle on record as an active enquiry", () => {
    const facts = factsFromLead(
      {
        id: "lead-2",
        name: "Sam",
        mobile_number: "+61400000000",
        email: null,
        booking_status: "none",
        verified_service_id: null,
        verified_vehicle: null,
        verified_suburb: null,
        verified_concern: null,
        vehicle_type: null,
        suburb: "Auburn",
        main_concerns: null,
        approved_service_id: null,
        opted_out_at: null,
        sms_suppressed_at: null,
        deleted_at: null,
        created_at: null,
      },
      { messageLeadIds: new Set(), chatLeadIds: new Set(), jobLeadIds: new Set() },
    );
    expect(classifyReactivationCandidate(facts).eligible).toBe(false);
  });
});

describe("offer proposal", () => {
  it("uses the tenant's own first active service", () => {
    expect(proposeOffer({ serviceNames: ["Full Interior Detail", "Wash"] })).toBe(
      "15% off your next Full Interior Detail",
    );
  });

  it("falls back to a neutral wording when no services exist", () => {
    expect(proposeOffer({ serviceNames: [] })).toBe("15% off your next service");
  });

  it("honours a custom percentage", () => {
    expect(proposeOffer({ serviceNames: null, percent: 20 })).toBe("20% off your next service");
  });
});

describe("message render", () => {
  const rendered = renderReactivationMessage({
    businessName: "Acme Detailing",
    leadName: "bdeir smith",
    offerText: "15% off your next Full Interior Detail",
  });

  it("greets by first name and names the tenant", () => {
    expect(rendered.startsWith("Hi bdeir, it's Acme Detailing.")).toBe(true);
  });

  it("stays neutral about history and offers an opt-out", () => {
    expect(rendered).not.toMatch(/last time|again|previous|welcome back/i);
    expect(rendered).toMatch(/STOP to opt out/);
  });

  it("survives its own guard unchanged", () => {
    const guarded = guardReactivationMessage(rendered, "15% off your next Full Interior Detail");
    expect(guarded.flagged).toEqual([]);
    expect(guarded.text).toBe(rendered);
  });

  it("stays within one conversational SMS budget", () => {
    expect(rendered.length).toBeLessThanOrEqual(320);
  });

  it("works without a name", () => {
    const anon = renderReactivationMessage({
      businessName: "Acme Detailing",
      offerText: "15% off your next service",
    });
    expect(anon.startsWith("Hi, it's Acme Detailing.")).toBe(true);
  });
});

describe("content guard", () => {
  const offer = "15% off your next detail";

  it("keeps the approved offer verbatim", () => {
    const result = guardReactivationMessage(`We're offering ${offer}.`, offer);
    expect(result.flagged).toEqual([]);
    expect(result.text).toContain(offer);
  });

  it("strips a discount that is not the approved offer", () => {
    const result = guardReactivationMessage("Take 40% off this month.", offer);
    expect(result.text).toBe("");
    expect(result.flagged).toHaveLength(1);
  });

  it("strips dollar amounts even alongside the approved offer", () => {
    const result = guardReactivationMessage(`${offer} for just $99.`, offer);
    expect(result.text).toBe("");
  });

  it.each([
    "We can come tomorrow.",
    "How about Tuesday?",
    "We have a slot at 9am.",
    "Your booking is confirmed.",
    "We have availability this week.",
    "Guaranteed results.",
    "A $50 deposit applies.",
  ])("strips %s", (sentence) => {
    const result = guardReactivationMessage(sentence, offer);
    expect(result.text).toBe("");
    expect(result.flagged).toHaveLength(1);
  });

  it("keeps safe sentences while dropping unsafe ones", () => {
    const result = guardReactivationMessage(
      `Hi Sam, it's Acme. We're offering ${offer}. We can come Tuesday at 9am.`,
      offer,
    );
    expect(result.text).toContain(offer);
    expect(result.text).not.toMatch(/Tuesday/);
  });

  it("strips a percentage when there is no approved offer at all", () => {
    expect(guardReactivationMessage("Enjoy 15% off.", "").text).toBe("");
  });
});

describe("approval policy", () => {
  it("requires the permission attestation", () => {
    expect(checkApproval({ attested: false, campaignStatus: "draft", approvedDraftCount: 3 })).toEqual({
      ok: false,
      reason: "Confirm you have permission to contact these customers.",
    });
  });

  it("requires at least one selected message", () => {
    expect(checkApproval({ attested: true, campaignStatus: "draft", approvedDraftCount: 0 })).toEqual({
      ok: false,
      reason: "Select at least one message to send.",
    });
  });

  it("refuses a campaign that is no longer a draft", () => {
    expect(checkApproval({ attested: true, campaignStatus: "approved", approvedDraftCount: 2 })).toEqual({
      ok: false,
      reason: "This campaign has already been actioned.",
    });
  });

  it("allows an attested draft with selected messages", () => {
    expect(checkApproval({ attested: true, campaignStatus: "draft", approvedDraftCount: 2 })).toEqual({
      ok: true,
    });
  });
});
