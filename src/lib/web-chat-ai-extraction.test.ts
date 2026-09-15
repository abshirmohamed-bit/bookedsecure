// Structured AI extraction for the public quote chat.
//
// Pure functions and an injected fake extractor only: no database, no model
// call, no SMS, no booking, no lead write, no provider call.
import { describe, expect, it, vi } from "vitest";
import {
  applyAiCorrections,
  buildAiExtractionPrompt,
  buildAiExtractionSystem,
  mayCarryMultipleFields,
  mergeAiExtraction,
  resolveIntake,
  WebChatAiExtractionSchema,
  type WebChatAiExtraction,
} from "@/lib/web-chat-ai-extraction";
import { extractIntake, outstandingFields, type IntakeTenant } from "@/lib/web-chat-intake";
import type { WebChatCollected, WebChatTenant } from "@/lib/web-chat";

const services = [
  { id: "s1", name: "Ceramic Coating" },
  { id: "s2", name: "Full Interior Detail" },
  { id: "s3", name: "Exterior Detail" },
];

const intakeTenant: IntakeTenant = {
  timezone: "Australia/Sydney",
  services,
  locations: ["Punchbowl", "Bankstown", "Parramatta"],
};

const chatTenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  services: services.map((service) => ({
    id: service.id,
    name: service.name,
    description: null,
    included_items: null,
    excluded_items: null,
    qualification_note: null,
  })),
};

const now = new Date("2026-09-09T00:00:00.000Z");

const AUBURN =
  "auburn, and its in bad condition the carpet, i accidentally left the window open, and it needs a really clean up please, my name is abshir and my number is 0466907824";

function ai(overrides: Partial<WebChatAiExtraction> = {}): WebChatAiExtraction {
  return {
    service: null,
    vehicle: null,
    suburb: null,
    address: null,
    condition: null,
    concerns: null,
    name: null,
    mobile: null,
    email: null,
    corrections: [],
    ambiguous_fields: [],
    still_missing: [],
    question_topic: null,
    uncertain: false,
    unsupported: false,
    reply: null,
    ...overrides,
  };
}

const auburnExtraction = ai({
  suburb: "Auburn",
  condition: "bad condition",
  concerns: "accidentally left the window open and the carpet needs a thorough clean",
  name: "Abshir",
  mobile: "0466907824",
  still_missing: ["service", "vehicle"],
});

async function resolve(
  raw: string,
  collected: WebChatCollected,
  extraction: WebChatAiExtraction | null,
  step = "suburb",
) {
  const extract = vi.fn(async () => extraction);
  const result = await resolveIntake({
    raw,
    collected,
    chatTenant,
    intakeTenant,
    step,
    turns: [{ role: "assistant", body: "Which suburb should we come to?" }],
    businessName: "Glocast",
    extract,
    now,
  });
  return { result, extract };
}

describe("prompt and context", () => {
  it("sends state, outstanding fields, recent turns and the message", () => {
    const collected: WebChatCollected = { service_id: "s1", service_name: "Ceramic Coating" };
    const context = {
      businessName: "Glocast",
      services: services.map((service) => service.name),
      locations: intakeTenant.locations,
      collected,
      outstanding: outstandingFields(collected),
      openStep: "vehicle",
      turns: [{ role: "customer", body: "hi" }],
      message: AUBURN,
    };
    const system = buildAiExtractionSystem(context);
    const prompt = buildAiExtractionPrompt(context);
    expect(system).toContain("Ceramic Coating");
    expect(system).toContain("Punchbowl");
    expect(system).toContain("Never invent or state a price");
    expect(prompt).toContain("Ceramic Coating");
    expect(prompt).toContain("Question currently open: vehicle");
    expect(prompt).toContain("vehicle, location, address, concerns, name, mobile");
    expect(prompt).toContain(AUBURN);
  });

  it("interprets every real message exactly once, one-word answers included", async () => {
    expect(mayCarryMultipleFields("Auburn")).toBe(false);
    expect(mayCarryMultipleFields(AUBURN)).toBe(true);

    const short = await resolve("Auburn", {}, auburnExtraction);
    expect(short.extract).toHaveBeenCalledTimes(1);
    expect(short.result.calls).toBe(1);

    const rich = await resolve(AUBURN, {}, auburnExtraction);
    expect(rich.extract).toHaveBeenCalledTimes(1);
    expect(rich.result.calls).toBe(1);
  });
});

describe("the Auburn message", () => {
  it("regex alone still loses the suburb and the condition", () => {
    const regex = extractIntake(AUBURN, intakeTenant, now);
    expect(regex.location).toBeNull();
    expect(regex.notes).toBeNull();
  });

  it("captures suburb, condition, concerns, name and mobile", async () => {
    const { result } = await resolve(AUBURN, {}, auburnExtraction);
    expect(result.aiUsed).toBe(true);
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.concerns).toContain("bad condition");
    expect(result.collected.concerns).toContain("carpet");
    expect(result.collected.concerns).toContain("window");
    expect(result.collected.name).toBe("Abshir");
    expect(result.collected.mobile_number).toBe("+61466907824");
  });

  it("leaves service and vehicle missing and asks only for those", async () => {
    const { result } = await resolve(AUBURN, {}, auburnExtraction);
    expect(result.collected.service_id ?? null).toBeNull();
    expect(result.collected.vehicle_type ?? null).toBeUndefined;
    expect(outstandingFields(result.collected)).toEqual(["service", "vehicle", "address"]);
  });

  it("is processed even though the open field alone would be one value", async () => {
    const { result } = await resolve(AUBURN, {}, auburnExtraction);
    expect(result.beyondOpenStep).toBe(true);
    expect(result.applied.length).toBeGreaterThan(1);
  });

  it("never invents a booking, price, consent or service", async () => {
    const { result } = await resolve(AUBURN, {}, auburnExtraction);
    expect(result.collected.consent ?? null).toBeNull();
    expect(result.collected.booking_confirmed ?? null).toBeNull();
    expect(result.collected.booking_selected ?? null).toBeNull();
    expect(result.collected.reviewed ?? null).toBeFalsy();
    expect(result.collected.service_name ?? null).toBeNull();
  });
});

describe("state merging", () => {
  it("preserves existing valid fields", async () => {
    const collected: WebChatCollected = {
      service_id: "s2",
      service_name: "Full Interior Detail",
      vehicle_type: "Mazda 3",
      name: "Existing Name",
    };
    const { result } = await resolve(AUBURN, collected, auburnExtraction);
    expect(result.collected.service_name).toBe("Full Interior Detail");
    expect(result.collected.vehicle_type).toBe("Mazda 3");
    expect(result.collected.name).toBe("Existing Name");
    expect(result.collected.suburb).toBe("Auburn");
  });

  it("accepts several fields supplied out of order", async () => {
    const { result } = await resolve(
      "my number is 0466907824, im in Bankstown, its a Mazda 3, ceramic coating please",
      {},
      ai({
        service: "Ceramic Coating",
        vehicle: "Mazda 3",
        suburb: "Bankstown",
        mobile: "0466907824",
      }),
      "service",
    );
    expect(result.collected.service_name).toBe("Ceramic Coating");
    expect(result.collected.vehicle_type).toBe("Mazda 3");
    expect(result.collected.suburb).toBe("Bankstown");
    expect(result.collected.mobile_number).toBe("+61466907824");
  });

  it("only ever resolves a service inside the approved catalogue", () => {
    const merged = mergeAiExtraction(
      extractIntake("engine rebuild please", intakeTenant, now),
      ai({ service: "Engine Rebuild" }),
      intakeTenant,
    );
    expect(merged.service).toBeNull();
  });

  it("does not merge invalid candidate values", async () => {
    const { result } = await resolve(
      "the car is a bit dirty, call me on 12345",
      {},
      ai({ mobile: "12345", suburb: AUBURN, name: "" }),
      "mobile",
    );
    expect(result.collected.mobile_number ?? null).toBeNull();
    // The containment guard still refuses a whole message as a suburb.
    expect(result.collected.suburb ?? null).toBeNull();
    expect(result.collected.name ?? null).toBeNull();
  });

  it("leaves an ambiguous field unresolved", async () => {
    const { result } = await resolve(
      "i need a detail for my car in the inner west somewhere",
      {},
      ai({ suburb: "not sure", ambiguous_fields: ["suburb", "service"] }),
      "suburb",
    );
    expect(result.collected.suburb ?? null).toBeNull();
    expect(result.collected.service_id ?? null).toBeNull();
  });
});

describe("corrections", () => {
  it("applies a supported and valid correction", () => {
    const collected: WebChatCollected = { suburb: "Punchbowl", name: "Abshir" };
    const { collected: next, applied } = applyAiCorrections(
      collected,
      [{ field: "suburb", value: "Bankstown" }],
      chatTenant,
    );
    expect(next.suburb).toBe("Bankstown");
    expect(applied).toHaveLength(1);
    expect(next.reviewed).toBe(false);
  });

  it("ignores a correction to an empty field or an unchanged value", () => {
    const first = applyAiCorrections({}, [{ field: "suburb", value: "Bankstown" }], chatTenant);
    expect(first.applied).toHaveLength(0);
    const same = applyAiCorrections(
      { suburb: "Bankstown" },
      [{ field: "suburb", value: "bankstown" }],
      chatTenant,
    );
    expect(same.applied).toHaveLength(0);
  });

  it("ignores an invalid or ambiguous correction", () => {
    const invalid = applyAiCorrections(
      { mobile_number: "+61466907824" },
      [{ field: "mobile", value: "nope" }],
      chatTenant,
    );
    expect(invalid.collected.mobile_number).toBe("+61466907824");
    const ambiguous = applyAiCorrections(
      { suburb: "Punchbowl" },
      [{ field: "suburb", value: "Bankstown" }],
      chatTenant,
      ["suburb"],
    );
    expect(ambiguous.collected.suburb).toBe("Punchbowl");
  });

  it("routes a correction through the intake branch even with one field", async () => {
    const { result } = await resolve(
      "actually make the suburb Bankstown instead please",
      { suburb: "Punchbowl", vehicle_type: "Mazda 3" },
      ai({ corrections: [{ field: "suburb", value: "Bankstown" }] }),
      "name",
    );
    expect(result.collected.suburb).toBe("Bankstown");
    expect(result.corrections).toHaveLength(1);
    expect(result.beyondOpenStep).toBe(true);
  });
});

describe("failure safety", () => {
  it("falls back to the regex result when the model fails", async () => {
    const extract = vi.fn(async () => {
      throw new Error("provider down");
    });
    const result = await resolveIntake({
      raw: "ceramic coating for my Mazda 3 in Bankstown",
      collected: {},
      chatTenant,
      intakeTenant,
      step: "service",
      turns: [],
      businessName: "Glocast",
      extract: extract as never,
      now,
    });
    expect(result.aiUsed).toBe(false);
    expect(result.collected.service_name).toBe("Ceramic Coating");
    expect(result.collected.suburb).toBe("Bankstown");
  });

  it("a malformed model response cannot mutate state", async () => {
    const collected: WebChatCollected = { suburb: "Punchbowl" };
    const { result } = await resolve(
      AUBURN,
      collected,
      { suburb: 42, corrections: "nope" } as unknown as WebChatAiExtraction,
    );
    expect(result.aiUsed).toBe(false);
    expect(result.collected.suburb).toBe("Punchbowl");
    expect(WebChatAiExtractionSchema.safeParse({ suburb: 42 }).success).toBe(false);
  });

  it("a null model response leaves the deterministic behaviour unchanged", async () => {
    const { result } = await resolve(AUBURN, {}, null);
    expect(result.aiUsed).toBe(false);
    expect(result.collected.mobile_number).toBe("+61466907824");
    // Without the model, Auburn and the condition are still not understood.
    expect(result.collected.suburb ?? null).toBeNull();
  });

  it("never lets a raw multi-clause message become a canonical field value", async () => {
    const { result } = await resolve(AUBURN, {}, ai({ suburb: AUBURN, name: AUBURN, vehicle: AUBURN }));
    // The raw sentence never lands anywhere. A clean value the deterministic
    // pass recovered (the suburb "Auburn") may legitimately survive.
    for (const value of [result.collected.suburb, result.collected.name, result.collected.vehicle_type]) {
      expect(value ?? "").not.toContain("my number is");
      expect(value ?? "").not.toContain("bad condition");
      expect((value ?? "").length).toBeLessThan(40);
    }
    // Only a single short token can survive from a lying model, never the sentence.
    expect((result.collected.name ?? "").split(/\s+/).length).toBeLessThan(4);
    expect(result.collected.vehicle_type ?? null).toBeNull();
  });
});
