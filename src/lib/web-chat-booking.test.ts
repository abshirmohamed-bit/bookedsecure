import { describe, expect, it } from "vitest";
import {
  BOOKING_CHANGE_CHOICE,
  BOOKING_CONFIRM_CHOICE,
  NO_SLOT_CHOICE,
  PILOT_BUSINESS_ID,
  PILOT_TENANT_SLUG,
  isPilotEligible,
  isPilotServiceName,
  slotLabel,
  webChatBookingIdempotencyKey,
} from "@/lib/web-chat-booking";
import { applyAnswer, nextStep, promptFor, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";

const tenant: WebChatTenant = {
  name: "Glocast Detailing",
  flexibleRequestsEnabled: true,
  services: [
    {
      id: "710cdf04-aae0-48e3-b84a-0e01ccec1da8",
      name: "Full Interior Detail",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
  ],
};

const eligible = {
  businessId: PILOT_BUSINESS_ID,
  slug: PILOT_TENANT_SLUG,
  approvedServiceId: "710cdf04-aae0-48e3-b84a-0e01ccec1da8",
  serviceName: "Full Interior Detail",
  serviceActive: true,
  serviceDurationMinutes: 120 as number | null,
  availabilityActive: true,
  slotCount: 3,
};

function consented(): WebChatCollected {
  return {
    service_id: tenant.services[0]!.id,
    service_name: tenant.services[0]!.name,
    vehicle_type: "SUV",
    suburb: "Marrickville",
    concerns: "Pet hair",
    name: "Sam",
    mobile_number: "+61447852565",
    email: null,
    reviewed: true,
    consent: "granted",
    booking_offered: true,
    pilot_offers: [
      { offer_id: "offer-a", slot_start: "2026-09-01T23:00:00.000Z", label: "Wed 2 Sep, 9:00 am" },
      { offer_id: "offer-b", slot_start: "2026-09-02T01:00:00.000Z", label: "Wed 2 Sep, 11:00 am" },
    ],
  };
}

describe("pilot scope", () => {
  it("accepts both names for the one pilot service", () => {
    expect(isPilotServiceName("Full Detail")).toBe(true);
    expect(isPilotServiceName("full interior detail")).toBe(true);
    expect(isPilotServiceName("Exterior Wash")).toBe(false);
  });

  it("requires every condition", () => {
    expect(isPilotEligible(eligible)).toBe(true);
    // Tenant-neutral: any tenant with its own approved service qualifies.
    expect(isPilotEligible({ ...eligible, businessId: "other-tenant" })).toBe(true);
    expect(isPilotEligible({ ...eligible, slug: "other-tenant" })).toBe(true);
    expect(isPilotEligible({ ...eligible, businessId: "" })).toBe(false);
    expect(isPilotEligible({ ...eligible, slug: "" })).toBe(false);
    expect(isPilotEligible({ ...eligible, serviceName: "Exterior Wash" })).toBe(false);
    expect(isPilotEligible({ ...eligible, serviceActive: false })).toBe(false);
    expect(isPilotEligible({ ...eligible, serviceDurationMinutes: null })).toBe(false);
    expect(isPilotEligible({ ...eligible, serviceDurationMinutes: 0 })).toBe(false);
    expect(isPilotEligible({ ...eligible, serviceDurationMinutes: -30 })).toBe(false);
    expect(isPilotEligible({ ...eligible, availabilityActive: false })).toBe(false);
    expect(isPilotEligible({ ...eligible, slotCount: 0 })).toBe(false);
    expect(isPilotEligible({ ...eligible, approvedServiceId: null })).toBe(false);
  });

  it("labels slots in the tenant timezone, not UTC", () => {
    const label = slotLabel("2026-09-01T23:00:00.000Z", "Australia/Sydney");
    expect(label).toContain("9:00 am");
    expect(label).toContain("Sep");
  });

  it("derives a stable commit key per conversation and offer", () => {
    expect(webChatBookingIdempotencyKey("c1", "o1")).toBe(webChatBookingIdempotencyKey("c1", "o1"));
    expect(webChatBookingIdempotencyKey("c1", "o1")).not.toBe(webChatBookingIdempotencyKey("c1", "o2"));
  });
});

describe("booking step machine", () => {
  it("opens the booking step only when the server offered slots", () => {
    expect(nextStep(consented())).toBe("booking");
    expect(nextStep({ ...consented(), booking_offered: false })).toBeNull();
  });

  it("offers only server-generated times plus an opt-out", () => {
    const prompt = promptFor("booking", tenant, consented());
    expect((prompt.options ?? []).map((option) => option.value)).toEqual([
      "offer-a",
      "offer-b",
      NO_SLOT_CHOICE,
    ]);
  });

  it("rejects any slot the server did not offer", () => {
    const result = applyAnswer(consented(), "booking", "offer-forged", tenant);
    expect(result.ok).toBe(false);
  });

  it("holds a valid selection and requires an explicit confirmation", () => {
    const result = applyAnswer(consented(), "booking", "offer-b", tenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.booking_selected).toBe("offer-b");
    expect(result.collected.booking_confirmed).toBe(false);
    // A held slot is a draft: the conversation moves to the confirmation step
    // and no booking exists until the customer confirms.
    expect(nextStep(result.collected)).toBe("booking_confirm");
  });

  it("only closes the step once the customer confirms the summary", () => {
    const held = applyAnswer(consented(), "booking", "offer-b", tenant);
    expect(held.ok).toBe(true);
    if (!held.ok) return;

    const summary = promptFor("booking_confirm", tenant, held.collected);
    expect(summary.text).toContain("Before I lock anything in");
    expect((summary.options ?? []).map((option) => option.value)).toEqual([
      BOOKING_CONFIRM_CHOICE,
      BOOKING_CHANGE_CHOICE,
    ]);

    const unclear = applyAnswer(held.collected, "booking_confirm", "hmm", tenant);
    expect(unclear.ok).toBe(false);

    const changed = applyAnswer(held.collected, "booking_confirm", BOOKING_CHANGE_CHOICE, tenant);
    expect(changed.ok).toBe(true);
    if (changed.ok) {
      expect(changed.collected.booking_selected).toBeNull();
      expect(nextStep(changed.collected)).toBe("booking");
    }

    const confirmed = applyAnswer(held.collected, "booking_confirm", BOOKING_CONFIRM_CHOICE, tenant);
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) return;
    expect(confirmed.collected.booking_confirmed).toBe(true);
    expect(nextStep(confirmed.collected)).toBeNull();
  });

  it("lets the customer decline without booking", () => {
    const result = applyAnswer(consented(), "booking", NO_SLOT_CHOICE, tenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.booking_declined).toBe(true);
    expect(result.collected.booking_selected).toBeNull();
    expect(nextStep(result.collected)).toBeNull();
  });

  it("never states a price on the booking step", () => {
    const prompt = promptFor("booking", tenant, consented());
    const surface = [prompt.text, ...(prompt.options ?? []).map((option) => option.label)].join(" ");
    expect(surface).not.toMatch(/\$|\bprice\b|\bcost\b/i);
  });
});
