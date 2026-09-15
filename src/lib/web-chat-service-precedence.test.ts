// Service-resolution precedence.
//
// A service the customer chose with a button is canonical: later natural
// language that merely repeats it must never trigger a clarification, and must
// never overwrite it. Pure functions only: no database, no provider, no SMS.
import { describe, expect, it } from "vitest";
import { type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { matchApprovedService, type IntakeTenant } from "@/lib/web-chat-intake";
import { resolveIntake, type WebChatAiExtraction } from "@/lib/web-chat-ai-extraction";

const CHAT_TENANT: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  services: [
    { id: "s-int", name: "Full Interior Detail", description: null },
    { id: "s-both", name: "Full Detail Interior + Exterior", description: null },
    { id: "s-ext", name: "Exterior Detail", description: null },
  ],
} as unknown as WebChatTenant;

const INTAKE_TENANT: IntakeTenant = {
  timezone: "Australia/Sydney",
  services: [
    { id: "s-int", name: "Full Interior Detail" },
    { id: "s-both", name: "Full Detail Interior + Exterior" },
    { id: "s-ext", name: "Exterior Detail" },
  ],
  locations: ["Auburn", "Parramatta", "Bankstown"],
};

const BUTTON_STATE: WebChatCollected = { service_id: "s-int", service_name: "Full Interior Detail" };

const MESSAGE =
  "i need a full interior detail for my toyota motorhome, i live in auburn and my phone number is 0466907824";

function ai(partial: Partial<WebChatAiExtraction>): WebChatAiExtraction {
  return {
    service: null,
    vehicle: null,
    suburb: null,
    condition: null,
    concerns: null,
    name: null,
    mobile: null,
    email: null,
    corrections: [],
    ambiguous_fields: [],
    still_missing: [],
    ...partial,
  } as WebChatAiExtraction;
}

async function resolve(
  collected: WebChatCollected,
  raw: string,
  extraction: WebChatAiExtraction,
  step = "vehicle",
) {
  let calls = 0;
  const resolved = await resolveIntake({
    raw,
    collected,
    chatTenant: CHAT_TENANT,
    intakeTenant: INTAKE_TENANT,
    step,
    turns: [],
    businessName: "Glocast",
    extract: async () => {
      calls += 1;
      return extraction;
    },
  });
  return { ...resolved, calls };
}

describe("service precedence", () => {
  it("keeps the button-selected service when the same service is restated in words", async () => {
    const result = await resolve(
      BUTTON_STATE,
      MESSAGE,
      ai({
        service: "Full Interior Detail",
        vehicle: "Toyota motorhome",
        suburb: "Auburn",
        mobile: "0466907824",
      }),
    );
    expect(result.extraction.ambiguities).toEqual([]);
    expect(result.collected.service_id).toBe("s-int");
    expect(result.collected.service_name).toBe("Full Interior Detail");
  });

  it("merges vehicle, suburb and mobile from the same reply", async () => {
    const result = await resolve(
      BUTTON_STATE,
      MESSAGE,
      ai({
        service: "Full Interior Detail",
        vehicle: "Toyota motorhome",
        suburb: "Auburn",
        mobile: "0466907824",
      }),
    );
    expect(result.collected.vehicle_type).toBe("Toyota motorhome");
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.mobile_number).toBe("+61466907824");
    expect(result.calls).toBe(1);
  });

  it("resolves a verbatim catalogue name even when a similar service exists", () => {
    expect(matchApprovedService(MESSAGE, INTAKE_TENANT.services)).toEqual({
      kind: "one",
      service: INTAKE_TENANT.services[0],
    });
  });

  it("asks which one when two approved services are genuinely plausible", () => {
    const match = matchApprovedService("i just want a full detail please", INTAKE_TENANT.services);
    expect(match.kind).toBe("ambiguous");
  });

  it("runs the correction path when the customer explicitly changes the service", async () => {
    const result = await resolve(
      BUTTON_STATE,
      "actually change the service to Full Detail Interior + Exterior",
      ai({
        corrections: [{ field: "service", value: "Full Detail Interior + Exterior" }],
      } as Partial<WebChatAiExtraction>),
    );
    expect(result.collected.service_id).toBe("s-both");
    expect(result.corrections.map((entry) => entry.field)).toContain("service");
  });

  it("never re-resolves a confirmed service from later narrative text", async () => {
    const result = await resolve(
      BUTTON_STATE,
      "its a toyota motorhome, interior and exterior detail bits are filthy",
      ai({ vehicle: "Toyota motorhome" }),
    );
    expect(result.collected.service_id).toBe("s-int");
    expect(result.extraction.ambiguities.some((entry) => entry.field === "service")).toBe(false);
  });

  it("preserves extracted fields while a service clarification is still pending", async () => {
    const result = await resolve(
      {},
      "interior and exterior detail for my toyota motorhome in auburn, number 0466907824",
      ai({
        vehicle: "Toyota motorhome",
        suburb: "Auburn",
        mobile: "0466907824",
        ambiguous_fields: ["service"],
      } as Partial<WebChatAiExtraction>),
      "service",
    );
    expect(result.collected.service_id ?? null).toBeNull();
    expect(result.collected.vehicle_type).toBe("Toyota motorhome");
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.mobile_number).toBe("+61466907824");
  });

  it("makes exactly one extraction call and no side effects", async () => {
    const result = await resolve(BUTTON_STATE, MESSAGE, ai({ vehicle: "Toyota motorhome" }));
    expect(result.calls).toBe(1);
    expect(result.aiUsed).toBe(true);
  });
});
