import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Plus, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/StatusBadge";
import { createManualLead, getDashboard, runFollowUpsNow } from "@/lib/app.functions";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  SOURCE_LABELS,
  formatCurrency,
  formatMinutes,
  normaliseAuMobile,
} from "@/lib/domain";

/** The main daily workspace: which leads need attention, and how they are converting. */
export function LeadsWorkspace() {
  const fetchDashboard = useServerFn(getDashboard);
  const runFollowUps = useServerFn(runFollowUpsNow);
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => fetchDashboard(),
  });

  const followUps = useMutation({
    mutationFn: () => runFollowUps(),
    onSuccess: (result) => {
      toast.success(`Follow-ups processed: ${result.sent} sent, ${result.skipped.length} skipped`);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const leads = useMemo(() => {
    if (!data) return [];
    return data.leads.filter(
      (lead) =>
        (statusFilter === "all" || lead.status === statusFilter) &&
        (sourceFilter === "all" || lead.source_channel === sourceFilter),
    );
  }, [data, statusFilter, sourceFilter]);

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

  if (isLoading)
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-muted-foreground">Loading leads…</p>
      </div>
    );
  if (error)
    return (
      <div className="space-y-6">
        {header}
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      </div>
    );
  if (!data) return header;

  const { metrics } = data;

  return (
    <div className="space-y-6">
      {header}
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
              onChange={(event) => setSourceFilter(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="all">All sources</option>
              {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor="status-filter">
              Filter by status
            </label>
            <select
              id="status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
            >
              <option value="all">All statuses</option>
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
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

        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
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
                    <StatusBadge status={lead.status} />
                    {lead.conversation?.automation_paused && (
                      <span className="ml-1.5 text-xs text-warning">paused</span>
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
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No leads match these filters yet. Clear the filters, add a lead, or bring across
                    your history with <span className="text-foreground">Import data</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
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
