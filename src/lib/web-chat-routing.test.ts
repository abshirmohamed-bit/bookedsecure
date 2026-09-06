// Routing between the multi-field change-directive branch and the intake/AI
// branch of the public quote chat.
//
// Pure functions and an injected fake extractor only: no database, no model
// call, no SMS, no booking, no lead write, no provider call.
import { describe, expect, it, vi } from "vitest";
import { hasExplicitChangeIntent } from "@/lib/web-chat-correction";
import { applyFieldDirectives, outstandingFields, type IntakeTenant } from "@/lib/web-chat-intake";
import { resolveIntake, type WebChatAiExtraction } from "@/lib/web-chat-ai-extraction";
import type { WebChatCollected, WebChatTenant } from "@/lib/web-chat";

const services = [
  { id: "s1", name: "Ceramic Coating" },
  { id: "s2", name: "Full Interior Detail" },
];

const intakeTenant: IntakeTenant = {
  timezone: "Australia/Sydney",
  services,
  locations: ["Auburn", "Bankstown", "Parramatta"],
};

const chatTenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  services: services.map((service) => ({
    id: service.id,
    name: service.name,
    description: null,
    included_items: null,
    excluded_items: null,
    qualification_note: null,
  })),
};

const AUBURN =
  "auburn, and its in bad condition the carpet, i accidentally left the window open, and it needs a really clean up please, my name is abshir and my number is 0466907824";

const now = new Date("2026-09-09T00:00:00.000Z");

function ai(overrides: Partial<WebChatAiExtraction> = {}): WebChatAiExtraction {
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
    question_topic: null,
    uncertain: false,
    unsupported: false,
    reply: null,
    ...overrides,
  };
}

/**
 * Mirrors the ordering in `replyToWebChat`: the directive branch runs first ONLY
 * when the message carries explicit change intent; otherwise intake runs first.
 */
async function route(
  raw: string,
  collected: WebChatCollected,
  extraction: WebChatAiExtraction | null,
  step = "suburb",
) {
  const extract = vi.fn(async () => extraction);
  const explicitChange = hasExplicitChangeIntent(raw);
  const directive = applyFieldDirectives(raw.trim(), collected, chatTenant);
  const directiveClaims = explicitChange && directive.updates.length >= 2;
  if (directiveClaims) {
    return {
      branch: "directive" as const,
      collected: directive.collected,
      calls: extract.mock.calls.length,
      extract,
    };
  }
  const resolved = await resolveIntake({
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
  return {
    branch: "intake" as const,
    collected: resolved.collected,
    corrections: resolved.corrections,
    calls: resolved.calls,
    extract,
  };
}

describe("explicit change intent", () => {
  it("recognises real change requests", () => {
    for (const raw of [
      "change my suburb to Parramatta",
      "update my vehicle to a Mazda",
      "actually, make the suburb Bankstown",
      "correct my name to Abshir",
      "replace the number with 0466907824",
      "no, use Parramatta instead",
    ]) {
      expect(hasExplicitChangeIntent(raw)).toBe(true);
    }
  });

  it("does not treat a stated field as a change request", () => {
    for (const raw of [
      "my name is Abshir and my number is 0466907824",
      AUBURN,
      "im in Bankstown, its a Mazda 3",
      "Auburn",
    ]) {
      expect(hasExplicitChangeIntent(raw)).toBe(false);
    }
  });
});

describe("the Auburn first-turn narrative", () => {
  it("would have been claimed and stripped by the directive parser", () => {
    // The defect the routing fix contains: two field phrases, everything else lost.
    const directive = applyFieldDirectives(AUBURN, {}, chatTenant);
    expect(directive.updates.length).toBeGreaterThanOrEqual(2);
    expect(directive.collected.suburb ?? null).toBeNull();
  });

  it("now reaches intake/AI and keeps every stated field", async () => {
    const result = await route(
      AUBURN,
      {},
      ai({
        suburb: "Auburn",
        condition: "bad condition",
        concerns: "the carpet, and i accidentally left the window open",
        name: "Abshir",
        mobile: "0466907824",
        still_missing: ["service", "vehicle"],
      }),
    );
    expect(result.branch).toBe("intake");
    expect(result.calls).toBe(1);
    expect(result.collected.suburb).toBe("Auburn");
    expect(result.collected.concerns).toContain("carpet");
    expect(result.collected.concerns).toContain("window");
    expect(result.collected.concerns).toContain("bad condition");
    expect(result.collected.name).toBe("Abshir");
    expect(result.collected.mobile_number).toBe("+61466907824");
    expect(result.collected.service_id ?? null).toBeNull();
    expect(result.collected.vehicle_type ?? null).toBeNull();
    expect(outstandingFields(result.collected)).toEqual(["service", "vehicle"]);
    for (const value of [result.collected.suburb, result.collected.name, result.collected.vehicle_type]) {
      expect((value ?? "").length).toBeLessThan(40);
      expect(value ?? "").not.toContain("my number is");
    }
  });
});

describe("explicit directives still work", () => {
  it("routes an explicit suburb change through the directive branch", async () => {
    const result = await route(
      "change my suburb to Parramatta and my vehicle to a Mazda 3",
      { suburb: "Auburn", vehicle_type: "Corolla", name: "Abshir" },
      null,
      "name",
    );
    expect(result.branch).toBe("directive");
    expect(result.calls).toBe(0);
    expect(result.collected.suburb).toBe("Parramatta");
    expect(result.collected.name).toBe("Abshir");
  });

  it("an explicit correction preserves unrelated fields", async () => {
    const result = await route(
      "actually make the suburb Bankstown",
      { suburb: "Auburn", vehicle_type: "Mazda 3", name: "Abshir", mobile_number: "+61466907824" },
      ai({ corrections: [{ field: "suburb", value: "Bankstown" }] }),
      "name",
    );
    expect(result.collected.suburb).toBe("Bankstown");
    expect(result.collected.vehicle_type).toBe("Mazda 3");
    expect(result.collected.name).toBe("Abshir");
    expect(result.collected.mobile_number).toBe("+61466907824");
  });

  it("new information plus an explicit correction both land where valid", async () => {
    const result = await route(
      "im in Parramatta now instead of Auburn, and its a Mazda 3",
      { suburb: "Auburn", name: "Abshir" },
      ai({ vehicle: "Mazda 3", corrections: [{ field: "suburb", value: "Parramatta" }] }),
      "vehicle",
    );
    expect(result.collected.suburb).toBe("Parramatta");
    expect(result.collected.vehicle_type).toBe("Mazda 3");
    expect(result.collected.name).toBe("Abshir");
  });
});

describe("AI call budget", () => {
  it("a one-word answer is interpreted too, with a single AI call", async () => {
    const result = await route("Auburn", {}, ai({ suburb: "Auburn" }));
    expect(result.calls).toBe(1);
  });

  it("one eligible message makes exactly one AI call", async () => {
    const result = await route(AUBURN, {}, ai({ suburb: "Auburn" }));
    expect(result.calls).toBe(1);
    expect(result.extract).toHaveBeenCalledTimes(1);
  });
});
