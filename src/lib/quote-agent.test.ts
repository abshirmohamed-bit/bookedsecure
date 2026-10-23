import { describe, expect, it } from "vitest";
import { AGENT_STEP, agentPrompt, buildQuoteAgentSystem, guardAgentReply } from "@/lib/quote-agent";
import type { WebChatTenant } from "@/lib/web-chat";

const tenant: WebChatTenant = {
  name: "Shiny Detailing",
  flexibleRequestsEnabled: true,
  bookingEnabled: true,
  quoteSubjectLabel: "Vehicle",
  addons: [
    { id: "a1", name: "Seat extraction", price_guidance: "$119.99", serviceIds: ["s1"], active: true },
    { id: "a2", name: "Engine bay", price_guidance: "$60", serviceIds: ["s1"], active: false },
  ],
  services: [
    {
      id: "s1",
      name: "Full detail",
      description: "Inside and out",
      included_items: "Wash, vacuum",
      excluded_items: "Paint correction",
      qualification_note: null,
      price_guidance: "from $250",
      duration_minutes: 180,
    },
  ],
};

describe("quote agent guard rails", () => {
  it("removes a booking claim when nothing was committed", () => {
    const { reply, flagged } = guardAgentReply("Lovely. You're booked in for Friday. Anything else?");
    expect(reply).not.toMatch(/booked/i);
    expect(flagged).toHaveLength(1);
    expect(reply).toContain("Anything else?");
  });

  it("keeps the booking claim once the booking tool committed one", () => {
    const { reply, flagged } = guardAgentReply("Your booking is confirmed.", { bookingConfirmed: true });
    expect(reply).toMatch(/confirmed/i);
    expect(flagged).toHaveLength(0);
  });

  it("strips markdown and caps the length", () => {
    const { reply } = guardAgentReply(`**Hi** there. ${"word ".repeat(300)}`);
    expect(reply).not.toContain("*");
    expect(reply.length).toBeLessThanOrEqual(700);
  });
});

describe("quote agent prompt", () => {
  it("is a plain text turn by default", () => {
    const prompt = agentPrompt("What can we help with?");
    expect(prompt.step).toBe(AGENT_STEP);
    expect(prompt.kind).toBe("text");
  });

  it("becomes a choice turn when times are offered", () => {
    const prompt = agentPrompt("Here are two times.", [
      { value: "Friday 9:00 am", label: "Friday 9:00 am", detail: null },
    ]);
    expect(prompt.kind).toBe("choice");
    expect(prompt.options).toHaveLength(1);
  });
});

describe("quote agent instructions", () => {
  const system = buildQuoteAgentSystem({
    tenant,
    tenantSlug: "shiny",
    timeZone: "Australia/Sydney",
    localDate: "2026-09-20",
    localTime: "14:51",
    localWeekday: "Sunday",
    bookingEnabled: true,
    knownFacts: { name: "Iesha", mobile: null, suburb: "  " },
    leadSaved: false,
  });

  it("carries only this tenant's own services, prices and extras", () => {
    expect(system).toContain("Shiny Detailing");
    expect(system).toContain("Full detail");
    expect(system).toContain("from $250");
    expect(system).toContain("Seat extraction");
    expect(system).toContain("currently unavailable");
  });

  it("lists known details and omits blank ones", () => {
    expect(system).toContain("name: Iesha");
    expect(system).not.toContain("mobile:");
    expect(system).not.toContain("suburb:");
  });

  it("forbids invented prices, times and bookings", () => {
    expect(system).toMatch(/Never invent, estimate, total, discount or adjust a price/);
    expect(system).toMatch(/Times only ever come from the offer_times tool/);
    expect(system).toContain("No enquiry has been saved yet.");
  });
});
