// Pure view-state derivation for the Leads page dashboard request.
//
// Keeping this pure means every failure mode (undefined, null, malformed,
// unauthorized, database error, slow response, retry) is testable without a
// browser, and the component only renders what this function permits.

import {
  buildDashboardDiagnostic,
  classifyRequestFailure,
  failureMessage,
  type DashboardDiagnostic,
  type DashboardLead,
  type DashboardMetrics,
  type DashboardPayload,
  type ResponseShape,
} from "@/lib/dashboard-contract";

/** Thrown when the response arrives but fails runtime validation. */
export class DashboardContractError extends Error {
  readonly shape: Exclude<ResponseShape, "valid">;
  readonly salvagedLeads: DashboardLead[];
  constructor(message: string, shape: Exclude<ResponseShape, "valid">, salvagedLeads: DashboardLead[]) {
    super(message);
    this.name = "DashboardContractError";
    this.shape = shape;
    this.salvagedLeads = salvagedLeads;
  }
}

export type MetricsStatus = "loading" | "ready" | "empty" | "error";

export type DashboardView = {
  /** Never non-null unless validation passed. */
  metrics: DashboardMetrics | null;
  metricsStatus: MetricsStatus;
  metricsError: string | null;
  /** The lead list stays available even when metrics fail. */
  leads: DashboardLead[];
  leadsAreStale: boolean;
  showLeadsPanel: boolean;
  canRetry: boolean;
  isRefreshing: boolean;
  diagnostic: DashboardDiagnostic | null;
};

export function deriveDashboardView(input: {
  status: "pending" | "success" | "error";
  isFetching?: boolean;
  data?: DashboardPayload | null;
  error?: unknown;
  /** Last validated payload, so a temporary failure does not erase the list. */
  lastGood?: DashboardPayload | null;
  hasBusinessContext?: boolean;
  timestamp?: string;
}): DashboardView {
  const isFetching = input.isFetching ?? false;
  const lastGood = input.lastGood ?? null;
  const hasBusinessContext = input.hasBusinessContext ?? Boolean(input.data ?? lastGood);

  if (input.status === "success" && input.data) {
    const isEmpty = input.data.leads.length === 0 && input.data.metrics.totalLeads === 0;
    return {
      metrics: input.data.metrics,
      metricsStatus: isEmpty ? "empty" : "ready",
      metricsError: null,
      leads: input.data.leads,
      leadsAreStale: false,
      showLeadsPanel: true,
      canRetry: true,
      isRefreshing: isFetching,
      diagnostic: buildDashboardDiagnostic({
        outcome: isEmpty ? "empty" : "success",
        status: 200,
        hasBusinessContext: true,
        responseShape: "valid",
        timestamp: input.timestamp,
      }),
    };
  }

  if (input.status === "error") {
    const contract = input.error instanceof DashboardContractError ? input.error : null;
    const failure = contract ? null : classifyRequestFailure(input.error);
    const leads = lastGood?.leads ?? contract?.salvagedLeads ?? [];
    return {
      metrics: null,
      metricsStatus: "error",
      metricsError: contract
        ? contract.message
        : failure
          ? failureMessage(failure.kind)
          : "The dashboard metrics could not be loaded.",
      leads,
      leadsAreStale: leads.length > 0,
      showLeadsPanel: leads.length > 0,
      canRetry: true,
      isRefreshing: isFetching,
      diagnostic: buildDashboardDiagnostic({
        outcome: contract ? "invalid_shape" : "request_failed",
        status: contract ? "contract" : failure?.status ?? null,
        hasBusinessContext,
        responseShape: contract ? contract.shape : "not_received",
        timestamp: input.timestamp,
      }),
    };
  }

  // Pending. Show cached leads immediately when we have them (tab switch,
  // returning from Import, post-refetch) instead of blanking the page.
  return {
    metrics: null,
    metricsStatus: "loading",
    metricsError: null,
    leads: lastGood?.leads ?? [],
    leadsAreStale: Boolean(lastGood),
    showLeadsPanel: Boolean(lastGood),
    canRetry: false,
    isRefreshing: true,
    diagnostic: null,
  };
}
