import { describe, expect, it } from "vitest";
import {
  describeLeadUpdate,
  parseCustomerName,
  parseFutureDate,
  parseLeadUpdateRequest,
} from "@/lib/owner-lead-actions";

const NOW = new Date("2026-03-01T00:00:00.000Z");

describe("single-customer instructions", () => {
  it("reads completion, payment and a future booking from one sentence", () => {
    const request = parseLeadUpdateRequest(
      "Andrew's detail is done, he paid $450, book him again on 12 March at 9am",
      NOW,
    );
    expect(request?.name).toBe("Andrew");
    expect(request?.markCompleted).toBe(true);
    expect(request?.paidAmount).toBe(450);
    expect(request?.bookAt).toBe("2026-03-12T09:00:00.000Z");
  });

  it("reads a contact correction without any booking change", () => {
    const request = parseLeadUpdateRequest("Update Sarah's suburb is Burwood", NOW);
    expect(request?.details.suburb).toBe("Burwood");
    expect(request?.markCompleted).toBe(false);
    expect(request?.bookAt).toBeNull();
  });

  it("ignores a message with no customer named", () => {
    expect(parseLeadUpdateRequest("how many bookings do I have", NOW)).toBeNull();
  });

  it("ignores a named customer with nothing to change", () => {
    expect(parseLeadUpdateRequest("tell me about Andrew", NOW)).toBeNull();
  });

  it("never books a date in the past", () => {
    const iso = parseFutureDate("book on 1 February", NOW);
    expect(iso && iso > NOW.toISOString()).toBe(true);
  });

  it("names the customer from possessive and verb phrasing", () => {
    expect(parseCustomerName("Andrew's car is done")).toBe("Andrew");
    expect(parseCustomerName("mark Bianca as done")).toBe("Bianca");
  });

  it("describes exactly what confirming will do", () => {
    const request = parseLeadUpdateRequest("Andrew is finished and paid $300", NOW)!;
    const lines = describeLeadUpdate({ leadName: "Andrew Smith", request });
    expect(lines.join(" ")).toContain("$300 paid");
  });
});
