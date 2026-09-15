/**
 * Conversational layer regression tests.
 *
 * Pure module only: no database, no provider, no model call, no booking or lead
 * mutation. Every assertion checks that an answer is composed from tenant facts
 * or withheld — never invented.
 */

import { describe, expect, it } from "vitest";
import {
  acknowledgeFields,
  answerQuestion,
  assembleReply,
  classifyQuestionTopic,
  guardConversationalReply,
  isConversationalIntakeTenant,
  looksLikeQuestion,
  looksUncertain,
  replyAsksSomething,
  uncertainServiceMessage,
  unsupportedAnswer,
  type AnswerFacts,
} from "@/lib/web-chat-conversation";
import { applyAnswer, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";

const FACTS: AnswerFacts = {
  businessName: "Glocast",
  services: [
    { name: "Full Interior Detail", description: "Seats, carpets, trim." },
    { name: "Exterior Wash", description: null },
  ],
  locations: ["Auburn", "Bankstown"],
  outstanding: ["service", "vehicle"],
  bookingEnabled: true,
  suburb: null,
};

const TENANT: WebChatTenant = {
  businessId: "11111111-1111-1111-1111-111111111111",
  name: "Glocast",
  services: [
    { id: "s-int", name: "Full Interior Detail", description: "Seats, carpets, trim." },
    { id: "s-ext", name: "Exterior Wash", description: null },
  ],
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  bookingEnabled: true,
} as unknown as WebChatTenant;

const EMPTY: WebChatCollected = {} as WebChatCollected;

describe("uncertainty detection", () => {
  it.each([
    "I need something else",
    "not sure",
    "i dont know",
    "you tell me",
    "what do you recommend",
    "no idea",
  ])("treats %s as uncertainty, not a value", (message) => {
    expect(looksUncertain(message)).toBe(true);
  });

  it("does not treat a real service mention as uncertainty", () => {
    expect(looksUncertain("Full Interior Detail please")).toBe(false);
  });

  it("never stores an uncertain reply as a flexible service request", () => {
    const result = applyAnswer(EMPTY, "service", "I need something else", TENANT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Full Interior Detail");
  });

  it("still accepts a genuine flexible request", () => {
    const result = applyAnswer(EMPTY, "service", "engine bay clean", TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.collected.typed_request).toBe("engine bay clean");
  });
});

describe("question classification", () => {
  it("detects questions without a question mark", () => {
    expect(looksLikeQuestion("do you come to Auburn")).toBe(true);
  });

  it.each([
    ["how much is a full detail?", "price"],
    ["what services do you offer?", "services"],
    ["do you come to Auburn?", "service_area"],
    ["what times are available?", "times"],
    ["what happens next?", "next_step"],
    ["what else do you need from me?", "outstanding"],
  ])("classifies %s", (message, topic) => {
    expect(classifyQuestionTopic(message)).toBe(topic);
  });

  it("returns null for a plain answer", () => {
    expect(classifyQuestionTopic("Toyota HiAce")).toBeNull();
  });
});

describe("deterministic answers", () => {
  it("never quotes a price", () => {
    const answer = answerQuestion("price", FACTS)!;
    expect(answer).toContain("can't quote a price");
    expect(answer).not.toMatch(/\$|\d/);
  });

  it("lists only approved services", () => {
    expect(answerQuestion("services", FACTS)).toBe(
      "We do Full Interior Detail or Exterior Wash. Pick one below, or tell me what needs attention.",
    );
  });

  it("withholds a service answer when no services are configured", () => {
    expect(answerQuestion("services", { ...FACTS, services: [] })).toBeNull();
  });

  it("answers service area only from configured locations", () => {
    expect(answerQuestion("service_area", { ...FACTS, suburb: "Auburn" })).toBe("Yes, we cover Auburn.");
    expect(answerQuestion("service_area", { ...FACTS, locations: [] })).toBeNull();
  });

  it("never promises a specific time", () => {
    const answer = answerQuestion("times", FACTS)!;
    expect(answer).toContain("Nothing is held");
    expect(answer).not.toMatch(/\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/i);
  });

  it("withholds a times answer when booking is off", () => {
    expect(answerQuestion("times", { ...FACTS, bookingEnabled: false })).toBeNull();
  });

  it("names only genuinely outstanding fields", () => {
    expect(answerQuestion("outstanding", FACTS)).toBe("Still need the service and the vehicle.");
    expect(answerQuestion("outstanding", { ...FACTS, outstanding: [] })).toBe(
      "Nothing else, I have what I need.",
    );
  });

  it("deflects honestly with no supporting fact", () => {
    expect(unsupportedAnswer({ ...FACTS, outstanding: [] })).toBe(
      "I can't confirm that here, but the team can review it.",
    );
  });

  it("offers the service list when stuck choosing", () => {
    expect(uncertainServiceMessage(FACTS)).toContain("Full Interior Detail or Exterior Wash");
  });
});

describe("reply assembly", () => {
  it("orders acknowledge, answer, ask and drops empties", () => {
    expect(
      assembleReply({ acknowledgement: "Got it, Auburn.", answer: null, ask: "What's the vehicle?" }),
    ).toEqual(["Got it, Auburn.", "What's the vehicle?"]);
  });

  it("never repeats the same sentence", () => {
    expect(assembleReply({ answer: "Same line.", ask: "same line." })).toEqual(["Same line."]);
  });

  it("acknowledges only validated values and never the service", () => {
    expect(
      acknowledgeFields([
        { label: "vehicle", value: "Toyota HiAce" },
        { label: "location", value: "Auburn" },
        { label: "service", value: "Full Interior Detail" },
        { label: "name", value: "  " },
      ]),
    ).toBe("Got it, Toyota HiAce and Auburn.");
  });

  it("returns nothing to acknowledge when no value landed", () => {
    expect(acknowledgeFields([{ label: "vehicle", value: "" }])).toBeNull();
  });
});

describe("availability", () => {
  it("is enabled for every tenant", () => {
    expect(isConversationalIntakeTenant("11111111-1111-1111-1111-111111111111")).toBe(true);
    expect(isConversationalIntakeTenant("22222222-2222-2222-2222-222222222222")).toBe(true);
  });
});

describe("guardConversationalReply", () => {
  it("keeps friendly phrasing", () => {
    expect(guardConversationalReply("No worries, changed it to Cabramatta. What is the vehicle?")).toBe(
      "No worries, changed it to Cabramatta. What is the vehicle?",
    );
  });

  it("strips a price claim but keeps the rest", () => {
    expect(guardConversationalReply("Got the Hilux. That is $250. What suburb are you in?")).toBe(
      "Got the Hilux. What suburb are you in?",
    );
  });

  it("strips a time or availability promise", () => {
    expect(guardConversationalReply("We can come tomorrow at 9am.")).toBeNull();
    expect(guardConversationalReply("We have availability this week.")).toBeNull();
  });

  it("strips a booking confirmation", () => {
    expect(guardConversationalReply("You are booked in. Thanks!")).toBe("Thanks!");
  });

  it("removes dashes and caps the length", () => {
    expect(guardConversationalReply("Got it \u2014 nice one.")).not.toContain("\u2014");
    const long = guardConversationalReply("a".repeat(400));
    expect((long ?? "").length).toBeLessThanOrEqual(240);
  });

  it("returns null for empty wording", () => {
    expect(guardConversationalReply(null)).toBeNull();
    expect(guardConversationalReply("   ")).toBeNull();
  });

  it("detects whether the wording already asks something", () => {
    expect(replyAsksSomething("What is the vehicle?")).toBe(true);
    expect(replyAsksSomething("Got it.")).toBe(false);
  });
});
