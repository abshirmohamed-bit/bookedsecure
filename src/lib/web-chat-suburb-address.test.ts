// Suburb and street address are asked in one question, and an extra the tenant
// does not list can be typed in. Both are checked here against a tenant whose
// own services and add-ons are the only ones that can ever be selected.

import { describe, expect, it } from "vitest";
import { applyAnswer, nextStep, splitSuburbAddress, type WebChatTenant } from "@/lib/web-chat";

const tenant: WebChatTenant = {
  name: "Coastal Shine Detailing",
  flexibleRequestsEnabled: true,
  quoteSubjectLabel: "Vehicle",
  services: [
    {
      id: "s1",
      name: "Full Interior Detail",
      description: null,
      included_items: null,
      excluded_items: null,
      qualification_note: null,
      price_guidance: "$230",
    },
  ],
  addons: [
    { id: "a1", name: "Pet Hair Treatment", price_guidance: "$40", serviceIds: ["s1"], active: true },
  ],
};

describe("suburb and address in one answer", () => {
  it("reads both when the customer gives both", () => {
    expect(splitSuburbAddress("88 cumberland rd, auburn")).toEqual({
      suburb: "auburn",
      address: "88 cumberland rd",
    });
    expect(splitSuburbAddress("auburn 88 cumberland rd")).toEqual({
      suburb: "auburn",
      address: "88 cumberland rd",
    });
    const applied = applyAnswer({}, "suburb", "88 cumberland rd, auburn", tenant);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.collected.suburb).toBe("auburn");
    expect(applied.collected.service_address).toBe("88 cumberland rd");
  });

  it("still asks for the address when only the suburb is given", () => {
    const applied = applyAnswer({}, "suburb", "Auburn", tenant);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.collected.service_address ?? null).toBeNull();
    expect(
      nextStep({ ...applied.collected, service_id: "s1", addons_done: true, vehicle_type: "Camry" }),
    ).toBe("address");
  });

  it("never stores a phone number as an address", () => {
    expect(applyAnswer({}, "suburb", "auburn, my number is 0466907824", tenant).ok).toBe(false);
  });
});

describe("extras the tenant does not list", () => {
  it("offers extras straight after the service is chosen", () => {
    const chosen = applyAnswer({}, "service", "s1", tenant);
    expect(chosen.ok).toBe(true);
    if (!chosen.ok) return;
    expect(nextStep(chosen.collected)).toBe("addons");
  });

  it("keeps a typed extra verbatim as a request and moves on", () => {
    const applied = applyAnswer({ service_id: "s1", addons_offered: true }, "addons", "headlight restoration", tenant);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.collected.addon_requests).toEqual(["headlight restoration"]);
    expect(applied.collected.addon_ids ?? []).toEqual([]);
    expect(applied.collected.addons_done).toBe(true);
  });
});
