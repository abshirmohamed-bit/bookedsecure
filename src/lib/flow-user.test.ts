// USER FLOW — the three journeys a real person can take, walked end to end.
//
//   A. New visitor: quote page → service (with price) → details → review →
//      consent → server-offered slot → explicit confirmation.
//   B. Returning contact from a win-back link: recognised, not re-asked, and
//      landing back on their OWN record.
//   C. Someone who is unsure or asks a question: answered from tenant facts,
//      never pushed to the next field with a wrong answer stored.

import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  campaignPrefill,
  nextStep,
  promptFor,
  reviewSummary,
  serviceAcknowledgement,
  resolveOutcome,
  type WebChatCollected,
  type WebChatService,
  type WebChatTenant,
} from "@/lib/web-chat";
import { mergeReturningLead } from "@/lib/returning-lead";
import {
  looksUncertain,
  looksLikeQuestion,
  classifyQuestionTopic,
  answerQuestion,
  guardConversationalReply,
  replyAsksSomething,
} from "@/lib/web-chat-conversation";

const svc = (over: Partial<WebChatService> & { id: string; name: string }): WebChatService => ({
  description: null,
  included_items: null,
  excluded_items: null,
  qualification_note: null,
  price_guidance: null,
  campaign_eligible: true,
  ...over,
});

const tenant: WebChatTenant = {
  name: "Coastal Shine Detailing",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  bookingEnabled: true,
  services: [
    svc({ id: "s1", name: "Full Detail", price_guidance: "from $250", description: "Inside and out." }),
    svc({ id: "s2", name: "Express Wash", price_guidance: "from $80" }),
  ],
};

/** Walks the step machine, answering with the supplied values. Fails loudly. */
function walk(start: WebChatCollected, answers: Partial<Record<string, string>>): WebChatCollected {
  let collected = { ...start };
  for (let guard = 0; guard < 20; guard += 1) {
    const step = nextStep(collected);
    if (step === null) return collected;
    const answer = answers[step];
    if (answer === undefined) return collected;
    const result = applyAnswer(collected, step, answer, tenant);
    if (!result.ok) throw new Error(`${step}: ${result.error}`);
    collected = result.collected;
  }
  throw new Error("step machine did not terminate");
}

describe("user flow A — new visitor books", () => {
  it("starts at the service question and offers the tenant's own services with prices", () => {
    expect(nextStep({})).toBe("service");
    const prompt = promptFor("service", { ...tenant, offerPercent: 15 }, {});
    expect(prompt.kind).toBe("choice");
    const labels = (prompt.options ?? []).map((option) => `${option.label} ${option.detail ?? ""}`).join(" | ");
    expect(labels).toContain("Full Detail");
    expect(labels).toContain("from $250");
    expect(labels).toContain("15% off");
  });

  it("shows the price with the next question once a service is chosen", () => {
    const chosen = applyAnswer({}, "service", "s1", tenant);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(serviceAcknowledgement(tenant, chosen.collected)).toContain("from $250");
    expect(nextStep(chosen.collected)).toBe("vehicle");
  });

  it("collects every detail once, in order, and reaches the review step", () => {
    const collected = walk(
      {},
      {
        service: "s1",
        vehicle: "Mazda CX-5",
        suburb: "Punchbowl",
        address: "12 Example St, Punchbowl NSW 2196",
        concerns: "Some swirl marks",
        name: "Dana Fields",
        mobile: "0466 907 824",
        email: "dana@example.com",
      },
    );
    expect(nextStep(collected)).toBe("review");
    expect(collected.mobile_number).toBe("+61466907824");
    const summary = reviewSummary(collected);
    expect(summary.find((row) => row.label === "Service")?.value).toBe("Full Detail");
    expect(summary.every((row) => row.value !== "—")).toBe(true);
    expect(resolveOutcome(collected).requiresOwnerReview).toBe(false);
  });

  it("asks for consent after review, and stops when consent is declined", () => {
    const reviewed = walk(
      {},
      {
        service: "s2",
        vehicle: "Toyota RAV4",
        suburb: "Bankstown",
        address: "3 Sample Rd, Bankstown NSW 2200",
        concerns: "None",
        name: "Sam Lee",
        mobile: "0455 222 333",
        email: "skip",
        review: "yes",
      },
    );
    expect(nextStep(reviewed)).toBe("consent");
    const declined = applyAnswer(reviewed, "consent", "no", tenant);
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.collected.consent).toBe("declined");
    expect(nextStep(declined.collected)).toBeNull();
  });

  it("never books before the customer confirms a slot the server offered", () => {
    const consented: WebChatCollected = {
      service_id: "s1",
      service_name: "Full Detail",
      vehicle_type: "Mazda CX-5",
      suburb: "Punchbowl",
      service_address: "12 Example St",
      concerns: "Swirls",
      name: "Dana",
      mobile_number: "+61466907824",
      email: null,
      reviewed: true,
      consent: "granted",
    };
    // No server offers yet: the conversation does not invent a booking step.
    expect(nextStep(consented)).toBeNull();

    const offered = { ...consented, booking_offered: true };
    expect(nextStep(offered)).toBe("booking");

    const held = { ...offered, booking_selected: "2026-09-10T23:00:00.000Z" };
    expect(nextStep(held)).toBe("booking_confirm");
    expect(held.booking_confirmed).toBeUndefined();

    const confirmed = { ...held, booking_confirmed: true };
    expect(nextStep(confirmed)).toBeNull();
  });

  it("routes an unlisted request to the owner instead of inventing a service", () => {
    const typed = applyAnswer({}, "service", "I need my engine rebuilt", tenant);
    expect(typed.ok).toBe(true);
    if (!typed.ok) return;
    expect(typed.collected.service_id ?? null).toBeNull();
    expect(resolveOutcome(typed.collected).requiresOwnerReview).toBe(true);
  });
});

describe("user flow B — returning contact from a win-back link", () => {
  it("prefills the details already on file and skips those questions", () => {
    const prefill = campaignPrefill({ name: "Dana Fields", mobile_number: "+61466907824", email: "dana@example.com" });
    expect(prefill).not.toBeNull();
    const collected = walk(prefill ?? {}, {
      service: "s1",
      vehicle: "Mazda CX-5",
      suburb: "Punchbowl",
      address: "12 Example St",
      concerns: "Swirls",
    });
    expect(nextStep(collected)).toBe("review");
    expect(collected.name).toBe("Dana Fields");
    expect(collected.mobile_number).toBe("+61466907824");
  });

  it("does not prefill a placeholder name, so a real name is still captured", () => {
    const prefill = campaignPrefill({ name: "web visitor", mobile_number: "+61466907824", email: null });
    expect(prefill?.name).toBeNull();
    expect(nextStep({ ...prefill, service_id: "s1", vehicle_type: "Ute", suburb: "X", service_address: "Y", concerns: "Z" })).toBe("name");
  });

  it("lands the new enquiry on their existing record without overwriting known details", () => {
    const patch = mergeReturningLead(
      { name: "Dana Fields", email: "dana@example.com", suburb: "Punchbowl", vehicle_type: null },
      {
        name: "Dana",
        email: "other@example.com",
        suburb: "Bankstown",
        vehicle_type: "Mazda CX-5",
        service_intent: "Full Detail",
        approved_service_id: "s1",
        source_channel: "web",
      },
    );
    expect(patch["name"]).toBeUndefined();
    expect(patch["email"]).toBeUndefined();
    expect(patch["suburb"]).toBeUndefined();
    expect(patch["vehicle_type"]).toBe("Mazda CX-5");
    expect(patch["service_intent"]).toBe("Full Detail");
    expect(patch["status"]).toBe("new");
  });
});

describe("user flow C — unsure customers and questions", () => {
  const facts = {
    businessName: tenant.name,
    services: tenant.services.map((service) => ({ name: service.name, price_guidance: service.price_guidance ?? null })),
    serviceArea: "Inner West and South West Sydney",
    flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  } as never;

  it("recognises uncertainty instead of saving it as the service", () => {
    for (const phrase of ["not sure", "i need something else", "no idea", "what do you recommend"]) {
      expect(looksUncertain(phrase) || looksLikeQuestion(phrase)).toBe(true);
    }
  });

  it("answers a question from tenant facts only", () => {
    const topic = classifyQuestionTopic("how much is a full detail?");
    expect(topic).not.toBeNull();
    const answer = answerQuestion(topic!, facts);
    expect(answer).not.toBeNull();
    expect(answer).not.toMatch(/tomorrow|guarantee/i);
  });

  it("strips any promise a model reply might contain, and keeps the conversation moving", () => {
    const guarded = guardConversationalReply("We can definitely do tomorrow at 9am for $199, guaranteed.");
    expect(guarded === null || !/tomorrow|9am|\$199|guarantee/i.test(guarded)).toBe(true);
    expect(replyAsksSomething("What's the vehicle? (make and model)")).toBe(true);
  });
});
