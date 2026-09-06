import { describe, expect, it } from "vitest";
import { applyAnswer, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { matchOfferByText, NO_SLOT_CHOICE, type PilotOffer } from "@/lib/web-chat-booking";

const tenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  bookingEnabled: true,
  services: [
    {
      id: "s1",
      name: "Full Interior Detail",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
  ],
};

const offers: PilotOffer[] = [
  { offer_id: "o1", slot_start: "2026-09-11T23:00:00.000Z", label: "Fri 12 Sep, 9:00 am" },
  { offer_id: "o2", slot_start: "2026-09-12T02:00:00.000Z", label: "Fri 12 Sep, 12:00 pm" },
  { offer_id: "o3", slot_start: "2026-09-14T23:00:00.000Z", label: "Mon 15 Sep, 9:00 am" },
];

const withOffers: WebChatCollected = { pilot_offers: offers };

describe("typed answers at the time list", () => {
  it("matches a typed time to exactly one offered slot", () => {
    expect(matchOfferByText("friday 12pm please", offers)?.offer_id).toBe("o2");
    expect(matchOfferByText("Monday", offers)?.offer_id).toBe("o3");
  });

  it("accepts an ordinal reference", () => {
    expect(matchOfferByText("the first one", offers)?.offer_id).toBe("o1");
    expect(matchOfferByText("last one", offers)?.offer_id).toBe("o3");
  });

  it("never guesses when the words match more than one slot", () => {
    expect(matchOfferByText("friday", offers)).toBeNull();
    expect(matchOfferByText("9am", offers)).toBeNull();
  });

  it("never invents a slot that was not offered", () => {
    expect(matchOfferByText("sunday 6am", offers)).toBeNull();
    const result = applyAnswer(withOffers, "booking", "sunday 6am", tenant);
    expect(result.ok).toBe(false);
  });

  it("selects the offer id, never the typed text", () => {
    const result = applyAnswer(withOffers, "booking", "monday 9am works", tenant);
    expect(result.ok && result.collected.booking_selected).toBe("o3");
    expect(result.ok && result.collected.booking_confirmed).toBe(false);
  });

  it("treats a typed opt-out the same as the button", () => {
    for (const said of [NO_SLOT_CHOICE, "none of these work", "none work sorry"]) {
      const result = applyAnswer(withOffers, "booking", said, tenant);
      expect(result.ok && result.collected.booking_declined).toBe(true);
      expect(result.ok && result.collected.booking_selected).toBeNull();
    }
  });
});

describe("typed answers at consent", () => {
  it("accepts natural agreement", () => {
    for (const said of ["yes", "yep that's fine", "sure", "no worries", "go ahead"]) {
      expect(applyAnswer({}, "consent", said, tenant)).toMatchObject({
        ok: true,
        collected: { consent: "granted" },
      });
    }
  });

  it("accepts natural refusal", () => {
    for (const said of ["no", "nah", "no thanks", "rather not"]) {
      expect(applyAnswer({}, "consent", said, tenant)).toMatchObject({
        ok: true,
        collected: { consent: "declined" },
      });
    }
  });

  it("asks again rather than inferring consent from unclear words", () => {
    expect(applyAnswer({}, "consent", "what does that mean", tenant).ok).toBe(false);
  });
});
