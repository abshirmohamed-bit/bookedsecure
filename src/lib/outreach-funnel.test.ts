import { describe, expect, it } from "vitest";
import { outreachFunnel, outreachStage } from "@/lib/lead-finder";

describe("outreach funnel", () => {
  it("classes a lead by how far it got", () => {
    expect(outreachStage("completed", false)).toBe("booked");
    expect(outreachStage("customer_replied", true)).toBe("replied");
    expect(outreachStage("prospect", true)).toBe("emailed");
    expect(outreachStage("prospect", false)).toBe("added");
  });
  it("counts later steps toward earlier ones", () => {
    expect(outreachFunnel(10, ["booked", "replied", "emailed", "added"])).toEqual({ found: 10, emailed: 3, replied: 2, booked: 1 });
    expect(outreachFunnel(0, ["added", "added"]).found).toBe(2);
  });
});
