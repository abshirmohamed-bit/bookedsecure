import { describe, expect, it } from "vitest";
import { searchVariants, searchWords } from "@/lib/lead-query.server";

describe("lead search terms", () => {
  it("splits a full name into words", () => {
    expect(searchWords("  Iesha  Yatim ")).toEqual(["Iesha", "Yatim"]);
  });

  it("strips characters that would break the query", () => {
    expect(searchWords("o'brien, % smith")).toEqual(["o'brien", "smith"]);
  });

  it("matches Australian mobiles typed either way", () => {
    expect(searchVariants("0412345678")).toContain("61412345678");
    expect(searchVariants("61412345678")).toContain("0412345678");
  });

  it("tolerates one missing letter at the start or end of a name", () => {
    expect(searchVariants("lesha")).toEqual(expect.arrayContaining(["lesha", "esha", "lesh"]));
  });

  it("does not loosen very short words", () => {
    expect(searchVariants("li")).toEqual(["li"]);
  });

  it("caps how many words are searched", () => {
    expect(searchWords("a b c d e f")).toHaveLength(4);
  });
});
