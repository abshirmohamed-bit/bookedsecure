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
 * The `it.fails` blocks below are deliberate tripwires: they pass today because
 * the invariant is VIOLATED, and they start failing the moment containment
 * lands. When that happens, convert each one from `it.fails` to `it` — that is
 * the signal the defect is fixed, not a broken test.
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

  it.fails("suburb Auburn is extracted from the lowercase message", () => {
    expect(extractIntake(AUBURN, intakeTenant, now).location).toBe("auburn");
  });

  it.fails("the vehicle condition is extracted from the message", () => {
    expect(extractIntake(AUBURN, intakeTenant, now).notes).toBeTruthy();
  });

  it.fails("neither suburb nor condition is asked for again", () => {
    const extraction = extractIntake(AUBURN, intakeTenant, now);
    const { collected } = applyIntake({ service_id: "s2", service_name: "Full Interior Detail" }, extraction, chatTenant);
    const outstanding = outstandingFields(collected);
    expect(outstanding).not.toContain("location");
    expect(outstanding).not.toContain("concerns");
  });

  it("extracts the name without swallowing the following clause", () => {
    // Currently returns "abshir and my".
    expect(extractIntake(AUBURN, intakeTenant, now).name?.toLowerCase()).not.toContain(" and my");
  });
});

// ---------------------------------------------------------------------------
// Failure mode 2: the raw sentence lands in a canonical field
// ---------------------------------------------------------------------------

describe("failure mode 2 — raw-message contamination of canonical fields", () => {
  const contaminable: { step: "suburb" | "concerns" | "vehicle" | "name"; read: (state: WebChatCollected) => string | null | undefined }[] = [
    { step: "suburb", read: (state) => state.suburb },
    { step: "concerns", read: (state) => state.concerns },
    { step: "vehicle", read: (state) => state.vehicle_type },
    { step: "name", read: (state) => state.name },
  ];

  for (const field of contaminable) {
    it(`documents that the ${field.step} step currently stores the raw sentence`, () => {
      const result = applyAnswer({}, field.step, AUBURN, chatTenant);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(looksLikeRawSentence(field.read(result.collected))).toBe(true);
    });

    it.fails(`the ${field.step} field never receives a raw multi-clause sentence`, () => {
      for (const message of MULTI_CLAUSE) {
        const result = applyAnswer({}, field.step, message, chatTenant);
        if (!result.ok) continue;
        expect(looksLikeRawSentence(field.read(result.collected))).toBe(false);
      }
    });
  }

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
    expect(result.ok && result.collected.consent).toBe("declined");
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
    const extraction = extractIntake("my name is Abshir and my number is 0466907824", intakeTenant, now);
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
    expect(outstandingFields(collected)).toEqual(["concerns", "mobile"]);
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
    };
    expect(outstandingFields(collected)).toEqual([]);
  });
});
