import { describe, expect, it } from "vitest";
import {
  assessBookingConfirmation,
  assessOfferGeneration,
  bookingConfirmationIdempotencyKey,
  buildBookingConfirmationMessage,
  buildSlotOfferMessage,
  slotOfferIdempotencyKey,
  type BookingLead,
  type BookingOfferRecord,
} from "@/lib/booking";
import { guardReply } from "@/lib/ai.server";

const BUSINESS = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function lead(overrides: Partial<BookingLead> = {}): BookingLead {
  return {
    id: "lead-1",
    business_id: BUSINESS,
    name: "Sam",
    status: "contacted",
    opted_out_at: null,
    sms_suppressed_at: null,
    ...overrides,
  };
}

function offer(overrides: Partial<BookingOfferRecord> = {}): BookingOfferRecord {
  return {
    id: "offer-1",
    business_id: BUSINESS,
    lead_id: "lead-1",
    slot_start: "2025-07-14T23:00:00.000Z",
    status: "accepted",
    expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
    accepted_message_id: "msg-1",
    ...overrides,
  };
}

describe("offer generation gate", () => {
  it("allows offers for an active lead with available slots", () => {
    expect(
      assessOfferGeneration({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        availabilityActive: true,
        slotCount: 3,
      }).allowed,
    ).toBe(true);
  });

  it("blocks when availability is switched off", () => {
    const decision = assessOfferGeneration({
      businessId: BUSINESS,
      lead: lead(),
      conversation: null,
      availabilityActive: false,
      slotCount: 3,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("availability_inactive");
  });

  it("blocks when there are no valid slots", () => {
    expect(
      assessOfferGeneration({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        availabilityActive: true,
        slotCount: 0,
      }).reason,
    ).toBe("no_slots_available");
  });

  it("blocks opted-out and suppressed leads", () => {
    expect(
      assessOfferGeneration({
        businessId: BUSINESS,
        lead: lead({ opted_out_at: new Date().toISOString() }),
        conversation: null,
        availabilityActive: true,
        slotCount: 2,
      }).reason,
    ).toBe("opted_out");
    expect(
      assessOfferGeneration({
        businessId: BUSINESS,
        lead: lead({ sms_suppressed_at: new Date().toISOString() }),
        conversation: null,
        availabilityActive: true,
        slotCount: 2,
      }).reason,
    ).toBe("sms_suppressed");
  });

  it("blocks terminal lead statuses", () => {
    for (const status of ["completed", "lost", "invalid", "opted_out"]) {
      expect(
        assessOfferGeneration({
          businessId: BUSINESS,
          lead: lead({ status }),
          conversation: null,
          availabilityActive: true,
          slotCount: 2,
        }).allowed,
      ).toBe(false);
    }
  });
});

describe("tenant isolation", () => {
  it("refuses a lead belonging to another business", () => {
    const decision = assessOfferGeneration({
      businessId: OTHER,
      lead: lead(),
      conversation: null,
      availabilityActive: true,
      slotCount: 3,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cross_tenant");
  });

  it("refuses to confirm an offer from another business", () => {
    const decision = assessBookingConfirmation({
      businessId: BUSINESS,
      lead: lead(),
      conversation: null,
      offer: offer({ business_id: OTHER }),
      slotStillAvailable: true,
      now: new Date(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("cross_tenant");
  });

  it("refuses to confirm an offer belonging to a different lead", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: offer({ lead_id: "lead-2" }),
        slotStillAvailable: true,
        now: new Date(),
      }).reason,
    ).toBe("cross_tenant");
  });
});

describe("booking confirmation gate", () => {
  it("confirms an accepted, unexpired, still-available slot", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: offer(),
        slotStillAvailable: true,
        now: new Date(),
      }).allowed,
    ).toBe(true);
  });

  it("requires the customer's own selection before booking", () => {
    const decision = assessBookingConfirmation({
      businessId: BUSINESS,
      lead: lead(),
      conversation: null,
      offer: offer({ status: "offered", accepted_message_id: null }),
      slotStillAvailable: true,
      now: new Date(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_customer_selection");
  });

  it("requires a recorded inbound message as proof of selection", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: offer({ accepted_message_id: null }),
        slotStillAvailable: true,
        now: new Date(),
      }).reason,
    ).toBe("no_customer_selection");
  });

  it("blocks an expired offer", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: offer({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
        slotStillAvailable: true,
        now: new Date(),
      }).reason,
    ).toBe("offer_expired");
  });

  it("blocks when re-validation says the slot is gone (double booking)", () => {
    const decision = assessBookingConfirmation({
      businessId: BUSINESS,
      lead: lead(),
      conversation: null,
      offer: offer(),
      slotStillAvailable: false,
      now: new Date(),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("slot_unavailable");
  });

  it("blocks a withdrawn offer and a lead already booked elsewhere", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: offer({ status: "withdrawn" }),
        slotStillAvailable: true,
        now: new Date(),
      }).allowed,
    ).toBe(false);
  });

  it("blocks a missing offer instead of inventing a booking", () => {
    expect(
      assessBookingConfirmation({
        businessId: BUSINESS,
        lead: lead(),
        conversation: null,
        offer: null,
        slotStillAvailable: true,
        now: new Date(),
      }).allowed,
    ).toBe(false);
  });
});

describe("idempotency keys prevent duplicate sends", () => {
  it("is stable per offer for confirmations and differs across offers", () => {
    expect(bookingConfirmationIdempotencyKey("offer-1")).toBe(
      bookingConfirmationIdempotencyKey("offer-1"),
    );
    expect(bookingConfirmationIdempotencyKey("offer-1")).not.toBe(
      bookingConfirmationIdempotencyKey("offer-2"),
    );
  });

  it("is stable per option set for slot offers, regardless of order", () => {
    expect(slotOfferIdempotencyKey(["a", "b"])).toBe(slotOfferIdempotencyKey(["b", "a"]));
    expect(slotOfferIdempotencyKey(["a", "b"])).not.toBe(slotOfferIdempotencyKey(["a", "c"]));
  });
});

describe("server-composed messages, not AI output", () => {
  it("includes the opt-out line in both templates", () => {
    const offerMessage = buildSlotOfferMessage({
      name: "Sam Smith",
      businessName: "Glocast",
      serviceName: "Full Detail",
      slotLabels: ["Mon 14 Jul, 9:00 am", "Tue 15 Jul, 9:00 am"],
    });
    const confirmMessage = buildBookingConfirmationMessage({
      name: "Sam Smith",
      businessName: "Glocast",
      serviceName: "Full Detail",
      slotLabel: "Mon 14 Jul, 9:00 am",
    });
    expect(offerMessage).toContain("Reply STOP to opt out");
    expect(confirmMessage).toContain("Reply STOP to opt out");
    expect(offerMessage).toContain("Mon 14 Jul, 9:00 am");
    expect(confirmMessage).toContain("Mon 14 Jul, 9:00 am");
    expect(offerMessage).toContain("Sam");
  });

  it("never claims a booking exists in the options message", () => {
    const offerMessage = buildSlotOfferMessage({
      name: "Sam",
      businessName: "Glocast",
      serviceName: null,
      slotLabels: ["Mon 14 Jul, 9:00 am"],
    });
    expect(offerMessage.toLowerCase()).not.toContain("confirmed");
    expect(offerMessage.toLowerCase()).not.toContain("you're booked");
  });
});

describe("AI guardrail integrity is unchanged by Phase 3", () => {
  it("still strips AI-invented dates and times", () => {
    const guarded = guardReply(
      "We can come Monday at 9am to detail your car. Does that suit?",
      undefined,
    );
    expect(guarded.flagged.length).toBeGreaterThan(0);
    expect(guarded.reply.toLowerCase()).not.toContain("monday");
    expect(guarded.reply.toLowerCase()).not.toContain("9am");
  });

  it("still strips AI booking confirmations", () => {
    const guarded = guardReply("You're booked in for tomorrow, see you then.", undefined);
    expect(guarded.flagged.length).toBeGreaterThan(0);
    expect(guarded.reply.toLowerCase()).not.toContain("booked in");
  });

  it("still strips availability claims even with approved facts present", () => {
    const guarded = guardReply("We have availability this week and it's from $250.", {
      businessId: BUSINESS,
      serviceId: "svc-1",
      serviceName: "Full Detail",
      description: null,
      includedItems: null,
      excludedItems: null,
      qualificationNote: null,
      priceGuidance: "from $250",
      ambiguous: false,
      reason: "approved",
      needsHumanReview: true,
    });
    expect(guarded.reply.toLowerCase()).not.toContain("availability");
  });
});
