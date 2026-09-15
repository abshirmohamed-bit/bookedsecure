import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  nextStep,
  promptFor,
  reviewSummary,
  type WebChatCollected,
  type WebChatTenant,
} from "@/lib/web-chat";
import { CORRECTABLE_STEPS, detectCorrection, parseChangeDirective } from "@/lib/web-chat-correction";

const tenant: WebChatTenant = {
  name: "Glocast Detailing",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  services: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Full Interior Detail",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
    {
      id: "22222222-2222-2222-2222-222222222222",
      name: "Exterior Detail",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
  ],
};

function collectedAll(): WebChatCollected {
  return {
    service_id: tenant.services[0]!.id,
    service_name: tenant.services[0]!.name,
    vehicle_type: "Mazda 3",
    suburb: "Marrickville",
    service_address: "12 Smith St",
    concerns: "Swirls",
    name: "Abshiro",
    mobile_number: "+61447852565",
    email: "a@example.com",
  };
}

describe("field-by-field review navigation", () => {
  it("exposes every correctable field on the review prompt", () => {
    const prompt = promptFor("review", tenant, collectedAll());
    expect(prompt.kind).toBe("review");
    // Extras only appear when the tenant offers add-ons for the chosen service.
    expect(prompt.fields?.map((field) => field.step)).toEqual(
      CORRECTABLE_STEPS.filter((step) => step !== "addons"),
    );
  });

  it("shows the current value for each field", () => {
    const rows = reviewSummary(collectedAll());
    expect(rows.find((r) => r.step === "suburb")?.value).toBe("Marrickville");
    expect(rows.find((r) => r.step === "mobile")?.value).toBe("+61447852565");
  });

  it("parses a change directive for every field and rejects anything else", () => {
    for (const step of CORRECTABLE_STEPS) expect(parseChangeDirective(`change:${step}`)).toBe(step);
    expect(parseChangeDirective("change:consent")).toBeNull();
    expect(parseChangeDirective("change my suburb")).toBeNull();
  });

  it("a change directive reasks exactly that field and never clarifies", () => {
    for (const step of CORRECTABLE_STEPS.filter((step) => step !== "addons")) {
      const result = detectCorrection(collectedAll(), "review", `change:${step}`, tenant);
      expect(result.kind).toBe("reask");
      if (result.kind !== "reask") return;
      expect(result.field).toBe(step);
      // The cleared field becomes the next question — no ambiguous loop.
      expect(nextStep(result.collected)).toBe(step);
    }
  });

  it("re-opens the extras step when the customer changes their extras", () => {
    const addon = { id: "33333333-3333-3333-3333-333333333333", name: "Mould Removal", description: null, price_guidance: null, duration_minutes: null, serviceIds: [tenant.services[0]!.id] };
    const withAddons: WebChatTenant = { ...tenant, addons: [addon] };
    const collected: WebChatCollected = {
      ...collectedAll(),
      addon_ids: [addon.id],
      addon_names: [addon.name],
      addons_offered: true,
      addons_done: true,
    };
    const result = detectCorrection(collected, "review", "change:addons", withAddons);
    expect(result.kind).toBe("reask");
    if (result.kind !== "reask") return;
    expect(nextStep(result.collected)).toBe("addons");
    expect(result.collected.addon_names).toEqual([]);
  });

  it("returns to review after the replacement answer is given", () => {
    const changed = detectCorrection(collectedAll(), "review", "change:suburb", tenant);
    if (changed.kind !== "reask") throw new Error("expected reask");
    const applied = applyAnswer(changed.collected, "suburb", "Parramatta", tenant);
    if (!applied.ok) throw new Error("expected ok");
    expect(applied.collected.suburb).toBe("Parramatta");
    expect(nextStep(applied.collected)).toBe("review");
  });

  it("a change after review confirmation re-opens review before consent", () => {
    const confirmed = applyAnswer(collectedAll(), "review", "yes", tenant);
    if (!confirmed.ok) throw new Error("expected ok");
    expect(nextStep(confirmed.collected)).toBe("consent");
    const changed = detectCorrection(confirmed.collected, "consent", "change:name", tenant);
    if (changed.kind !== "reask") throw new Error("expected reask");
    expect(changed.collected.reviewed).toBe(false);
    const named = applyAnswer(changed.collected, "name", "Sam", tenant);
    if (!named.ok) throw new Error("expected ok");
    expect(nextStep(named.collected)).toBe("review");
  });
});

describe("last-valid-value precedence", () => {
  it("keeps the newest valid value after repeated corrections of one field", () => {
    let collected = collectedAll();
    for (const [text, expected] of [
      ["actually change my mobile to 0470 111 333", "+61470111333"],
      ["sorry my number should be 0470 111 222", "+61470111222"],
    ] as const) {
      const result = detectCorrection(collected, "review", text, tenant);
      if (result.kind !== "applied") throw new Error(`expected applied for ${text}`);
      collected = result.collected;
      expect(collected.mobile_number).toBe(expected);
    }
  });

  it("uses the corrected service, not the original", () => {
    const result = detectCorrection(collectedAll(), "review", "actually change my service", tenant);
    if (result.kind !== "reask") throw new Error("expected reask");
    const applied = applyAnswer(result.collected, "service", tenant.services[1]!.id, tenant);
    if (!applied.ok) throw new Error("expected ok");
    expect(applied.collected.service_id).toBe(tenant.services[1]!.id);
    expect(applied.collected.service_name).toBe("Exterior Detail");
  });
});

describe("invalid replacement preservation", () => {
  it("an invalid mobile replacement does not overwrite the previous valid value", () => {
    const before = collectedAll();
    const result = detectCorrection(before, "review", "my mobile is 12345", tenant);
    expect(result.kind).toBe("invalid");
    expect(before.mobile_number).toBe("+61447852565");
  });

  it("an invalid email replacement does not overwrite the previous valid value", () => {
    const before = collectedAll();
    const result = detectCorrection(before, "review", "actually my email is bob@@example", tenant);
    expect(result.kind).toBe("invalid");
    expect(before.email).toBe("a@example.com");
  });

  it("a valid replacement after an invalid one is accepted", () => {
    const invalid = detectCorrection(collectedAll(), "review", "my mobile is 12345", tenant);
    expect(invalid.kind).toBe("invalid");
    const valid = detectCorrection(collectedAll(), "review", "my mobile is 0470 111 222", tenant);
    if (valid.kind !== "applied") throw new Error("expected applied");
    expect(valid.collected.mobile_number).toBe("+61470111222");
  });
});

describe("idempotent final submission", () => {
  it("consent is terminal: nextStep returns null so no second capture is driven", () => {
    const confirmed = applyAnswer(collectedAll(), "review", "yes", tenant);
    if (!confirmed.ok) throw new Error("expected ok");
    const consented = applyAnswer(confirmed.collected, "consent", "granted", tenant);
    if (!consented.ok) throw new Error("expected ok");
    expect(nextStep(consented.collected)).toBeNull();
  });
});
