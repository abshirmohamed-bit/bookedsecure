import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Pause, Play, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import {
  DeliveryBadge,
  FailureClassBadge,
  ReadinessBadge,
  SmsSuppressedBadge,
  ReachabilityBadge,
  StatusBadge,
} from "@/components/StatusBadge";

import {
  analyseConversation,
  getLead,
  recordCompletedJob,
  scheduleJob,
  sendManualReply,
  setAutomationPaused,
  simulateInboundReply,
  updateLead,
} from "@/lib/app.functions";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, formatCurrency } from "@/lib/domain";
import { importMethodLabel, leadSourceLabel, originalSourceDetails } from "@/lib/lead-source";
import { SuppressionRecoveryPanel } from "@/components/SuppressionRecoveryPanel";
import { BookingPanel } from "@/components/BookingPanel";

export const Route = createFileRoute("/leads/$leadId")({
  head: () => ({
    meta: [
      { title: "Lead conversation — BookedSecure" },
      {
        name: "description",
        content:
          "Review the SMS conversation, AI summary and suggested reply for a detailing enquiry, and record the completed job.",
      },
      { property: "og:title", content: "Lead conversation — BookedSecure" },
      {
        property: "og:description",
        content: "Approve replies, pause automation and record completed-job revenue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LeadPage,
});

function LeadPage() {
  return (
    <AppShell title="Lead conversation">
      <LeadDetail />
    </AppShell>
  );
}

function LeadDetail() {
  const { leadId } = Route.useParams();
  const fetchLead = useServerFn(getLead);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [fromAi, setFromAi] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["lead", leadId],
    queryFn: () => fetchLead({ data: { leadId } }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const send = useServerFn(sendManualReply);
  const analyse = useServerFn(analyseConversation);
  const pause = useServerFn(setAutomationPaused);
  const patch = useServerFn(updateLead);
  const simulate = useServerFn(simulateInboundReply);

  const sendMutation = useMutation({
    mutationFn: () => send({ data: { leadId, body: reply, fromAi } }),
    onSuccess: (result) => {
      if (result.sent) {
        toast.success("Message sent");
        setReply("");
        setFromAi(false);
      } else {
        toast.error(result.reason ?? "Message not sent");
      }
      invalidate();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const analyseMutation = useMutation({
    mutationFn: () => analyse({ data: { leadId } }),
    onSuccess: () => {
      toast.success("AI analysis updated");
      invalidate();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const pauseMutation = useMutation({
    mutationFn: (paused: boolean) => pause({ data: { leadId, paused } }),
    onSuccess: invalidate,
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      patch({ data: { leadId, status: status as (typeof LEAD_STATUSES)[number] } }),
    onSuccess: () => {
      toast.success("Status updated");
      invalidate();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  const simulateMutation = useMutation({
    mutationFn: (body: string) => simulate({ data: { leadId, body } }),
    onSuccess: () => {
      toast.success("Simulated inbound reply recorded");
      invalidate();
    },
    onError: (mutationError: Error) => toast.error(mutationError.message),
  });

  useEffect(() => {
    setReply("");
  }, [leadId]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading lead…</p>;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;
  if (!data?.lead) return <p className="text-sm text-muted-foreground">Lead not found.</p>;

  const { lead, messages, conversation, ai, job, services, notifications, automationJobs } = data;

  return (
    <div className="space-y-5">
      <Link
        to="/dashboard"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to leads
      </Link>

      <header className="brand-wash panel grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate font-heading text-xl font-semibold">{lead.name}</h1>
            <StatusBadge status={lead.status} />
            <ReadinessBadge readiness={lead.readiness_classification} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {lead.mobile_number}
            {lead.email ? ` · ${lead.email}` : ""} · {leadSourceLabel(lead)}
            {importMethodLabel(lead) ? ` (via ${importMethodLabel(lead)})` : ""}
            {lead.source_campaign ? ` · ${lead.source_campaign}` : ""}
            {lead.source_form ? ` · ${lead.source_form}` : ""} ·{" "}
            {new Date(lead.created_at).toLocaleString("en-AU")}
          </p>
          {lead.lead_origin === "crm_import" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Imported historical lead — no acknowledgement SMS, owner alert or follow-up sequence
              was created by the import.
            </p>
          )}

          {lead.opted_out_at && (
            <p className="mt-1 text-xs text-destructive">
              Opted out {new Date(lead.opted_out_at).toLocaleString("en-AU")} — automated SMS
              blocked.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-muted-foreground/70">Latest SMS:</span>
            <DeliveryBadge status={lead.last_outbound_sms_status} />
            <span className="text-muted-foreground/70">Reachability:</span>
            <ReachabilityBadge
              state={lead.reachability_state}
              evidence={lead.reachability_evidence}
              evidenceAt={lead.reachability_evidence_at}
            />
            {lead.sms_suppressed_at && <SmsSuppressedBadge reason={lead.sms_suppression_reason} />}
            {lead.last_delivered_sms_at && (
              <span>
                Last delivered {new Date(lead.last_delivered_sms_at).toLocaleString("en-AU")}
              </span>
            )}
            {lead.last_reply_at && (
              <span>Last reply {new Date(lead.last_reply_at).toLocaleString("en-AU")}</span>
            )}
            {conversation?.automation_paused && <span>Automation stopped</span>}
          </div>
          {lead.last_sms_failure_reason && (
            <p className="mt-1 text-xs text-destructive">
              Last SMS failure: {lead.last_sms_failure_reason}
              {lead.last_sms_failure_code ? ` (code ${lead.last_sms_failure_code})` : ""}
            </p>
          )}
          {lead.sms_suppressed_at && (
            <p className="mt-1 text-xs text-warning">
              Automated SMS suppressed {new Date(lead.sms_suppressed_at).toLocaleString("en-AU")} —{" "}
              {lead.sms_suppression_reason ?? "permanent delivery failure reported by the provider"}
              . This does not prove the number is inactive. A later delivery or reply records new
              evidence but never resumes automation on its own — the owner must review and resume.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lead.status}
            onChange={(event) => statusMutation.mutate(event.target.value)}
            className="form-control w-auto text-xs"
          >
            {LEAD_STATUSES.filter((status) => status !== "completed").map((status) => (
              <option key={status} value={status}>
                {LEAD_STATUS_LABELS[status]}
              </option>
            ))}
            {lead.status === "completed" && <option value="completed">Completed</option>}
          </select>
          <button
            onClick={() => pauseMutation.mutate(!conversation?.automation_paused)}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            {conversation?.automation_paused ? (
              <>
                <Play className="h-3.5 w-3.5" /> Resume automation
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5" /> Pause automation
              </>
            )}
          </button>
        </div>
      </header>

      <SuppressionRecoveryPanel lead={lead} role={data.role} onResumed={invalidate} />

      {lead.lead_origin === "crm_import" && (
        <ImportedSourcePanel
          sourceMetadata={lead.source_metadata as Record<string, unknown> | null}
          serviceIntent={lead.service_intent}
          vehicleType={lead.vehicle_type}
          suburb={lead.suburb}
        />
      )}

      {data.webConversation && (
        <WebChatTranscript conversation={data.webConversation} messages={data.webChatMessages} />
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="panel flex flex-col">
          <h2 className="section-heading">Conversation</h2>
          <div className="max-h-[520px] space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  {conversation ? "No messages yet." : "No conversation yet."}
                </p>
                {!conversation && (
                  <p className="text-xs text-muted-foreground">
                    A conversation starts when you send the first message. Nothing is sent
                    automatically.
                  </p>
                )}
              </div>
            )}

            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.direction === "outbound"
                    ? "ml-auto max-w-[85%] rounded-lg border border-primary/30 bg-primary/10 px-3 py-2"
                    : "mr-auto max-w-[85%] rounded-lg border border-border bg-secondary px-3 py-2"
                }
              >
                <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {new Date(message.created_at).toLocaleString("en-AU", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <span>{message.message_kind}</span>
                  {message.direction === "outbound" && (
                    <>
                      <DeliveryBadge status={message.delivery_status} />
                      <FailureClassBadge failureClass={message.failure_class} />
                      {message.automation_stopped && (
                        <span className="text-destructive">Automation stopped</span>
                      )}
                      {message.message_source && <span>via {message.message_source}</span>}
                    </>
                  )}
                  {(message.failure_code ?? message.error_code) && (
                    <span className="text-destructive">
                      {message.failure_code ?? message.error_code}
                    </span>
                  )}
                </div>
                {message.direction === "outbound" && message.failure_reason && (
                  <p className="mt-1 text-[11px] text-destructive">
                    {message.failure_reason}
                    {message.failure_class === "permanent"
                      ? " Future automated SMS is suppressed for this lead."
                      : message.failure_class === "temporary"
                        ? " Temporary problem — no automatic retry was sent."
                        : ""}
                  </p>
                )}
              </div>
            ))}
          </div>

          <div className="border-t border-border p-4">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              rows={3}
              placeholder="Type your reply…"
              className="form-control min-h-24 py-2"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                {reply.length}/600 characters{fromAi ? " · AI draft (edited by you)" : ""}
              </span>
              <button
                disabled={reply.trim().length < 2 || sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" />
                {sendMutation.isPending ? "Sending…" : "Send SMS"}
              </button>
            </div>
            <SimulateReply onSubmit={(body) => simulateMutation.mutate(body)} />
          </div>
        </section>

        <div className="space-y-5">
          <ActivityPanel notifications={notifications} automationJobs={automationJobs} />

          <section className="panel p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">AI assistant</h2>
              <button
                onClick={() => analyseMutation.mutate()}
                disabled={analyseMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {analyseMutation.isPending ? "Analysing…" : "Analyse"}
              </button>
            </div>
            {!ai && (
              <p className="mt-3 text-xs text-muted-foreground">
                No analysis yet. Run Analyse to extract details, summarise and draft a reply for
                your approval.
              </p>
            )}
            {ai && (
              <div className="mt-3 space-y-3 text-sm">
                <p className="text-muted-foreground">{ai.summary}</p>
                <div className="flex flex-wrap gap-2">
                  <ReadinessBadge readiness={ai.readiness} />
                  {Array.isArray(ai.missing_fields) &&
                    (ai.missing_fields as string[]).map((field) => (
                      <span
                        key={field}
                        className="rounded-md border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning"
                      >
                        missing: {field}
                      </span>
                    ))}
                </div>
                {ai.suggested_reply && (
                  <div className="rounded-md border border-border bg-secondary/50 p-3">
                    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Bot className="h-3.5 w-3.5" /> Suggested reply — needs your approval
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm">{ai.suggested_reply}</p>
                    <button
                      onClick={() => {
                        setReply(ai.suggested_reply ?? "");
                        setFromAi(true);
                      }}
                      className="mt-2 rounded-md border border-input px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Use this draft
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="panel p-4">
            <h2 className="text-sm font-semibold">Lead details</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <Detail label="Vehicle" value={lead.vehicle_type} />
              <Detail label="Address" value={lead.service_address} />
              <Detail label="Suburb" value={lead.suburb} />
              <Detail label="Last cleaned" value={lead.last_cleaned_at} />
              <Detail label="Main concerns" value={lead.main_concerns} />
              <Detail label="Service intent" value={lead.service_intent} />
              <Detail label="Email" value={lead.email} />
              <Detail
                label="Next follow-up"
                value={
                  conversation?.next_follow_up_at
                    ? new Date(conversation.next_follow_up_at).toLocaleString("en-AU")
                    : "None scheduled"
                }
              />
            </dl>
            <NotesEditor leadId={leadId} initial={lead.notes ?? ""} onSaved={invalidate} />
          </section>

          <BookingPanel
            leadId={leadId}
            inboundMessages={(messages ?? [])
              .filter((message: { direction: string }) => message.direction === "inbound")
              .slice(-10)
              .reverse()}
            readOnly={data.role !== "owner"}
            onDone={invalidate}
          />

          <JobPanel
            leadId={leadId}
            job={job}
            services={services}
            onDone={invalidate}
            scheduleFn={scheduleJob}
          />
        </div>
      </div>
    </div>
  );
}

type NotificationRow = {
  id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

type AutomationJobRow = {
  id: string;
  job_type: string;
  step: number;
  status: string;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  failure_reason: string | null;
};

function when(value: string | null) {
  return value
    ? new Date(value).toLocaleString("en-AU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
}

function ActivityPanel({
  notifications,
  automationJobs,
}: {
  notifications: NotificationRow[];
  automationJobs: AutomationJobRow[];
}) {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Automation &amp; alerts</h2>
      <div className="mt-3 space-y-2">
        {notifications.length === 0 && automationJobs.length === 0 && (
          <p className="text-xs text-muted-foreground">No automation activity yet.</p>
        )}
        {notifications.map((item) => (
          <div
            key={item.id}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-2"
          >
            <p className="text-xs font-medium">{item.title}</p>
            <p className="mt-0.5 whitespace-pre-line text-[11px] text-muted-foreground">
              {item.body}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Owner alert · {when(item.created_at)} · {item.read_at ? "read" : "unread"}
            </p>
          </div>
        ))}
        {automationJobs.map((jobRow) => (
          <div key={jobRow.id} className="rounded-md border border-border px-2.5 py-2 text-[11px]">
            <p className="text-xs font-medium">
              {jobRow.job_type.replace(/_/g, " ")}
              {jobRow.step ? ` · step ${jobRow.step}` : ""}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {jobRow.status} · attempt {jobRow.attempt_count}/{jobRow.max_attempts}
              {jobRow.next_attempt_at ? ` · retry ${when(jobRow.next_attempt_at)}` : ""}
            </p>
            {jobRow.failure_reason && (
              <p className="mt-0.5 text-destructive">{jobRow.failure_reason}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value || "—"}</dd>
    </div>
  );
}

function NotesEditor({
  leadId,
  initial,
  onSaved,
}: {
  leadId: string;
  initial: string;
  onSaved: () => void;
}) {
  const patch = useServerFn(updateLead);
  const [notes, setNotes] = useState(initial);
  const mutation = useMutation({
    mutationFn: () => patch({ data: { leadId, notes } }),
    onSuccess: () => {
      toast.success("Notes saved");
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="mt-4">
      <label className="block text-xs text-muted-foreground">Internal notes</label>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="mt-2 rounded-md border border-input px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Save notes
      </button>
    </div>
  );
}

function SimulateReply({ onSubmit }: { onSubmit: (body: string) => void }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  return (
    <div className="mt-3 border-t border-border pt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          Test: simulate a customer reply
        </button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <input
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="e.g. Medium SUV, pet hair and odour"
            className="form-control min-w-0 flex-1 text-xs"
          />
          <button
            onClick={() => {
              onSubmit(body);
              setBody("");
              setOpen(false);
            }}
            disabled={body.trim().length === 0}
            className="rounded-md border border-input px-2.5 py-1.5 text-xs disabled:opacity-50"
          >
            Simulate inbound
          </button>
        </div>
      )}
    </div>
  );
}

type JobRow = {
  scheduled_at: string | null;
  completed_at: string | null;
  completed_value: number | null;
  completion_status: string;
  service_performed: string | null;
  notes: string | null;
} | null;

function JobPanel({
  leadId,
  job,
  services,
  onDone,
  scheduleFn,
}: {
  leadId: string;
  job: JobRow;
  services: { id: string; name: string; price_guidance: string | null }[];
  onDone: () => void;
  scheduleFn: typeof scheduleJob;
}) {
  const complete = useServerFn(recordCompletedJob);
  const schedule = useServerFn(scheduleFn);
  const [form, setForm] = useState({
    service_id: "",
    service_performed: job?.service_performed ?? "",
    completed_at: new Date().toISOString().slice(0, 10),
    completed_value: job?.completed_value ? String(job.completed_value) : "",
    notes: "",
  });
  const [scheduledAt, setScheduledAt] = useState(job?.scheduled_at?.slice(0, 16) ?? "");

  const completeMutation = useMutation({
    mutationFn: () =>
      complete({
        data: {
          leadId,
          service_id: form.service_id || null,
          service_performed:
            form.service_performed ||
            services.find((service) => service.id === form.service_id)?.name ||
            "Detailing service",
          completed_at: form.completed_at,
          completed_value: Number(form.completed_value),
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      toast.success("Completed job recorded");
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const scheduleMutation = useMutation({
    mutationFn: () => schedule({ data: { leadId, scheduled_at: scheduledAt } }),
    onSuccess: () => {
      toast.success("Job scheduled");
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const isCompleted = job?.completion_status === "completed";

  return (
    <section className="panel overflow-hidden">
      <h2 className="section-heading">Job & revenue</h2>
      <div className="p-4">
        {isCompleted ? (
          <div className="mt-3 rounded-md border border-success/40 bg-success/10 p-3 text-sm">
            <p className="font-medium text-success">
              Completed {formatCurrency(Number(job?.completed_value ?? 0))}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {job?.service_performed} ·{" "}
              {job?.completed_at ? new Date(job.completed_at).toLocaleDateString("en-AU") : ""}
            </p>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Scheduled (not counted as revenue)</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(event) => setScheduledAt(event.target.value)}
                  className="form-control min-w-0 flex-1 text-xs"
                />
                <button
                  disabled={!scheduledAt || scheduleMutation.isPending}
                  onClick={() => scheduleMutation.mutate()}
                  className="rounded-md border border-input px-2.5 py-1.5 text-xs disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted-foreground">Record completed job</p>
              <div className="mt-2 space-y-2">
                <select
                  value={form.service_id}
                  onChange={(event) => setForm({ ...form, service_id: event.target.value })}
                  className="form-control text-xs"
                >
                  <option value="">Service performed…</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                      {service.price_guidance ? ` (${service.price_guidance})` : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={form.completed_at}
                  onChange={(event) => setForm({ ...form, completed_at: event.target.value })}
                  className="form-control text-xs"
                />
                <input
                  inputMode="decimal"
                  value={form.completed_value}
                  onChange={(event) => setForm({ ...form, completed_value: event.target.value })}
                  placeholder="Final amount collected (AUD)"
                  className="form-control text-xs"
                />
                <input
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  placeholder="Notes (optional)"
                  className="form-control text-xs"
                />
                <button
                  disabled={
                    !form.completed_value ||
                    Number.isNaN(Number(form.completed_value)) ||
                    completeMutation.isPending
                  }
                  onClick={() => completeMutation.mutate()}
                  className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {completeMutation.isPending ? "Saving…" : "Mark job completed"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Read-only view of the mapped source metadata captured at import time. */
function ImportedSourcePanel({
  sourceMetadata,
  serviceIntent,
  vehicleType,
  suburb,
}: {
  sourceMetadata: Record<string, unknown> | null;
  serviceIntent: string | null;
  vehicleType: string | null;
  suburb: string | null;
}) {
  const meta = sourceMetadata ?? {};
  const importInfo = (meta["import"] ?? {}) as Record<string, unknown>;
  const original = originalSourceDetails(meta);
  const entries: [string, string][] = [
    ["Suburb", suburb ?? "—"],
    ["Vehicle", vehicleType ?? "—"],
    ["Service interest", serviceIntent ?? "—"],
    ["Import method", "CRM CSV"],
    ["Original channel", original.channel ?? "—"],
    ["Original platform", original.platform ?? "—"],
    ["Form name", original.form ?? "—"],
    ["Campaign", original.campaign ?? "—"],
    ["Original created date", original.createdAt ?? "—"],
    ["Import batch", String(importInfo["batch_id"] ?? "—")],
    ["Import row", String(importInfo["row_number"] ?? "—")],
  ];

  return (
    <section className="panel p-4" aria-label="Imported source">
      <h2 className="text-sm font-semibold">Imported source</h2>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 break-words text-xs">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Read-only transcript of the public AI quote conversation. These turns were
 * never sent as SMS; they are stored separately from the messaging thread.
 */
function WebChatTranscript({
  conversation,
  messages,
}: {
  conversation: {
    status: string;
    requires_owner_review: boolean;
    unsupported_request: string | null;
    service_name_snapshot: string | null;
    consent_outcome: string | null;
  };
  messages: { role: string; body: string; created_at: string }[];
}) {
  return (
    <section className="panel p-4" aria-label="AI quote conversation">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">AI quote conversation</h2>
        <span className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {conversation.status}
        </span>
        {conversation.requires_owner_review && (
          <span className="rounded-md border border-destructive px-2 py-0.5 text-[11px] text-destructive">
            Needs your review
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Captured on your public quote page. No SMS was sent from this conversation.
        {conversation.service_name_snapshot
          ? ` Requested service: ${conversation.service_name_snapshot}.`
          : ""}
        {conversation.unsupported_request
          ? ` Described request: “${conversation.unsupported_request}”.`
          : ""}
        {conversation.consent_outcome ? ` Consent: ${conversation.consent_outcome}.` : ""}
      </p>
      <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">No turns recorded.</p>
        )}
        {messages.map((message, index) => (
          <div
            key={`${index}-${message.created_at}`}
            className={message.role === "customer" ? "flex justify-end" : "flex justify-start"}
          >
            <p
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                message.role === "customer" ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}
            >
              {message.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
