import { describe, expect, it } from "vitest";
import { OTHER_GROUP, formatMinutes, groupItems, hasMeaningfulGroups } from "@/lib/service-groups";

type Item = { name: string; category?: string | null };

const items: Item[] = [
  { name: "Interior detail", category: "Interior" },
  { name: "Exterior detail", category: "Exterior" },
  { name: "Odd job" },
  { name: "Deep interior", category: "interior" },
];

describe("service groups", () => {
  it("keeps the tenant's own headings, merges casing and puts Other last", () => {
    const groups = groupItems(items, (item) => item.category);
    expect(groups.map((group) => group.label)).toEqual(["Interior", "Exterior", OTHER_GROUP]);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("never drops an item", () => {
    const total = groupItems(items, (item) => item.category).reduce(
      (count, group) => count + group.items.length,
      0,
    );
    expect(total).toBe(items.length);
  });

  it("only reports meaningful groups when there is more than one", () => {
    expect(hasMeaningfulGroups(groupItems([{ name: "a" }], () => null))).toBe(false);
    expect(hasMeaningfulGroups(groupItems(items, (item) => item.category))).toBe(true);
  });

  it("formats appointment lengths and ignores missing ones", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(150)).toBe("2 hr 30 min");
    expect(formatMinutes(null)).toBeNull();
    expect(formatMinutes(0)).toBeNull();
  });
});
