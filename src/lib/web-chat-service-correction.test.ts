// A corrected service must land on the tenant's approved service, and a later
// answer to a different question must never re-decide it.
import { describe, expect, it } from "vitest";
import { applyAnswer, type WebChatCollected, type WebChatTenant } from "@/lib/web-chat";
import { applyIntake, extractIntake } from "@/lib/web-chat-intake";

const TENANT: WebChatTenant = {
  businessId: "b1",
  name: "Glocast",
  serviceArea: "Sydney metro",
  flexibleRequestsEnabled: true,
  services: [
    { id: "s-pet", name: "Pet Hair & Odour Treatment", priceGuidance: null, durationMinutes: 60 },
    { id: "s-int", name: "Full Interior Detail", priceGuidance: null, durationMinutes: 120 },
    { id: "s-both", name: "Full Detail Interior + Exterior", priceGuidance: null, durationMinutes: 180 },
  ],
} as unknown as WebChatTenant;

describe("service corrections", () => {
  it("names the approved service instead of becoming an owner-review request", () => {
    const result = applyAnswer({} as WebChatCollected, "service", "Full Interior Detail", TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.collected.service_id).toBe("s-int");
      expect(result.collected.typed_request ?? null).toBeNull();
    }
  });

  it("asks which one when the words fit two approved services", () => {
    const twins = {
      ...TENANT,
      services: [
        { id: "a", name: "Full Detail", priceGuidance: null, durationMinutes: 60 },
        { id: "b", name: "Full Detail ", priceGuidance: null, durationMinutes: 90 },
      ],
    } as unknown as WebChatTenant;
    const result = applyAnswer({} as WebChatCollected, "service", "Full Detail", twins);
    expect(result.ok).toBe(false);
  });

  it("keeps a genuinely unlisted request as a free-text request", () => {
    const result = applyAnswer({} as WebChatCollected, "service", "engine bay steam clean", TENANT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.collected.service_id ?? null).toBeNull();
  });

  it("never re-decides a stated service from a later condition answer", () => {
    const collected: WebChatCollected = { typed_request: "engine bay steam clean" } as WebChatCollected;
    const extraction = extractIntake(
      "pet hair in the back seats",
      { ...TENANT, serviceArea: null } as never,
      new Date(),
    );
    const merged = applyIntake(collected, extraction, TENANT);
    expect(merged.collected.service_id ?? null).toBeNull();
    expect(merged.collected.typed_request).toBe("engine bay steam clean");
  });
});
