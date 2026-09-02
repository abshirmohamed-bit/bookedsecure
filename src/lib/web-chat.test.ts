import { describe, expect, it } from "vitest";
import {
  FLEXIBLE_CHOICE,
  applyAnswer,
  completionMessage,
  nextStep,
  promptFor,
  resolveOutcome,
  serviceDetail,
  welcomeMessage,
  type WebChatCollected,
  type WebChatTenant,
} from "@/lib/web-chat";

const tenant: WebChatTenant = {
  name: "Glocast Detailing",
  flexibleRequestsEnabled: true,
  services: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      name: "Full Interior Detail",
      description: "Deep interior clean",
      included_items: "Vacuum, shampoo",
      excluded_items: "Paint correction",
      qualification_note: "Heavy pet hair may need longer",
    },
  ],
};

function complete(): WebChatCollected {
  return {
    service_id: tenant.services[0]!.id,
    service_name: tenant.services[0]!.name,
    vehicle_type: "SUV",
    suburb: "Marrickville",
    concerns: "Pet hair",
    name: "Sam",
    mobile_number: "+61447852565",
    email: null,
  };
}

describe("web chat prompts", () => {
  it("only ever offers the tenant's own services", () => {
    const prompt = promptFor("service", tenant);
    const labels = (prompt.options ?? []).map((option) => option.label);
    expect(labels).toContain("Full Interior Detail");
    expect(labels).toContain("Something else or not sure");
    expect(labels).toHaveLength(2);
  });

  it("omits the flexible option when the tenant disabled it", () => {
    const prompt = promptFor("service", { ...tenant, flexibleRequestsEnabled: false });
    expect((prompt.options ?? []).map((option) => option.value)).not.toContain(FLEXIBLE_CHOICE);
  });

  it("never states a price", () => {
    const surface = [
      welcomeMessage(tenant),
      serviceDetail(tenant.services[0]!) ?? "",
      completionMessage(tenant, { requiresOwnerReview: false, unsupportedRequest: null }),
      completionMessage(tenant, { requiresOwnerReview: true, unsupportedRequest: "ceramic" }),
      ...(promptFor("service", tenant).options ?? []).map((option) => `${option.label} ${option.detail ?? ""}`),
    ].join(" ");
    expect(surface).not.toMatch(/\$|\bprice\b|\bcost\b|\bquote of\b/i);
  });
});

describe("web chat step machine", () => {
  it("walks every step in order and finishes", () => {
    let collected: WebChatCollected = {};
    const answers: [string, string][] = [
      ["service", tenant.services[0]!.id],
      ["vehicle", "SUV"],
      ["suburb", "Marrickville"],
      ["concerns", "Pet hair"],
      ["name", "Sam"],
      ["mobile", "0447 852 565"],
      ["email", "skip"],
      ["consent", "granted"],
    ];
    for (const [expectedStep, answer] of answers) {
      expect(nextStep(collected)).toBe(expectedStep);
      const result = applyAnswer(collected, expectedStep as never, answer, tenant);
      expect(result.ok).toBe(true);
      if (result.ok) collected = result.collected;
    }
    expect(nextStep(collected)).toBeNull();
    expect(collected.mobile_number).toBe("+61447852565");
    expect(collected.email).toBeNull();
  });

  it("rejects a non-Australian mobile without advancing", () => {
    const collected = { ...complete(), mobile_number: null };
    const result = applyAnswer(collected, "mobile", "+1 415 555 0100", tenant);
    expect(result.ok).toBe(false);
  });

  it("stops at consent and records a decline", () => {
    const result = applyAnswer(complete(), "consent", "declined", tenant);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.collected.consent).toBe("declined");
      expect(nextStep(result.collected)).toBeNull();
    }
  });

  it("routes an unmatched request to owner review and keeps the text verbatim", () => {
    const applied = applyAnswer({}, "service", "ceramic coating on a boat", tenant);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const outcome = resolveOutcome(applied.collected);
    expect(outcome.requiresOwnerReview).toBe(true);
    expect(outcome.unsupportedRequest).toBe("ceramic coating on a boat");
    expect(applied.collected.service_id).toBeNull();
  });

  it("refuses free text when flexible requests are disabled", () => {
    const strict = { ...tenant, flexibleRequestsEnabled: false };
    expect(applyAnswer({}, "service", "something custom", strict).ok).toBe(false);
    expect(applyAnswer({}, "service", FLEXIBLE_CHOICE, strict).ok).toBe(false);
  });

  it("treats a matched service as not needing review", () => {
    expect(resolveOutcome(complete())).toEqual({ requiresOwnerReview: false, unsupportedRequest: null });
  });
});
