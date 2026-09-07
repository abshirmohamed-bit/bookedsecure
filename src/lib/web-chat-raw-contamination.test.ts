/**
 * Data-integrity regression suite for the two known intake failure modes.
 *
 * Pure functions only: no database, no network, no provider call, no lead
 * mutation, no SMS. Every assertion runs against `applyAnswer`, `extractIntake`,
 * `applyIntake`, `outstandingFields` and `nextStep` in isolation.
 *
 * INVARIANT UNDER AUDIT
 * A raw multi-clause customer message must never be written directly into a
 * single canonical booking or lead field. The raw text may be kept as
 * conversation context or an audit record; canonical fields may only receive
 * validated, field-specific values.
 *
 * Containment has landed: the former `it.fails` tripwires are now normal
 * assertions. Failure mode 2 (raw sentence written into a canonical field) is
 * fixed and asserted. Failure mode 1 (supplied details re-asked) is documented
 * as current behaviour and is the subject of the next, extraction phase.
 */

import { describe, expect, it } from "vitest";
import {
  applyAnswer,
  nextStep,
  type WebChatCollected,
  type WebChatTenant,
} from "@/lib/web-chat";
import {
  applyIntake,
  extractIntake,
  outstandingFields,
  parseApprovedLocations,
  type IntakeTenant,
} from "@/lib/web-chat-intake";

const services = [
  { id: "s1", name: "Ceramic Coating" },
  { id: "s2", name: "Full Interior Detail" },
  { id: "s3", name: "Exterior Detail" },
];

const intakeTenant: IntakeTenant = {
  timezone: "Australia/Sydney",
  services,
  locations: parseApprovedLocations("Punchbowl, Bankstown, Parramatta"),
};

const chatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  services: services.map((service) => ({ id: service.id, name: service.name })),
} as WebChatTenant;

const now = new Date("2026-09-06T00:00:00.000Z");

/** The reported customer message, verbatim. */
const AUBURN =
  "auburn, and its in bad condition the carpet, i accidentally left the window open, and it needs a really clean up please, my name is abshir and my number is 0466907824";

const MULTI_CLAUSE = [
  AUBURN,
  "hey there, the wagon is filthy inside and out, im at bankstown tomorrow arvo if that works, ring me on 0466 907 824",
  "interior detail please, seats are wet, im in parramatta, name is jo",
  "its a mazda 3, quite tired looking, punchbowl, no rush",
] as const;

/** A value is contaminated when it is really a whole sentence, not a field value. */
function looksLikeRawSentence(value: string | null | undefined): boolean {
  const text = (value ?? "").trim();
  if (text.length === 0) return false;
  const clauses = text.split(/[,;]/).filter((part) => part.trim().length > 0).length;
  return text.length > 60 || clauses >= 3 || /\b(my name is|my number is)\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Failure mode 1: fields the customer supplied are re-asked
// ---------------------------------------------------------------------------

describe("failure mode 1 — supplied details are re-asked", () => {
  it("documents that the Auburn message yields only name and mobile", () => {
    const extraction = extractIntake(AUBURN, intakeTenant, now);
    expect(extraction.location).toBeNull();
    expect(extraction.notes).toBeNull();
    expect(extraction.mobile).toBe("+61466907824");

    const { applied } = applyIntake({ service_id: "s2", service_name: "Full Interior Detail" }, extraction, chatTenant);
    expect(applied).toEqual(["name", "mobile"]);
  });

  // The four assertions below record the extraction gap that containment does
  // NOT fix: the suburb and condition are still not read out of a lowercase,
  // informally phrased message, so those fields are asked for again. They are
  // normal assertions of today's behaviour, to be inverted in the extraction
  // phase (structured multi-field extraction + post-merge missing fields).
  it("does not yet read suburb Auburn from the lowercase message", () => {
    expect(extractIntake(AUBURN, intakeTenant, now).location).toBeNull();
  });

  it("does not yet read the vehicle condition from the message", () => {
    expect(extractIntake(AUBURN, intakeTenant, now).notes).toBeNull();
  });

  it("still asks for suburb and condition again", () => {
    const extraction = extractIntake(AUBURN, intakeTenant, now);
    const { collected } = applyIntake({ service_id: "s2", service_name: "Full Interior Detail" }, extraction, chatTenant);
    const outstanding = outstandingFields(collected);
    expect(outstanding).toContain("location");
    expect(outstanding).toContain("concerns");
  });

  it("no longer swallows the clause after the name", () => {
    // Was: "abshir and my". The capture now stops at the first connective.
    expect(extractIntake(AUBURN, intakeTenant, now).name).toBe("Abshir");
  });
});

// ---------------------------------------------------------------------------
// Failure mode 2: the raw sentence lands in a canonical field — CONTAINED
// ---------------------------------------------------------------------------

describe("failure mode 2 — raw-message contamination of canonical fields", () => {
  const contaminable: { step: "suburb" | "concerns" | "vehicle" | "name"; read: (state: WebChatCollected) => string | null | undefined }[] = [
    { step: "suburb", read: (state) => state.suburb },
    { step: "concerns", read: (state) => state.concerns },
    { step: "vehicle", read: (state) => state.vehicle_type },
    { step: "name", read: (state) => state.name },
  ];

  for (const field of contaminable) {
    it(`the ${field.step} step rejects the Auburn message instead of storing it`, () => {
      const result = applyAnswer({}, field.step, AUBURN, chatTenant);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.length).toBeGreaterThan(0);
    });

    it(`the ${field.step} field never receives a raw multi-clause sentence`, () => {
      for (const message of MULTI_CLAUSE) {
        const result = applyAnswer({}, field.step, message, chatTenant);
        if (!result.ok) continue;
        expect(looksLikeRawSentence(field.read(result.collected))).toBe(false);
      }
    });

    it(`a rejected ${field.step} answer leaves existing state untouched`, () => {
      const start: WebChatCollected = {
        service_id: "s2",
        service_name: "Full Interior Detail",
        suburb: "Punchbowl",
        vehicle_type: "Mazda 3",
        concerns: "wet carpet",
        name: "Abshir",
        mobile_number: "+61466907824",
      };
      const snapshot = JSON.stringify(start);
      const result = applyAnswer(start, field.step, AUBURN, chatTenant);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(start)).toBe(snapshot);
    });
  }

  it("accepts a normal suburb, vehicle and name", () => {
    const suburb = applyAnswer({}, "suburb", "Auburn", chatTenant);
    expect(suburb.ok && suburb.collected.suburb).toBe("Auburn");
    const vehicle = applyAnswer({}, "vehicle", "2018 Mazda 3 hatchback", chatTenant);
    expect(vehicle.ok && vehicle.collected.vehicle_type).toBe("2018 Mazda 3 hatchback");
    const name = applyAnswer({}, "name", "Abshir", chatTenant);
    expect(name.ok && name.collected.name).toBe("Abshir");
    const stated = applyAnswer({}, "name", "my name is Abshir", chatTenant);
    expect(stated.ok).toBe(true);
  });

  it("accepts a legitimate long, descriptive concern", () => {
    const description =
      "The carpets are stained from spilled coffee and there is dog hair right through the back seats, the boot also smells musty after I left a window open in the rain";
    const result = applyAnswer({}, "concerns", description, chatTenant);
    expect(result.ok && result.collected.concerns).toBe(description);
  });

  it("rejects a concern description that absorbs a phone number or email", () => {
    expect(applyAnswer({}, "concerns", "seats are wet, call me on 0466 907 824", chatTenant).ok).toBe(false);
    expect(applyAnswer({}, "concerns", "seats are wet, email me at jo@example.com", chatTenant).ok).toBe(false);
    expect(applyAnswer({}, "suburb", "auburn, my number is 0466907824", chatTenant).ok).toBe(false);
    expect(applyAnswer({}, "vehicle", "mazda 3, my name is Jo", chatTenant).ok).toBe(false);
  });

  it("free-text service requests are recorded verbatim by design and routed to owner review", () => {
    // typed_request is an audit field, not a canonical service: service_id stays null.
    const result = applyAnswer({}, "service", AUBURN, chatTenant);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.collected.service_id).toBeNull();
    expect(result.collected.typed_request).toBe(AUBURN);
  });

  it("mobile and email fields are protected by their own validation", () => {
    const mobile = applyAnswer({}, "mobile", AUBURN, chatTenant);
    expect(mobile.ok && mobile.collected.mobile_number).toBe("+61466907824");
    expect(applyAnswer({}, "email", AUBURN, chatTenant).ok).toBe(false);
  });

  it("a free-text sentence at the consent step never grants consent", () => {
    const result = applyAnswer({}, "consent", AUBURN, chatTenant);
    // Consent is never inferred either way from an unclear reply.
    expect(result.ok).toBe(false);
    expect(result.ok && result.collected.consent).not.toBe("granted");
  });


  it("date and time preferences cannot be contaminated: they are never canonical fields", () => {
    const extraction = extractIntake(AUBURN, intakeTenant, now);
    expect(extraction.preferredDate).toBeNull();
    expect(extraction.preferredTime).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// Behaviour that must hold either way
// ---------------------------------------------------------------------------

describe("merge and missing-field guarantees", () => {
  it("preserves existing valid state and merges only new fields", () => {
    const start: WebChatCollected = {
      service_id: "s2",
      service_name: "Full Interior Detail",
      suburb: "Punchbowl",
      vehicle_type: "Mazda 3",
    };
    const extraction = extractIntake("my name is Abshir, 0466907824", intakeTenant, now);
    const { collected } = applyIntake(start, extraction, chatTenant);
    expect(collected.suburb).toBe("Punchbowl");
    expect(collected.vehicle_type).toBe("Mazda 3");
    expect(collected.service_id).toBe("s2");
    expect(collected.name).toBe("Abshir");
    expect(collected.mobile_number).toBe("+61466907824");
  });

  it("leaves an ambiguous value unresolved rather than guessing", () => {
    const extraction = extractIntake("Punchbowl or Bankstown", intakeTenant, now);
    expect(extraction.location).toBeNull();
    expect(extraction.ambiguities[0]?.field).toBe("location");
    const { collected } = applyIntake({}, extraction, chatTenant);
    expect(collected.suburb ?? null).toBeNull();
  });

  it("recalculates missing fields after the merge and asks only for those", () => {
    const extraction = extractIntake(
      "Ceramic Coating for my Mazda 3 in Punchbowl, my name is Abshir",
      intakeTenant,
      now,
    );
    const { collected } = applyIntake({}, extraction, chatTenant);
    expect(outstandingFields(collected)).toEqual(["address", "concerns", "mobile"]);
    expect(nextStep(collected)).toBe("concerns");
  });

  it("never re-asks a field that already holds a valid value", () => {
    const collected: WebChatCollected = {
      service_id: "s1",
      service_name: "Ceramic Coating",
      vehicle_type: "Mazda 3",
      suburb: "Punchbowl",
      concerns: "wet carpet",
      name: "Abshir",
      mobile_number: "+61466907824",
      service_address: "12 Smith St",
    };
    expect(outstandingFields(collected)).toEqual([]);
  });
});
