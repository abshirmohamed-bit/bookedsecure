import { describe, expect, it } from "vitest";
import { isDueForAutoComplete, jobEndsAt, jobValueFromPrice } from "./job-autocomplete";

describe("completing jobs automatically", () => {
  it("values a job from the business's own price, never inventing one", () => {
    expect(jobValueFromPrice("From $280")).toBe(280);
    expect(jobValueFromPrice("$1,200 inc GST")).toBe(1200);
    expect(jobValueFromPrice("$250 to $320")).toBe(250);
    expect(jobValueFromPrice("A$350/mo")).toBe(350);
    expect(jobValueFromPrice("Price on enquiry")).toBeNull();
    expect(jobValueFromPrice(null)).toBeNull();
  });

  it("finishes a job after its service length, or two hours", () => {
    expect(jobEndsAt("2026-11-10T09:00:00Z", 90).toISOString()).toBe("2026-11-10T10:30:00.000Z");
    expect(jobEndsAt("2026-11-10T09:00:00Z", null).toISOString()).toBe("2026-11-10T11:00:00.000Z");
  });

  it("only completes booked jobs whose time has passed, never cancelled ones", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(isDueForAutoComplete({ completion_status: "scheduled", scheduled_at: "2026-11-10T09:00:00Z" }, 120, now)).toBe(true);
    expect(isDueForAutoComplete({ completion_status: "scheduled", scheduled_at: "2026-11-10T11:00:00Z" }, 120, now)).toBe(false);
    expect(isDueForAutoComplete({ completion_status: "cancelled", scheduled_at: "2026-11-09T09:00:00Z" }, 60, now)).toBe(false);
    expect(isDueForAutoComplete({ completion_status: "completed", scheduled_at: "2026-11-09T09:00:00Z" }, 60, now)).toBe(false);
  });
});
