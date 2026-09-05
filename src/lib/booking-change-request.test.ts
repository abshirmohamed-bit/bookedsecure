import { describe, expect, it } from "vitest";
import { evaluateBookingChangeRequest } from "@/lib/booking-change-request";
import type { WebChatCollected, WebChatTenant } from "@/lib/web-chat";

const tenant: WebChatTenant = {
  name: "Glocast",
  flexibleRequestsEnabled: true,
  services: [
    { id: "1", name: "Full Interior Detail", description: null, included_items: null, excluded_items: null, qualification_note: null },
    { id: "2", name: "Ceramic Coating", description: null, included_items: null, excluded_items: null, qualification_note: null },
  ],
};

const booked: WebChatCollected = {
  service_id: "1",
  service_name: "Full Interior Detail",
  vehicle_type: "Mazda CX-5",
  suburb: "Bankstown",
  concerns: "pet hair in the back",
  name: "Sam Rivers",
  mobile_number: "+61400555918",
  email: "sam918@example.com",
} as WebChatCollected;

function run(raw: string) {
  return evaluateBookingChangeRequest({ collected: booked, raw, tenant, tenantName: "Glocast" });
}

describe("post-booking change requests", () => {
  it("applies a two-field detail correction and flags owner review", () => {
    const result = run("Actually, change the vehicle to a Toyota Prado and the suburb to Burwood.");
    expect(result.kind).toBe("detail_update");
    expect(result.collected.vehicle_type).toBe("Toyota Prado");
    expect(result.collected.suburb).toBe("Burwood");
    expect(result.requiresOwnerReview).toBe(true);
    expect(result.message).toContain("booking time stays as confirmed");
  });

  it("keeps the confirmed service and booking values untouched in the payload", () => {
    const result = run("change the suburb to Burwood");
    expect(result.collected.service_id).toBe("1");
    expect(result.collected.service_name).toBe("Full Interior Detail");
  });

  it("never actions a reschedule or cancellation", () => {
    for (const raw of ["can you reschedule me to Friday", "please cancel my booking", "move it to a different day"]) {
      const result = run(raw);
      expect(result.kind).toBe("reschedule");
      expect(result.updates).toEqual([]);
      expect(result.requiresOwnerReview).toBe(true);
    }
  });

  it("does not flag review for a contact-only update", () => {
    const result = run("change my email to sam.new@example.com");
    expect(result.collected.email).toBe("sam.new@example.com");
    expect(result.requiresOwnerReview).toBe(false);
    expect(result.message).toContain("booking is unchanged");
    expect(result.message.startsWith("Got it")).toBe(true);
  });

  it("asks again when nothing actionable is present", () => {
    const result = run("thanks heaps");
    expect(result.kind).toBe("unclear");
    expect(result.updates).toEqual([]);
    expect(result.requiresOwnerReview).toBe(false);
  });
});
