import { describe, expect, it } from "vitest";
import { mergeReturningLead } from "@/lib/returning-lead";

describe("returning lead continuity", () => {
  it("fills the empty profile of a dormant imported contact", () => {
    const patch = mergeReturningLead(
      { name: "diana", email: "d@example.com", suburb: null, vehicle_type: null },
      {
        name: "Diana",
        suburb: "Auburn",
        vehicle_type: "Toyota Corolla",
        service_intent: "Full Interior Detail",
        request_type: "service",
        source_channel: "website",
        lead_origin: "ai_web_chat",
      },
    );
    expect(patch["suburb"]).toBe("Auburn");
    expect(patch["vehicle_type"]).toBe("Toyota Corolla");
    expect(patch["service_intent"]).toBe("Full Interior Detail");
    expect(patch["status"]).toBe("new");
  });

  it("never overwrites details already on the record", () => {
    const patch = mergeReturningLead(
      { name: "Diana", email: "old@example.com", suburb: "Auburn" },
      { name: "D", email: "new@example.com", suburb: "Newtown" },
    );
    expect(patch).not.toHaveProperty("name");
    expect(patch).not.toHaveProperty("email");
    expect(patch).not.toHaveProperty("suburb");
  });

  it("never blanks a field the new enquiry did not mention", () => {
    const patch = mergeReturningLead(
      { suburb: null, vehicle_type: "Ute" },
      { suburb: "", vehicle_type: null, service_intent: "Wash" },
    );
    expect(patch).not.toHaveProperty("suburb");
    expect(patch).not.toHaveProperty("vehicle_type");
  });

  it("ignores placeholder names", () => {
    const patch = mergeReturningLead({ name: null }, { name: "Web visitor" });
    expect(patch).not.toHaveProperty("name");
  });

  it("refreshes the current request for a new enquiry", () => {
    const patch = mergeReturningLead(
      { service_intent: "Old wash", request_type: "service", service_name_snapshot: "Old wash" },
      { service_intent: "Ceramic Coating", request_type: "service", service_name_snapshot: "Ceramic Coating" },
    );
    expect(patch["service_intent"]).toBe("Ceramic Coating");
    expect(patch["service_name_snapshot"]).toBe("Ceramic Coating");
  });

  it("carries owner review forward but never clears it", () => {
    expect(mergeReturningLead({}, { requires_owner_review: true })["requires_owner_review"]).toBe(true);
    expect(mergeReturningLead({}, { requires_owner_review: false })).not.toHaveProperty(
      "requires_owner_review",
    );
  });
});
