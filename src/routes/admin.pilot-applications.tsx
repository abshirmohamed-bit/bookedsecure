import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { listPilotApplications, updatePilotApplication } from "@/lib/pilot.functions";
import { PilotCheckoutPanel } from "@/components/PilotCheckoutPanel";
import { PILOT_STATUSES, PILOT_STATUS_LABELS, type PilotStatus } from "@/lib/pilot-schema";

export const Route = createFileRoute("/admin/pilot-applications")({
  head: () => ({
    meta: [
      { title: "Pilot applications — BookedSecure admin" },
      {
        name: "description",
        content:
          "Platform administrator review queue for BookedSecure early-access pilot applications, including status, notes and attribution.",
      },
      { property: "og:title", content: "Pilot applications — BookedSecure admin" },
      {
        property: "og:description",
        content: "Review, search and update BookedSecure pilot applications.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PilotApplicationsPage,
  errorComponent: ({ error }) => (
    <AppShell title="Pilot applications">
      <div className="panel p-4">
        <h1 className="page-heading">Pilot applications</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    </AppShell>
  ),
  notFoundComponent: () => (
    <AppShell title="Pilot applications">
      <p className="text-sm text-muted-foreground">Page not found.</p>
    </AppShell>
  ),
});

type Application = Awaited<ReturnType<typeof listPilotApplications>>["applications"][number];

function PilotApplicationsPage() {
  return (
    <AppShell title="Pilot applications">
      <PilotApplications />
    </AppShell>
  );
}

function PilotApplications() {
  const fetchList = useServerFn(listPilotApplications);
  const [status, setStatus] = useState<"all" | PilotStatus>("all");
  const [utmSource, setUtmSource] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filters = {
    status,
    utmSource: utmSource || null,
    search: search || null,
    from: from || null,
    to: to || null,
  };
  const { data, isLoading, error } = useQuery({
    queryKey: ["pilot-applications", filters],
    queryFn: () => fetchList({ data: filters }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading applications…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const applications = data?.applications ?? [];
  const selected = applications.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-heading">Pilot applications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and progress early-access businesses.
        </p>
      </div>
      <div className="panel space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block text-sm">
            <span className="text-muted-foreground">Search</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Business, contact, email, phone"
              className="form-control mt-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | PilotStatus)}
              className="form-control mt-1.5"
            >
              <option value="all">All statuses</option>
              {PILOT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PILOT_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">UTM source</span>
            <select
              value={utmSource}
              onChange={(event) => setUtmSource(event.target.value)}
              className="form-control mt-1.5"
            >
              <option value="">Any source</option>
              {(data?.sources ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="form-control mt-1.5"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="form-control mt-1.5"
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">{applications.length} application(s)</p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Business</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Submitted</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Referrer</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((row) => (
              <tr
                key={row.id}
                onClick={() => setSelectedId(row.id)}
                className="cursor-pointer border-t border-border hover:bg-secondary/50"
              >
                <td className="px-4 py-3 font-medium">
                  {row.business_name}
                  {row.duplicate_of ? (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                      duplicate
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">{row.contact_name}</td>
                <td className="px-4 py-3">{row.email}</td>
                <td className="px-4 py-3">{row.phone ?? "—"}</td>
                <td className="px-4 py-3">
                  {PILOT_STATUS_LABELS[row.status as PilotStatus] ?? row.status}
                </td>
                <td className="px-4 py-3">{new Date(row.submitted_at).toLocaleString()}</td>
                <td className="px-4 py-3">{row.utm_source ?? "—"}</td>
                <td className="px-4 py-3 max-w-[200px] truncate">{row.referrer ?? "—"}</td>
              </tr>
            ))}
            {applications.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">
                  No applications match these filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {selected ? <ApplicationDetail application={selected} /> : null}
    </div>
  );
}

function ApplicationDetail({ application }: { application: Application }) {
  const queryClient = useQueryClient();
  const save = useServerFn(updatePilotApplication);
  const [status, setStatus] = useState<PilotStatus>(application.status as PilotStatus);
  const [notes, setNotes] = useState(application.internal_notes ?? "");

  const mutation = useMutation({
    mutationFn: (input: { status: PilotStatus; internal_notes: string }) =>
      save({ data: { id: application.id, ...input } }),
    onSuccess: () => {
      toast.success("Application updated");
      queryClient.invalidateQueries({ queryKey: ["pilot-applications"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="panel overflow-hidden">
      <div className="brand-wash border-b border-border p-5">
        <h2 className="text-lg font-semibold">{application.business_name}</h2>
        <p className="text-sm text-muted-foreground">
          {application.contact_name} · {application.email} · {application.phone ?? "no phone"}
        </p>
      </div>

      <dl className="grid gap-3 p-5 text-sm sm:grid-cols-2">
        <Detail label="Location" value={application.location} />
        <Detail
          label="Weekly enquiries"
          value={application.weekly_enquiry_volume?.toString() ?? null}
        />
        <Detail label="Services" value={application.services} />
        <Detail label="Follow-up challenge" value={application.challenge} />
        <Detail label="UTM source" value={application.utm_source} />
        <Detail label="UTM medium" value={application.utm_medium} />
        <Detail label="UTM campaign" value={application.utm_campaign} />
        <Detail label="UTM term" value={application.utm_term} />
        <Detail label="UTM content" value={application.utm_content} />
        <Detail label="Referrer" value={application.referrer} />
        <Detail label="Landing page" value={application.landing_page} />
        <Detail label="Submitted" value={new Date(application.submitted_at).toLocaleString()} />
        <Detail
          label="Last reviewed"
          value={
            application.reviewed_at ? new Date(application.reviewed_at).toLocaleString() : null
          }
        />
        <Detail label="Reviewed by" value={application.reviewed_by} />
      </dl>

      <form
        className="space-y-3 border-t border-border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            (status === "rejected" || status === "active") &&
            status !== application.status &&
            !window.confirm(`Set this application to ${PILOT_STATUS_LABELS[status]}?`)
          ) {
            return;
          }
          mutation.mutate({ status, internal_notes: notes });
        }}
      >
        <label className="block text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PilotStatus)}
            className="form-control mt-1.5 sm:max-w-xs"
          >
            {PILOT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PILOT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-muted-foreground">Internal notes</span>
          <textarea
            value={notes}
            rows={4}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={4000}
            className="form-control mt-1.5 min-h-28 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {mutation.isPending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="border-t border-border p-5">
        <PilotCheckoutPanel
          applicationId={application.id}
          status={application.status}
          accessState={application.access_state}
          pilotStartedAt={application.pilot_started_at}
          pilotEndsAt={application.pilot_ends_at}
          paymentCompletedAt={application.payment_completed_at}
          stripeSubscriptionId={application.stripe_subscription_id}
          renewalPreventionConfirmed={application.renewal_prevention_confirmed}
          renewalPreventionAttempts={application.renewal_prevention_attempts}
          renewalPreventionLastError={application.renewal_prevention_last_error}
        />
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{value ?? "—"}</dd>
    </div>
  );
}
