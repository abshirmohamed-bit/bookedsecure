import { describe, expect, it } from "vitest";
import { importMethodLabel, isLeadFinderLead, leadSourceLabel } from "./lead-source";
import { leadFilterPredicates, normaliseFilters } from "./lead-pagination";

describe("Lead finder businesses in Leads", () => {
  const found = { source_channel: "unknown", lead_origin: "crm_import", source_metadata: { lead_finder: { place_id: "web:x.com.au" } } };
  it("are labelled Lead finder, never CRM CSV or Unknown", () => {
    expect(isLeadFinderLead(found)).toBe(true);
    expect(leadSourceLabel(found)).toBe("Lead finder");
    expect(importMethodLabel(found)).toBeNull();
    expect(importMethodLabel({ source_channel: "unknown", lead_origin: "crm_import" })).toBe("CRM CSV");
  });
  it("can be filtered on their own", () => {
    const predicates = leadFilterPredicates("biz", normaliseFilters({ source: "lead_finder" }));
    expect(predicates).toContainEqual({ kind: "notNull", column: "source_metadata->lead_finder" });
    expect(predicates.some((p) => p.kind === "eq" && p.column === "source_channel")).toBe(false);
  });
});
