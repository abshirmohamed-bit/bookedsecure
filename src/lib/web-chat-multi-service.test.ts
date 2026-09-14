import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  chosenServicesText,
  encodeServiceSelection,
  nextStep,
  promptFor,
  type WebChatTenant,
} from "@/lib/web-chat";

const INTERIOR = "11111111-1111-1111-1111-111111111111";
const EXTERIOR = "22222222-2222-2222-2222-222222222222";
const WAX = "33333333-3333-3333-3333-333333333333";

const tenant: WebChatTenant = {
  name: "Any Detailing Co",
  flexibleRequestsEnabled: true,
  services: [
    {
      id: INTERIOR,
      name: "Full Interior Detail",
      category: "Interior",
      duration_minutes: 90,
      description: "Deep interior clean",
      included_items: "Vacuum",
      excluded_items: null,
      qualification_note: null,
    },
    {
      id: EXTERIOR,
      name: "Exterior Wash",
      category: "Exterior",
      duration_minutes: 45,
      description: "Hand wash",
      included_items: null,
      excluded_items: null,
      qualification_note: null,
    },
  ],
  addons: [
    {
      id: WAX,
      name: "Hand wax",
      price_guidance: "$60",
      duration_minutes: 30,
      serviceIds: [EXTERIOR],
    },
  ],
};

describe("multi-service card selection", () => {
  it("keeps more than one of the tenant's own services, with the extras they ticked", () => {
    const result = applyAnswer({}, "service", encodeServiceSelection([EXTERIOR, INTERIOR], [WAX]), tenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.service_id).toBe(EXTERIOR);
    expect(result.collected.extra_service_names).toEqual(["Full Interior Detail"]);
    expect(result.collected.addon_names).toEqual(["Hand wax"]);
    expect(chosenServicesText(result.collected)).toBe("Exterior Wash + Full Interior Detail");
    // Extras were answered on the cards, so the extras step does not run again.
    expect(nextStep(result.collected)).toBe("vehicle");
  });

  it("drops ids the tenant does not own", () => {
    const result = applyAnswer({}, "service", encodeServiceSelection([INTERIOR, "nope"], ["nope"]), tenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.extra_service_ids).toEqual([]);
    expect(result.collected.addon_ids).toEqual([]);
  });

  it("refuses a selection with no known service", () => {
    expect(applyAnswer({}, "service", encodeServiceSelection(["nope"], []), tenant).ok).toBe(false);
  });

  it("offers each service's own extras with price and length on the card", () => {
    const prompt = promptFor("service", tenant);
    const exterior = prompt.options?.find((option) => option.value === EXTERIOR);
    expect(exterior?.card?.extras).toEqual([
      { id: WAX, name: "Hand wax", price: "$60", duration: "30 min", image: null },
    ]);
    const interior = prompt.options?.find((option) => option.value === INTERIOR);
    expect(interior?.card?.extras).toEqual([]);
  });

  it("still accepts a single service id on its own", () => {
    const result = applyAnswer({}, "service", INTERIOR, tenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.service_name).toBe("Full Interior Detail");
    expect(result.collected.extra_service_ids).toEqual([]);
  });
});
