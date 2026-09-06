import { describe, expect, it, vi } from "vitest";

// Pure guard-rail tests: no AI provider, no database. The Supabase admin client
// and AI SDK are stubbed so importing the module never opens a connection.
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("ai", () => ({ generateText: () => { throw new Error("no live AI calls in tests"); }, Output: { object: () => ({}) } }));

const FALLBACK =
  "Thanks for those details. The team will confirm the right service and pricing with you shortly.";

const { guardReply } = await import("@/lib/ai.server");

describe("guardReply", () => {
  it("removes dollar figures and prices", () => {
    const r = guardReply("A full detail is $250. We can look after your car this season.");
    expect(r.reply).not.toMatch(/\$/);
    expect(r.flagged).toContain("A full detail is $250.");
    expect(r.reply).toBe("We can look after your car this season.");
  });

  it("removes prices written in words", () => {
    const r = guardReply("It costs 250 dollars. Our interior detail covers seats and carpets.");
    expect(r.reply).toBe("Our interior detail covers seats and carpets.");
    expect(r.flagged).toHaveLength(1);
  });

  it("removes discounts and special offers", () => {
    const r = guardReply(
      "We have a discount for you. There is also a special offer running. Our exterior wash includes a hand dry.",
    );
    expect(r.reply).toBe("Our exterior wash includes a hand dry.");
    expect(r.flagged).toHaveLength(2);
  });

  it("removes date promises", () => {
    const r = guardReply("We can come tomorrow. Our paint decontamination takes about two hours.");
    expect(r.reply).toBe("Our paint decontamination takes about two hours.");
    expect(r.flagged).toContain("We can come tomorrow.");
  });

  it("removes time promises", () => {
    const r = guardReply("A detailer is available at 9am. Interior sanitising is included.");
    expect(r.reply).toBe("Interior sanitising is included.");
    expect(r.flagged).toContain("A detailer is available at 9am.");
  });

  it("removes booking confirmations", () => {
    const r = guardReply(
      "You are booked in. We have confirmed your booking. The team will review your request.",
    );
    expect(r.reply).toBe("The team will review your request.");
    expect(r.flagged).toHaveLength(2);
  });

  it("preserves a safe service-focused response", () => {
    const safe =
      "Thanks for the details about your SUV. Our full detail covers interior vacuum, seat shampoo and an exterior hand wash. The team will confirm the right option with you.";
    const r = guardReply(safe);
    expect(r.reply).toBe(safe);
    expect(r.flagged).toEqual([]);
  });

  it("returns the neutral fallback when the whole response is unsafe", () => {
    const r = guardReply("You are booked in for tomorrow. It will be $199 with a discount.");
    expect(r.reply).toBe(FALLBACK);
    expect(r.flagged).toHaveLength(2);
  });

  it("does not remove ordinary service descriptions", () => {
    const r = guardReply(
      "We offer ceramic coating, paint correction and interior steam cleaning. Two coats of sealant are applied by hand. Pricing depends on vehicle condition and is confirmed by the owner.",
    );
    expect(r.flagged).toEqual([]);
    expect(r.reply).toMatch(/ceramic coating/);
    expect(r.reply).toMatch(/confirmed by the owner/);
  });

  it("handles mixed safe and unsafe sentences", () => {
    const r = guardReply(
      "Thanks for reaching out about your ute. We can be there this weekend. Our full detail includes an engine bay wipe down. The total is $320. An owner will confirm the right service for you.",
    );
    expect(r.reply).toBe(
      "Thanks for reaching out about your ute. Our full detail includes an engine bay wipe down. An owner will confirm the right service for you.",
    );
    expect(r.flagged).toEqual(["We can be there this weekend.", "The total is $320."]);
  });

  it("never returns an empty reply", () => {
    expect(guardReply("").reply).toBe(FALLBACK);
    expect(guardReply("   ").reply).toBe(FALLBACK);
  });
});
