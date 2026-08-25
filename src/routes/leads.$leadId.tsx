import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { ArrowLeft, Bot, Pause, Play, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { DeliveryBadge, ReadinessBadge, StatusBadge } from "@/components/StatusBadge";
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
import { LEAD_STATUSES, LEAD_STATUS_LABELS, SOURCE_LABELS, formatCurrency } from "@/lib/domain";

export const Route = createFileRoute("/leads/$leadId")({
  head: () => ({
    meta: [
      { title: "Lead conversation — Glocast SMS Lead Response" },
      {
        name: "description",
        content:
          "Review the SMS conversation, AI summary and suggested reply for a Glocast detailing enquiry, and record the completed job.",
      },
      { property: "og:title", content: "Lead conversation — Glocast SMS Lead Response" },
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

  const { lead, messages, conversation, ai, job, services } = data;

  return (
    <div className="space-y-5">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to leads
      </Link>

      <header className="panel grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-4 sm:flex sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold">{lead.name}</h1>
            <StatusBadge status={lead.status} />
            <ReadinessBadge readiness={lead.readiness_classification} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {lead.mobile_number} · {SOURCE_LABELS[lead.source_channel] ?? lead.source_channel}
            {lead.source_campaign ? ` · ${lead.source_campaign}` : ""} ·{" "}
            {new Date(lead.created_at).toLocaleString("en-AU")}
          </p>
          {lead.opted_out_at && (
            <p className="mt-1 text-xs text-destructive">
              Opted out {new Date(lead.opted_out_at).toLocaleString("en-AU")} — automated SMS blocked.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={lead.status}
            onChange={(event) => statusMutation.mutate(event.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1.5 text-xs"
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="panel flex flex-col">
          <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Conversation</h2>
          <div className="max-h-[520px] space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">No messages yet.</p>
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
                    <DeliveryBadge status={message.delivery_status} />
                  )}
                  {message.error_code && (
                    <span className="text-destructive">{message.error_code}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-border p-4">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              rows={3}
              placeholder="Type your reply…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
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
                No analysis yet. Run Analyse to extract details, summarise and draft a reply for your
                approval.
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
            className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
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
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Job & revenue</h2>
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
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
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
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
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
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
              />
              <input
                inputMode="decimal"
                value={form.completed_value}
                onChange={(event) => setForm({ ...form, completed_value: event.target.value })}
                placeholder="Final amount collected (AUD)"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
              />
              <input
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                placeholder="Notes (optional)"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
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
    </section>
  );
}
