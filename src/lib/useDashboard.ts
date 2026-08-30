import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef } from "react";
import { getDashboard } from "@/lib/app.functions";
import {
  buildDashboardDiagnostic,
  classifyRequestFailure,
  formatDashboardDiagnostic,
  validateDashboardResponse,
  type DashboardPayload,
} from "@/lib/dashboard-contract";
import { DashboardContractError, deriveDashboardView, type DashboardView } from "@/lib/dashboard-state";

export const DASHBOARD_QUERY_KEY = ["dashboard"] as const;

/**
 * Single source of truth for the Leads page dashboard request.
 *
 * Validates the response before anything renders, logs a safe diagnostic that
 * never contains the tenant id or customer data, and keeps the last good lead
 * list so a temporary metrics failure does not blank the inbox.
 */
export function useDashboard(): DashboardView & { retry: () => void } {
  const fetchDashboard = useServerFn(getDashboard);
  const lastGood = useRef<DashboardPayload | null>(null);

  const query = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: async (): Promise<DashboardPayload> => {
      const raw = await fetchDashboard();
      const result = validateDashboardResponse(raw);
      if (!result.ok) {
        throw new DashboardContractError(result.message, result.shape, result.leads);
      }
      return result.payload;
    },
    // One request per mount window: avoids the duplicate initial fetch when the
    // route remounts (hard refresh, returning from Import, tab switch).
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: (attempt, error) => classifyRequestFailure(error).kind === "network" && attempt < 2,
  });

  if (query.data) lastGood.current = query.data;

  const view = deriveDashboardView({
    status: query.status,
    isFetching: query.isFetching,
    data: query.data ?? null,
    error: query.error,
    lastGood: lastGood.current,
    hasBusinessContext: Boolean(query.data ?? lastGood.current),
  });

  const diagnostic = view.diagnostic;
  useEffect(() => {
    if (!diagnostic) return;
    if (diagnostic.outcome === "success") return;
    const line = formatDashboardDiagnostic(diagnostic);
    if (diagnostic.outcome === "empty") console.info(line);
    else console.warn(line);
  }, [diagnostic?.outcome, diagnostic?.responseShape, diagnostic?.status, diagnostic?.timestamp]);

  useEffect(() => {
    if (query.status !== "error" || !query.error) return;
    if (query.error instanceof DashboardContractError) return;
    const failure = classifyRequestFailure(query.error);
    console.warn(
      formatDashboardDiagnostic(
        buildDashboardDiagnostic({
          outcome: "request_failed",
          status: failure.status ?? failure.kind,
          hasBusinessContext: Boolean(lastGood.current),
          responseShape: "not_received",
        }),
      ),
    );
  }, [query.status, query.error]);

  return { ...view, retry: () => void query.refetch() };
}
