import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { DeliveryBadge, ReachabilityBadge, SmsSuppressedBadge, StatusBadge } from "@/components/StatusBadge";
import { InboxPagination } from "@/components/InboxPagination";
import { DEFAULT_PAGE_SIZE } from "@/lib/lead-pagination";
import {
  SMS_FILTER_LABELS,
  SMS_LEAD_FILTERS,
  type SmsLeadFilter,
} from "@/lib/sms/delivery";

import { createManualLead, getDashboard, runFollowUpsNow } from "@/lib/app.functions";
import { useDashboard } from "@/lib/useDashboard";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  SOURCE_LABELS,
  formatCurrency,
  formatMinutes,
  normaliseAuMobile,
} from "@/lib/domain";
import { importMethodLabel, leadSourceLabel } from "@/lib/lead-source";
import {
  buildConfirmation,
  headerCheckboxState,
  restrictToVisible,
  selectAllVisible,
  summariseResult,
  toggleSelection,
  type DeletionResult,
} from "@/lib/lead-deletion";
import { softDeleteLeadsRequest } from "@/lib/lead-deletion.functions";

type DashboardResult = Awaited<ReturnType<typeof getDashboard>>;
type InboxLeadRow = DashboardResult["leads"][number];

/** The main daily workspace: which leads need attention, and how they are converting. */
export function LeadsWorkspace() {
  const runFollowUps = useServerFn(runFollowUpsNow);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [smsFilter, setSmsFilter] = useState<SmsLeadFilter>("all");
  const [page, setPage] = useState(1);

  const [showAdd, setShowAdd] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [allowProtected, setAllowProtected] = useState(false);
  const [reason, setReason] = useState("");
  const [lastResult, setLastResult] = useState<DeletionResult | null>(null);
  const deleteLeads = useServerFn(softDeleteLeadsRequest);

  // Filters live in the request, so they are applied in the database before
  // pagination. Any filter change resets to page 1.
  const dashboard = useDashboard({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    status: statusFilter,
    source: sourceFilter,
    sms: smsFilter,
  });

  function changeFilter(apply: () => void) {
    apply();
    setPage(1);
    setSelection([]);
  }

  const followUps = useMutation({
    mutationFn: () => runFollowUps(),
    onSuccess: (result) => {
      toast.success(`Follow-ups processed: ${result.sent} sent, ${result.skipped.length} skipped`);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  // Already filtered and paginated by the server: this page only.
  const leads = dashboard.leads as unknown as InboxLeadRow[];


  // Selection is always scoped to the current filtered result.
  const visibleSelection = useMemo(() => restrictToVisible(selection, leads), [selection, leads]);
  const selectedLeads = useMemo(
    () => leads.filter((lead) => visibleSelection.includes(lead.id)),
    [leads, visibleSelection],
  );
  const confirmation = useMemo(
    () => buildConfirmation(visibleSelection, selectedLeads as never),
    [visibleSelection, selectedLeads],
  );
  const checkboxState = headerCheckboxState(selection, leads);

  const deletion = useMutation({
    mutationFn: () =>
      deleteLeads({
        data: {
          requestId: crypto.randomUUID(),
          leadIds: visibleSelection,
          reason: reason.trim() || undefined,
          allowProtected: allowProtected || undefined,
          confirm: true as const,
        },
      }),
    onSuccess: (result) => {
      setLastResult(result as DeletionResult);
      setConfirmOpen(false);
      setAllowProtected(false);
      setReason("");
      if ((result as DeletionResult).deleted > 0) setSelection([]);
      toast.success(summariseResult(result as DeletionResult));
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["deleted-leads"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">Leads</h1>
        <p className="text-xs text-muted-foreground">
          Enquiries that need a reply, follow-up status and completed jobs.
        </p>
      </div>
      <Link
        to="/import"
        className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import data
      </Link>
    </div>
  );

  // Only a first load with nothing cached blocks the page.
  if (dashboard.metricsStatus === "loading" && !dashboard.showLeadsPanel)
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground" role="status">
          Loading leads…
        </p>
      </div>
    );

  const metrics = dashboard.metrics;

  return (
    <div className="space-y-6">
      {header}
      {metrics ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <Metric label="Total leads" value={String(metrics.totalLeads)} />
          <Metric
            label="Median response"
            value={formatMinutes(metrics.medianResponseMinutes)}
            hint={`${Math.round(metrics.withinFiveMinutes * 100)}% within 5 min`}
          />
          <Metric label="Reply rate" value={`${Math.round(metrics.replyRate * 100)}%`} />
          <Metric label="Completed jobs" value={String(metrics.completedJobs)} />
          <Metric
            label="Completed revenue"
            value={formatCurrency(metrics.completedRevenue)}
            hint={
              metrics.averageJobValue ? `Avg ${formatCurrency(metrics.averageJobValue)}` : "No jobs yet"
            }
          />
          <Metric
            label="Needs follow-up"
            value={String(metrics.needsFollowUp)}
            hint={`${metrics.optOuts} opt-outs · ${metrics.deliveryFailures} failures`}
          />
        </section>
      ) : dashboard.metricsStatus === "error" ? (
        <section
          className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          data-testid="dashboard-metrics-error"
          role="alert"
        >
          <div>
            <p className="text-sm font-medium text-destructive">Metrics unavailable</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dashboard.metricsError} Your leads below are unaffected.
            </p>
          </div>
          <button
            onClick={dashboard.retry}
            disabled={dashboard.isRefreshing}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {dashboard.isRefreshing ? "Retrying…" : "Retry metrics"}
          </button>
        </section>
      ) : (
        <section className="panel px-4 py-3" role="status">
          <p className="text-xs text-muted-foreground">Refreshing metrics…</p>
        </section>
      )}

      <ReactivationPanel />






      <section className="panel">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-3 sm:flex sm:justify-between">
          <h2 className="truncate text-sm font-semibold">Lead inbox</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="source-filter">
              Filter by source
            </label>
            <select
              id="source-filter"
              value={sourceFilter}
              onChange={(event) => changeFilter(() => setSourceFilter(event.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="all">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="sms-filter">
              Filter by SMS delivery
            </label>
            <select
              id="sms-filter"
              value={smsFilter}
              onChange={(event) => changeFilter(() => setSmsFilter(event.target.value as SmsLeadFilter))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              {SMS_LEAD_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {SMS_FILTER_LABELS[value]}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="status-filter">
              Filter by status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => changeFilter(() => setStatusFilter(event.target.value))}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="all">All statuses</option>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS_LABELS[status]}
                </option>
              ))}
            </select>

            {visibleSelection.length > 0 && (
              <>
                <span className="text-xs text-muted-foreground" data-testid="selected-count">
                  {visibleSelection.length} selected
                </span>
                <button
                  onClick={() => setConfirmOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-destructive/60 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete selected
                </button>
                <button
                  onClick={() => setSelection([])}
                  className="rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear selection
                </button>
              </>
            )}
            <Link
              to="/leads/deleted"
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Deleted leads
            </Link>
            <button
              onClick={() => followUps.mutate()}
              disabled={followUps.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Run due follow-ups
            </button>
            <button
              onClick={() => setShowAdd((current) => !current)}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add lead
            </button>
          </div>
        </div>

        {showAdd && <AddLeadForm onDone={() => setShowAdd(false)} />}

        {lastResult && (
          <div className="border-b border-border bg-secondary/30 px-4 py-3 text-xs">
            <p className="font-medium">Deletion complete</p>
            <p className="mt-0.5 text-muted-foreground">
              {lastResult.requested} requested · {lastResult.deleted} deleted · {lastResult.failed}{" "}
              failed
              {lastResult.idempotentReplay ? " · repeat request, nothing new deleted" : ""}
            </p>
            {lastResult.failures.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {lastResult.failures.map((failure) => (
                  <li key={failure.leadId}>
                    {failure.name ?? failure.leadId} — {failure.reason}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setLastResult(null)}
              className="mt-1.5 text-[11px] text-muted-foreground underline"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="w-10 px-4 py-2 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all visible leads"
                    checked={checkboxState === "checked"}
                    ref={(node) => {
                      if (node) node.indeterminate = checkboxState === "indeterminate";
                    }}
                    onChange={(event) =>
                      setSelection(event.target.checked ? selectAllVisible(leads) : [])
                    }
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                </th>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Customer</th>
                <th className="px-4 py-2 font-medium">Mobile</th>
                <th className="px-4 py-2 font-medium">Service interest</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Last activity</th>
                <th className="px-4 py-2 text-right font-medium">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border/60 hover:bg-secondary/40">
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${lead.name}`}
                      checked={visibleSelection.includes(lead.id)}
                      onChange={() => setSelection((current) => toggleSelection(current, lead.id))}
                      className="h-4 w-4 accent-[var(--color-primary)]"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {leadSourceLabel(lead)}
                    {importMethodLabel(lead) && (
                      <p className="text-[11px] text-muted-foreground/70">
                        via {importMethodLabel(lead)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link to="/leads/$leadId" params={{ leadId: lead.id }} className="hover:underline">
                      <span className="font-medium">{lead.name}</span>
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {lead.suburb ?? "Suburb unknown"} · {lead.vehicle_type ?? "Vehicle unknown"}
                    </p>
                  </td>
                  <td className="px-4 py-2.5 tabular text-xs text-muted-foreground">
                    {lead.mobile_number}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {lead.service_intent ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={lead.status} />
                      {lead.conversation?.automation_paused && (
                        <span className="text-xs text-warning">paused</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {lead.last_outbound_sms_status && (
                        <DeliveryBadge status={lead.last_outbound_sms_status} />
                      )}
                      <ReachabilityBadge
                        state={lead.reachability_state}
                        evidence={lead.reachability_evidence}
                        evidenceAt={lead.reachability_evidence_at}
                      />
                      {lead.sms_suppressed_at && (
                        <SmsSuppressedBadge reason={lead.sms_suppression_reason} />
                      )}
                    </div>
                    {lead.last_sms_failure_reason && (
                      <p className="mt-1 max-w-[220px] text-[11px] text-destructive">
                        {lead.last_sms_failure_reason}
                      </p>
                    )}
                    {lead.last_delivered_sms_at && !lead.last_sms_failure_reason && (
                      <p className="mt-1 text-[11px] text-muted-foreground/70">
                        Delivered{" "}
                        {new Date(lead.last_delivered_sms_at).toLocaleString("en-AU", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {new Date(lead.conversation?.last_message_at ?? lead.created_at).toLocaleString(
                      "en-AU",
                      { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" },
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular text-xs">
                    {lead.job?.completion_status === "completed" && lead.job.completed_value
                      ? formatCurrency(Number(lead.job.completed_value))
                      : "—"}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No leads match these filters yet. Clear the filters, add a lead, or bring across
                    your history with <span className="text-foreground">Import data</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <InboxPagination
          page={dashboard.page}
          isLoading={dashboard.isRefreshing}
          onPageChange={(next) => {
            setPage(next);
            setSelection([]);
          }}
        />
      </section>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Confirm lead deletion"
            className="panel w-full max-w-lg p-5"
          >
            <h2 className="text-sm font-semibold">
              Delete {confirmation.count} {confirmation.count === 1 ? "lead" : "leads"}?
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{confirmation.warning}</p>
            <ul className="mt-3 max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {confirmation.rows.map((row) => (
                <li key={row.id} className="rounded-md border border-border/60 px-2.5 py-1.5">
                  <span className="font-medium text-foreground">{row.name}</span>
                  <span className="text-muted-foreground">
                    {row.phone ? ` · ${row.phone}` : " · no mobile"} · {row.source}
                    {row.importMethod ? ` (via ${row.importMethod})` : ""}
                  </span>
                  {row.protectedReasons.length > 0 && (
                    <p className="text-[11px] text-warning">
                      Protected history: {row.protectedReasons.join(", ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {confirmation.protectedCount > 0 && (
              <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allowProtected}
                  onChange={(event) => setAllowProtected(event.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                />
                <span>
                  {confirmation.protectedCount} of these have completed jobs, revenue, an active
                  conversation or a pending action. I confirm removal from the inbox; all financial,
                  message and audit history is preserved.
                </span>
              </label>
            )}
            <label className="mt-3 block text-xs">
              <span className="mb-1 block text-muted-foreground">Reason (recorded in the audit trail)</span>
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  setAllowProtected(false);
                }}
                className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground"
              >
                Cancel
              </button>
              <button
                disabled={
                  deletion.isPending ||
                  confirmation.count === 0 ||
                  (confirmation.protectedCount > 0 && !allowProtected)
                }
                onClick={() => deletion.mutate()}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground disabled:opacity-50"
              >
                {deletion.isPending ? "Deleting…" : confirmation.buttonLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 tabular text-xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AddLeadForm({ onDone }: { onDone: () => void }) {
  const create = useServerFn(createManualLead);
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    mobile_number: "",
    suburb: "",
    vehicle_type: "",
    main_concerns: "",
    service_intent: "",
    source_channel: "meta" as "meta" | "website" | "hosted_page" | "manual" | "unknown",
    source_campaign: "",
    consent: false,
  });

  const mutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          ...form,
          suburb: form.suburb || null,
          vehicle_type: form.vehicle_type || null,
          main_concerns: form.main_concerns || null,
          service_intent: form.service_intent || null,
          source_campaign: form.source_campaign || null,
        },
      }),
    onSuccess: (result) => {
      toast.success(
        result.duplicate
          ? "That number already has a recent lead — opened the existing one."
          : result.acknowledgementSent
            ? "Lead created and acknowledgement SMS sent."
            : `Lead created. ${result.note ?? "No SMS sent."}`,
      );
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const valid =
    form.name.length > 1 && normaliseAuMobile(form.mobile_number) !== null && form.consent;

  return (
    <div className="grid gap-3 border-b border-border bg-secondary/30 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
      {(
        [
          ["name", "Name"],
          ["mobile_number", "Mobile (04XX XXX XXX)"],
          ["suburb", "Suburb"],
          ["vehicle_type", "Vehicle type"],
          ["service_intent", "Service intent"],
          ["source_campaign", "Campaign / form"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="block text-xs">
          <span className="mb-1 block text-muted-foreground">{label}</span>
          <input
            value={form[key]}
            onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
          />
        </label>
      ))}
      <label className="block text-xs">
        <span className="mb-1 block text-muted-foreground">Source channel</span>
        <select
          value={form.source_channel}
          onChange={(event) =>
            setForm({ ...form, source_channel: event.target.value as typeof form.source_channel })
          }
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
        >
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs sm:col-span-2 lg:col-span-3">
        <span className="mb-1 block text-muted-foreground">Main concerns</span>
        <input
          value={form.main_concerns}
          onChange={(event) => setForm({ ...form, main_concerns: event.target.value })}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
        />
      </label>
      <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={form.consent}
            onChange={(event) => setForm({ ...form, consent: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
          />
          <span>
            I confirm this lead has an appropriate basis for SMS contact (enquiry or consent recorded).
          </span>
        </label>
        <div className="flex gap-2">
          <button
            onClick={onDone}
            className="rounded-md border border-input px-3 py-1.5 text-xs text-muted-foreground"
          >
            Cancel
          </button>
          <button
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {mutation.isPending ? "Creating…" : "Create lead & send SMS"}
          </button>
        </div>
      </div>
    </div>
  );
}
