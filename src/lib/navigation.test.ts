import { describe, expect, it } from "vitest";
import { NAV_ITEMS, NAV_SECTIONS, isNavItemActive, navBreadcrumb } from "./navigation";

const item = (to: string) => NAV_ITEMS.find((candidate) => candidate.to === to)!;

describe("sidebar structure", () => {
  it("groups pages by job, with every setting on its own page", () => {
    expect(NAV_SECTIONS.map((section) => section.label)).toEqual([null, "Inbox", "Work", "Setup"]);
    expect(NAV_SECTIONS[3]!.items.map((entry) => entry.to)).toEqual([
      "/settings/business",
      "/settings/messaging",
      "/settings/automation",
      "/settings/integrations",
      "/settings/team",
    ]);
  });
  it("lists each page once and puts counts only on inboxes", () => {
    const paths = NAV_ITEMS.map((entry) => entry.to);
    expect(new Set(paths).size).toBe(paths.length);
    expect(NAV_ITEMS.filter((entry) => entry.badge).map((entry) => entry.to)).toEqual(["/leads", "/social"]);
  });
});

describe("active item", () => {
  it("keeps Leads active on a conversation and on import", () => {
    expect(isNavItemActive(item("/leads"), "/leads/123")).toBe(true);
    expect(isNavItemActive(item("/leads"), "/import")).toBe(true);
    expect(isNavItemActive(item("/dashboard"), "/leads")).toBe(false);
  });
  it("does not treat a shared prefix as a match", () => {
    expect(isNavItemActive(item("/settings/team"), "/settings/teamwork")).toBe(false);
  });
});

describe("page title trail", () => {
  it("names pages the way the sidebar does", () => {
    expect(navBreadcrumb("/dashboard")).toEqual(["Home"]);
    expect(navBreadcrumb("/assistant/abc")).toEqual(["Assistant"]);
    expect(navBreadcrumb("/settings/integrations")).toEqual(["Setup", "Connections"]);
    expect(navBreadcrumb("/import")).toEqual(["Leads", "Import"]);
    expect(navBreadcrumb("/leads/deleted")).toEqual(["Leads", "Deleted"]);
    expect(navBreadcrumb("/profile")).toEqual(["Account", "Your profile"]);
    expect(navBreadcrumb("/somewhere-else")).toEqual([]);
  });
});
