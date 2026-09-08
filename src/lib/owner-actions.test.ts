import { describe, expect, it } from "vitest";
import {
  describeStatusChange,
  isSafeStatusTarget,
  parseOwnerRequest,
} from "@/lib/owner-actions";

describe("parseOwnerRequest", () => {
  it("treats a plain question as no action", () => {
    expect(parseOwnerRequest("How many new leads this week?")).toEqual([]);
  });

  it("reads a campaign request with percent, count and window", () => {
    const [request] = parseOwnerRequest(
      "Please draft a 10% discount campaign for 10 old customers we haven't reached out to in 2 weeks",
    );
    expect(request).toEqual({
      kind: "draft_campaign",
      percent: 10,
      maxLeads: 10,
      olderThanDays: 14,
    });
  });

  it("leaves the offer and window unset when the owner names neither", () => {
    expect(parseOwnerRequest("draft a win-back campaign")).toEqual([
      { kind: "draft_campaign", percent: null, maxLeads: null, olderThanDays: null },
    ]);
  });

  it("reads a status change with a source status", () => {
    expect(parseOwnerRequest("Update the 58 leads marked as new to contacted")).toEqual([
      { kind: "update_status", from: "new", to: "contacted", maxLeads: 58 },
    ]);
  });

  it("recognises both actions in one request", () => {
    const requests = parseOwnerRequest(
      "Can you update these 58 leads that are marked new as contacted and draft a 10% discount campaign we can send them",
    );
    expect(requests.map((request) => request.kind)).toEqual([
      "draft_campaign",
      "update_status",
    ]);
  });

  it("never proposes a status this assistant may not set", () => {
    expect(parseOwnerRequest("mark everyone as opted out")).toEqual([]);
    expect(parseOwnerRequest("mark these leads as completed")).toEqual([]);
    expect(isSafeStatusTarget("scheduled")).toBe(false);
    expect(isSafeStatusTarget("contacted")).toBe(true);
  });

  it("ignores a status word without an instruction", () => {
    expect(parseOwnerRequest("how many leads are new?")).toEqual([]);
  });

  it("describes a change in plain language", () => {
    expect(describeStatusChange({ from: "new", to: "contacted", count: 1 })).toContain("1 lead");
  });
});
