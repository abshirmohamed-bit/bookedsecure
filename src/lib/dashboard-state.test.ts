import { describe, expect, it } from "vitest";
import {
  EMPTY_METRICS,
  classifyDashboardResponse,
  classifyRequestFailure,
  buildDashboardDiagnostic,
  formatDashboardDiagnostic,
  validateDashboardResponse,
  type DashboardPayload,
} from "@/lib/dashboard-contract";
import { DashboardContractError, deriveDashboardView } from "@/lib/dashboard-state";

const metrics = {
  totalLeads: 24,
  medianResponseMinutes: 3,
  withinFiveMinutes: 0.8,
  replyRate: 0.5,
  completedJobs: 2,
  completedRevenue: 900,
  averageJobValue: 450,
  needsFollowUp: 4,
  optOuts: 0,
  deliveryFailures: 1,
};

const lead = { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-08-01T00:00:00Z", name: "Harry" };

function okResponse(overrides: Record<string, unknown> = {}) {
  return { role: "owner", metrics, leads: [lead], ...overrides };
}

describe("dashboard response validation", () => {
  it("accepts a successful response and preserves metrics and leads", () => {
    const result = validateDashboardResponse(okResponse());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.metrics.totalLeads).toBe(24);
    expect(result.payload.leads).toHaveLength(1);
    expect(result.isEmpty).toBe(false);
  });

  it("classifies an undefined response instead of defaulting it", () => {
    expect(classifyDashboardResponse(undefined)).toBe("undefined");
    const result = validateDashboardResponse(undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/no data/i);
    expect(result.leads).toEqual([]);
  });

  it("classifies a null response", () => {
    expect(classifyDashboardResponse(null)).toBe("null");
    expect(validateDashboardResponse(null).ok).toBe(false);
  });

  it("rejects malformed metrics but salvages readable leads", () => {
    const result = validateDashboardResponse({ leads: [lead], metrics: { totalLeads: "many" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.shape).toBe("malformed_metrics");
    expect(result.leads).toHaveLength(1);
  });

  it("rejects a malformed lead list", () => {
    expect(classifyDashboardResponse({ metrics, leads: [{ nope: true }] })).toBe("malformed_leads");
    expect(classifyDashboardResponse({ metrics, leads: "rows" })).toBe("malformed_leads");
    expect(classifyDashboardResponse({ metrics })).toBe("missing_leads");
    expect(classifyDashboardResponse("nope")).toBe("not_object");
  });

  it("uses zero defaults only for a genuinely empty but valid response", () => {
    const result = validateDashboardResponse({ role: "owner", leads: [], metrics: EMPTY_METRICS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isEmpty).toBe(true);
    expect(result.payload.metrics).toEqual({
      ...EMPTY_METRICS,
      totalLeads: 0,
      replyRate: 0,
      completedJobs: 0,
      completedRevenue: 0,
    });
  });
});

describe("request failure classification", () => {
  it("detects unauthorized responses", () => {
    expect(classifyRequestFailure(new Error("Unauthorized")).kind).toBe("unauthorized");
    expect(classifyRequestFailure({ status: 401 }).kind).toBe("unauthorized");
  });

  it("detects server and network failures", () => {
    expect(classifyRequestFailure({ status: 500 }).kind).toBe("server");
    expect(classifyRequestFailure(new Error("Failed to fetch")).kind).toBe("network");
    expect(classifyRequestFailure(new Error("boom")).kind).toBe("unknown");
  });
});

describe("dashboard view derivation", () => {
  const payload = (validateDashboardResponse(okResponse()) as { payload: DashboardPayload }).payload;

  it("renders metrics only after validation passes", () => {
    const view = deriveDashboardView({ status: "success", data: payload });
    expect(view.metricsStatus).toBe("ready");
    expect(view.metrics?.totalLeads).toBe(24);
    expect(view.leads).toHaveLength(1);
    expect(view.diagnostic?.outcome).toBe("success");
  });

  it("reports the empty state for zero records", () => {
    const empty = (
      validateDashboardResponse({ role: "owner", leads: [], metrics: EMPTY_METRICS }) as {
        payload: DashboardPayload;
      }
    ).payload;
    const view = deriveDashboardView({ status: "success", data: empty });
    expect(view.metricsStatus).toBe("empty");
    expect(view.metrics).toEqual(EMPTY_METRICS);
  });

  it("treats a slow first response as loading without metrics", () => {
    const view = deriveDashboardView({ status: "pending", isFetching: true });
    expect(view.metricsStatus).toBe("loading");
    expect(view.metrics).toBeNull();
    expect(view.showLeadsPanel).toBe(false);
    expect(view.diagnostic).toBeNull();
  });

  it("keeps the cached lead list visible while a refetch is pending", () => {
    const view = deriveDashboardView({ status: "pending", isFetching: true, lastGood: payload });
    expect(view.metrics).toBeNull();
    expect(view.leads).toHaveLength(1);
    expect(view.showLeadsPanel).toBe(true);
    expect(view.leadsAreStale).toBe(true);
  });

  it("surfaces a retryable error without hiding cached leads", () => {
    const view = deriveDashboardView({
      status: "error",
      error: new Error("Unauthorized"),
      lastGood: payload,
    });
    expect(view.metricsStatus).toBe("error");
    expect(view.metrics).toBeNull();
    expect(view.metricsError).toMatch(/session expired/i);
    expect(view.leads).toHaveLength(1);
    expect(view.canRetry).toBe(true);
    expect(view.diagnostic?.outcome).toBe("request_failed");
    expect(view.diagnostic?.status).toBe(401);
  });

  it("reports a database/API failure and stays usable", () => {
    const view = deriveDashboardView({ status: "error", error: { status: 500 }, lastGood: payload });
    expect(view.metricsError).toMatch(/failed on the server/i);
    expect(view.showLeadsPanel).toBe(true);
  });

  it("keeps salvaged leads when the contract fails and there is no cache", () => {
    const view = deriveDashboardView({
      status: "error",
      error: new DashboardContractError("bad", "malformed_metrics", [lead]),
    });
    expect(view.metrics).toBeNull();
    expect(view.leads).toHaveLength(1);
    expect(view.diagnostic?.outcome).toBe("invalid_shape");
    expect(view.diagnostic?.responseShape).toBe("malformed_metrics");
  });

  it("recovers on retry after a failure", () => {
    const failed = deriveDashboardView({ status: "error", error: new Error("boom") });
    expect(failed.metricsStatus).toBe("error");
    const retried = deriveDashboardView({ status: "success", data: payload });
    expect(retried.metricsStatus).toBe("ready");
    expect(retried.metricsError).toBeNull();
  });
});

describe("safe diagnostics", () => {
  it("records presence of business context and never the id itself", () => {
    const diagnostic = buildDashboardDiagnostic({
      outcome: "request_failed",
      status: 500,
      hasBusinessContext: true,
      responseShape: "not_received",
      timestamp: "2026-08-30T00:00:00.000Z",
    });
    const line = formatDashboardDiagnostic(diagnostic);
    expect(line).toContain("[dashboard]");
    expect(line).toContain("businessContext=present");
    expect(line).toContain("status=500");
    expect(line).toContain("at=2026-08-30T00:00:00.000Z");
    expect(JSON.stringify(diagnostic)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
