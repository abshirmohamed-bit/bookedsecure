import { describe, expect, it } from "vitest";
import { asksForServiceList } from "@/lib/web-chat-presentation";

describe("asksForServiceList", () => {
  it("stays hidden for an off-list request", () => {
    expect(asksForServiceList("i need something else")).toBe(false);
    expect(asksForServiceList("engine bay clean please")).toBe(false);
  });

  it("re-shows only when the customer asks", () => {
    expect(asksForServiceList("what services do you have?")).toBe(true);
    expect(asksForServiceList("can you show me the options")).toBe(true);
  });
});
