// Runtime data contract for the Leads page dashboard response.
//
// The Leads page renders both headline metrics and the lead inbox from one
// request. This module keeps the two concerns separable: a malformed or missing
// metrics block must never hide the lead list, and safe zero defaults are only
// ever used for genuinely empty metrics — never to conceal a failed request.

import { buildPageMeta, DEFAULT_PAGE_SIZE, type PageMeta } from "@/lib/lead-pagination";

export type DashboardMetrics = {
  totalLeads: number;
  medianResponseMinutes: number | null;
  withinFiveMinutes: number;
  replyRate: number;
  completedJobs: number;
  completedRevenue: number;
  averageJobValue: number | null;
  needsFollowUp: number;
  optOuts: number;
  deliveryFailures: number;
};

export type DashboardPage = PageMeta;

export type DashboardLead = { id: string; created_at: string } & Record<string, unknown>;

export type DashboardPayload = {
  role: string | null;
  metrics: DashboardMetrics;
  leads: DashboardLead[];
  /** Server-side page metadata; null when an older response omitted it. */
  page: PageMeta | null;
};

/** Zero metrics. Only valid when the response itself was valid and empty. */
export const EMPTY_METRICS: DashboardMetrics = {
  totalLeads: 0,
  medianResponseMinutes: null,
  withinFiveMinutes: 0,
  replyRate: 0,
  completedJobs: 0,
  completedRevenue: 0,
  averageJobValue: null,
  needsFollowUp: 0,
  optOuts: 0,
  deliveryFailures: 0,
};

export type ResponseShape =
  | "valid"
  | "undefined"
  | "null"
  | "not_object"
  | "missing_metrics"
  | "malformed_metrics"
  | "missing_leads"
  | "malformed_leads";

const CORE_METRICS = [
  "totalLeads",
  "replyRate",
  "completedJobs",
  "completedRevenue",
] as const satisfies readonly (keyof DashboardMetrics)[];

const OPTIONAL_NUMBERS = [
  "withinFiveMinutes",
  "needsFollowUp",
  "optOuts",
  "deliveryFailures",
] as const satisfies readonly (keyof DashboardMetrics)[];

const NULLABLE_NUMBERS = ["medianResponseMinutes", "averageJobValue"] as const satisfies readonly (
  keyof DashboardMetrics
)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLeadRow(value: unknown): value is DashboardLead {
  return isRecord(value) && typeof value["id"] === "string" && typeof value["created_at"] === "string";
}

/** Classifies the raw response without throwing. Used for diagnostics and rendering gates. */
export function classifyDashboardResponse(raw: unknown): ResponseShape {
  if (raw === undefined) return "undefined";
  if (raw === null) return "null";
  if (!isRecord(raw)) return "not_object";
  if (!("leads" in raw)) return "missing_leads";
  if (!Array.isArray(raw["leads"]) || !raw["leads"].every(isLeadRow)) return "malformed_leads";
  if (!("metrics" in raw) || raw["metrics"] == null) return "missing_metrics";
  if (!isRecord(raw["metrics"])) return "malformed_metrics";
  const metrics = raw["metrics"];
  if (!CORE_METRICS.every((key) => isFiniteNumber(metrics[key]))) return "malformed_metrics";
  return "valid";
}

function normaliseMetrics(raw: Record<string, unknown>): DashboardMetrics {
  const metrics: DashboardMetrics = { ...EMPTY_METRICS };
  for (const key of [...CORE_METRICS, ...OPTIONAL_NUMBERS]) {
    const value = raw[key];
    metrics[key] = isFiniteNumber(value) ? value : 0;
  }
  for (const key of NULLABLE_NUMBERS) {
    const value = raw[key];
    metrics[key] = isFiniteNumber(value) ? value : null;
  }
  return metrics;
}

/** Accepts server page metadata, or derives a single-page fallback from the rows. */
function normalisePage(raw: unknown, returned: number): PageMeta | null {
  if (!isRecord(raw)) return null;
  return buildPageMeta({
    page: isFiniteNumber(raw["page"]) ? raw["page"] : 1,
    pageSize: isFiniteNumber(raw["pageSize"]) ? raw["pageSize"] : Math.max(returned, 25),
    totalCount: isFiniteNumber(raw["totalCount"]) ? raw["totalCount"] : returned,
    returned,
  });
}

export type DashboardValidation =
  | { ok: true; shape: "valid"; payload: DashboardPayload; isEmpty: boolean }
  | { ok: false; shape: Exclude<ResponseShape, "valid">; message: string; leads: DashboardLead[] };

const SHAPE_MESSAGES: Record<Exclude<ResponseShape, "valid">, string> = {
  undefined: "The dashboard request returned no data.",
  null: "The dashboard request returned an empty response.",
  not_object: "The dashboard response was not in the expected format.",
  missing_metrics: "The dashboard response is missing its metrics.",
  malformed_metrics: "The dashboard metrics could not be read.",
  missing_leads: "The dashboard response is missing the lead list.",
  malformed_leads: "The lead list in the dashboard response could not be read.",
};

/**
 * Validates the response. On failure it still surfaces any readable lead rows so
 * the Leads page stays usable while the metrics strip shows a retry message.
 */
export function validateDashboardResponse(raw: unknown): DashboardValidation {
  const shape = classifyDashboardResponse(raw);
  if (shape === "valid") {
    const record = raw as Record<string, unknown>;
    const leads = record["leads"] as DashboardLead[];
    const metrics = normaliseMetrics(record["metrics"] as Record<string, unknown>);
    return {
      ok: true,
      shape,
      payload: {
        role: typeof record["role"] === "string" ? record["role"] : null,
        metrics,
        leads,
        page: normalisePage(record["page"], leads.length),
      },
      isEmpty: leads.length === 0 && metrics.totalLeads === 0,
    };
  }
  const salvaged =
    isRecord(raw) && Array.isArray(raw["leads"]) ? raw["leads"].filter(isLeadRow) : [];
  return { ok: false, shape, message: SHAPE_MESSAGES[shape], leads: salvaged };
}

export type FailureKind = "unauthorized" | "forbidden" | "not_found" | "server" | "network" | "unknown";

/** Best-effort classification of a thrown request error, for diagnostics and copy. */
export function classifyRequestFailure(error: unknown): { kind: FailureKind; status: number | null } {
  const status = (() => {
    if (isRecord(error)) {
      const direct = error["status"] ?? error["statusCode"];
      if (isFiniteNumber(direct)) return direct;
      const response = error["response"];
      if (isRecord(response) && isFiniteNumber(response["status"])) return response["status"];
    }
    const message = error instanceof Error ? error.message : String(error ?? "");
    const match = message.match(/\b(401|403|404|429|500|502|503|504)\b/);
    return match ? Number(match[1]) : null;
  })();

  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (status === 401 || message.includes("unauthorized") || message.includes("not signed in"))
    return { kind: "unauthorized", status: status ?? 401 };
  if (status === 403 || message.includes("forbidden")) return { kind: "forbidden", status: status ?? 403 };
  if (status === 404) return { kind: "not_found", status };
  if (status !== null && status >= 500) return { kind: "server", status };
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("load failed"))
    return { kind: "network", status };
  return { kind: "unknown", status };
}

export function failureMessage(kind: FailureKind): string {
  switch (kind) {
    case "unauthorized":
      return "Your session expired before the dashboard metrics loaded. Sign in again to see them.";
    case "forbidden":
      return "This account cannot read the dashboard metrics for this business.";
    case "not_found":
      return "The dashboard metrics endpoint could not be found.";
    case "server":
      return "The dashboard metrics request failed on the server.";
    case "network":
      return "The dashboard metrics request could not reach the server.";
    default:
      return "The dashboard metrics could not be loaded.";
  }
}

export type DashboardDiagnostic = {
  request: "dashboard";
  outcome: "success" | "empty" | "invalid_shape" | "request_failed";
  status: number | string | null;
  hasBusinessContext: boolean;
  responseShape: ResponseShape | "not_received";
  timestamp: string;
};

/**
 * Builds a safe diagnostic: never includes the tenant id itself, lead data, or
 * customer details — only whether business context was present.
 */
export function buildDashboardDiagnostic(input: {
  outcome: DashboardDiagnostic["outcome"];
  status?: number | string | null;
  hasBusinessContext: boolean;
  responseShape?: ResponseShape | "not_received";
  timestamp?: string | undefined;
}): DashboardDiagnostic {
  return {
    request: "dashboard",
    outcome: input.outcome,
    status: input.status ?? null,
    hasBusinessContext: input.hasBusinessContext,
    responseShape: input.responseShape ?? "not_received",
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function formatDashboardDiagnostic(diagnostic: DashboardDiagnostic): string {
  return [
    `[dashboard] outcome=${diagnostic.outcome}`,
    `status=${diagnostic.status ?? "n/a"}`,
    `businessContext=${diagnostic.hasBusinessContext ? "present" : "absent"}`,
    `responseShape=${diagnostic.responseShape}`,
    `at=${diagnostic.timestamp}`,
  ].join(" ");
}
