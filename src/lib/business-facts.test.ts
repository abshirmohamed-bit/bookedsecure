import { describe, expect, it } from "vitest";
import { factLines, FACTS_ONLY_RULES } from "./business-facts.server";
import { buildBusinessProfile } from "./business-profile";

describe("facts the AI writers may use", () => {
  it("lists the business's own profile and plans", () => {
    const profile = buildBusinessProfile({ industry: "Security workforce software", businessModel: "subscription", highlights: ["AI scheduling"] }, null);
    const lines = factLines("GuardFlow", { service_area: "Australia", website_url: "https://guardflow.com.au/" }, profile, [{ name: "Starter", price_guidance: "A$350/mo" }]);
    expect(lines).toEqual(expect.arrayContaining(["Business name: GuardFlow", "Industry: Security workforce software", "Plans:", "- Starter (A$350/mo)", "Key features: AI scheduling"]));
  });

  it("with no profile, gives only the name and tells the writer not to guess", () => {
    expect(factLines("Guardflow", null, null, [])).toEqual(["Business name: Guardflow"]);
    expect(FACTS_ONLY_RULES).toMatch(/Never make up what the business does/);
  });
});
