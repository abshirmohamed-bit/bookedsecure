import { describe, expect, it } from "vitest";
import {
  applyIntake,
  extractIntake,
  groupedMissingMessage,
  matchApprovedLocation,
  matchApprovedService,
  outstandingFields,
  parseApprovedLocations,
  resolvePreferredDate,
  resolvePreferredTime,
  type IntakeTenant,
} from "@/lib/web-chat-intake";
import type { WebChatTenant } from "@/lib/web-chat";

const services = [
  { id: "s1", name: "Ceramic Coating" },
  { id: "s2", name: "Full Interior Detail" },
  { id: "s3", name: "Exterior Detail" },
];

const tenant: IntakeTenant = {
  timezone: "Australia/Sydney",
  services,
  locations: ["Punchbowl", "Bankstown", "Parramatta"],
};

const chatTenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  services: services.map((service) => ({ id: service.id, name: service.name })),
} as WebChatTenant;

// Wednesday 2026-09-09 10:00 Sydney
const now = new Date("2026-09-09T00:00:00.000Z");

describe("approved-service matching", () => {
  it("matches an approved service from natural wording", () => {
    expect(matchApprovedService("can I get ceramic coating please", services)).toEqual({
      kind: "one",
      service: services[0],
    });
  });

  it("matches on a stemmed form", () => {
    expect(matchApprovedService("i want a ceramic coat", services)).toEqual({
      kind: "one",
      service: services[0],
    });
  });

  it("never substitutes a service when nothing approved matches", () => {
    expect(matchApprovedService("I need my engine rebuilt", services).kind).toBe("none");
  });

  it("reports ambiguity instead of guessing between two approved services", () => {
    const result = matchApprovedService("interior and exterior detail", services);
    expect(result.kind).toBe("ambiguous");
  });
});

describe("approved-location matching", () => {
  it("parses approved locations from tenant configuration", () => {
    expect(parseApprovedLocations("Punchbowl, Bankstown / Parramatta")).toEqual([
      "Punchbowl",
      "Bankstown",
      "Parramatta",
    ]);
  });

  it("matches one approved location", () => {
    expect(matchApprovedLocation("I'm near Punchbowl station", tenant.locations)).toEqual({
      kind: "one",
      location: "Punchbowl",
    });
  });

  it("asks when two approved locations are named", () => {
    expect(matchApprovedLocation("Punchbowl or Bankstown", tenant.locations).kind).toBe("ambiguous");
  });

  it("does not invent a location", () => {
    expect(matchApprovedLocation("Perth CBD", tenant.locations).kind).toBe("none");
  });
});

describe("date and time in tenant timezone", () => {
  it("resolves tomorrow", () => {
    expect(resolvePreferredDate("tomorrow please", now, tenant.timezone)).toEqual({
      kind: "one",
      date: "2026-09-10",
    });
  });

  it("resolves the next named weekday", () => {
    expect(resolvePreferredDate("next Tuesday", now, tenant.timezone)).toEqual({
      kind: "one",
      date: "2026-09-15",
    });
  });

  it("asks when two days are named", () => {
    expect(resolvePreferredDate("Monday or Friday", now, tenant.timezone).kind).toBe("ambiguous");
  });

  it("resolves a stated time", () => {
    expect(resolvePreferredTime("around 2:30pm")).toEqual({ kind: "one", time: "14:30" });
  });

  it("keeps a part-of-day preference", () => {
    expect(resolvePreferredTime("some time in the morning")).toEqual({ kind: "one", time: "morning" });
  });

  it("never invents a time", () => {
    expect(resolvePreferredTime("whenever suits you").kind).toBe("none");
  });
});

describe("multi-field extraction", () => {
  it("reads service, vehicle, location and day from one sentence", () => {
    const result = extractIntake(
      "Hi, I'd like ceramic coating for my Mazda CX5 in Punchbowl next Tuesday morning",
      tenant,
      now,
    );
    expect(result.intent).toBe("booking");
    expect(result.service?.id).toBe("s1");
    expect(result.vehicle).toContain("Mazda");
    expect(result.location).toBe("Punchbowl");
    expect(result.preferredDate).toBe("2026-09-15");
    expect(result.preferredTime).toBe("morning");
  });

  it("reads name, mobile and email when supplied", () => {
    const result = extractIntake(
      "My name is Abshir, mobile 0466 907 824, email abshir@example.com",
      tenant,
      now,
    );
    expect(result.name).toBe("Abshir");
    expect(result.mobile).toBe("+61466907824");
    expect(result.email).toBe("abshir@example.com");
  });

  it("flags an unsupported request rather than pretending to help", () => {
    expect(extractIntake("I want to apply for a job", tenant, now).intent).toBe("unsupported");
  });

  it("marks ambiguity as the intent when approved options tie", () => {
    expect(extractIntake("interior and exterior detail", tenant, now).intent).toBe("ambiguous");
  });
});

describe("grouped collection", () => {
  it("applies everything extracted before asking anything", () => {
    const extraction = extractIntake(
      "ceramic coating for my Mazda CX5 in Punchbowl, there is some existing swirl marks",
      tenant,
      now,
    );
    const { collected, applied } = applyIntake({}, extraction, chatTenant);
    expect(applied).toContain("service");
    expect(applied).toContain("vehicle");
    expect(applied).toContain("location");
    expect(collected.service_id).toBe("s1");
    expect(collected.suburb).toBe("Punchbowl");
    expect(outstandingFields(collected)).toEqual(["name", "mobile"]);
  });

  it("asks the remaining fields together, not one at a time", () => {
    const message = groupedMissingMessage(["name", "mobile"]);
    expect(message).toContain("name");
    expect(message).toContain("mobile");
    expect(message?.split("\n").length).toBe(3);
  });

  it("never re-asks a field already supplied", () => {
    const extraction = extractIntake("my name is Abshir on 0466 907 824", tenant, now);
    const { collected } = applyIntake({ suburb: "Punchbowl" }, extraction, chatTenant);
    expect(outstandingFields(collected)).not.toContain("name");
    expect(outstandingFields(collected)).not.toContain("mobile");
    expect(outstandingFields(collected)).not.toContain("location");
  });

  it("does not overwrite a value the customer already gave", () => {
    const extraction = extractIntake("ceramic coating in Bankstown", tenant, now);
    const { collected } = applyIntake({ suburb: "Punchbowl" }, extraction, chatTenant);
    expect(collected.suburb).toBe("Punchbowl");
  });
});
