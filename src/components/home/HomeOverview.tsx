import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Inbox,
  ListChecks,
  Lock,
  MessagesSquare,
  Sparkles,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getHomeSummary } from "@/lib/home.functions";
import { getOnboardingProgress } from "@/lib/onboarding.functions";
import { onboardingProgressLabel } from "@/lib/onboarding";
import { LEAD_STATUS_LABELS, formatCurrency, type LeadStatus } from "@/lib/domain";
import { saveAssistantDraft } from "@/lib/assistant-draft";
import { cn } from "@/lib/utils";

type Summary = Awaited<ReturnType<typeof getHomeSummary>>;

/**
 * Home: what needs the owner today, this week's numbers, the latest leads,
 * what's coming up, and (until finished) the setup checklist. Every figure is
 * read from saved data for this business only.
 */
export function HomeOverview() {
  const fetchSummary = useServerFn(getHomeSummary);
  const fetchProgress = useServerFn(getOnboardingProgress);
  const summary = useQuery({ queryKey: ["home-summary"], queryFn: () => fetchSummary(), refetchInterval: 2 * 60_000 });
  const progress = useQuery({ queryKey: ["onboarding-progress"], queryFn: () => fetchProgress(), retry: false });

  if (summary.isLoading) return <p className="py-16 text-center text-sm text-muted-foreground">Loading your day…</p>;
  if (summary.error || !summary.data) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-destructive">Home could not be loaded.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => summary.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const data = summary.data;
  const setup = progress.data && !progress.data.complete && progress.data.role === "owner" ? progress.data : null;
  const nextStep = setup?.steps.find((step) => !step.done && !step.blockedBy) ?? null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{greeting(data.businessName)}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Here's what's happening with your enquiries.</p>
      </div>

      <TodayCard data={data} nextStep={nextStep} />

      <section aria-labelledby="week-heading">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="week-heading" className="text-sm font-semibold">Last 7 days</h2>
          <Link to="/analytics" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            All results <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="New leads" value={String(data.week.enquiries)} />
          <Stat
            label="Answered within 5 minutes"
            value={data.week.enquiries ? `${Math.round(data.week.withinFiveMinutes * 100)}%` : "–"}
          />
          <Stat label="Booked" value={String(data.week.booked)} />
          <Stat label="Completed work" value={formatCurrency(data.week.completedRevenue)} />
        </dl>
      </section>

      <div className={cn("grid gap-5", setup ? "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]" : "lg:grid-cols-2")}>
        <Panel title="Latest leads" action={{ to: "/leads", label: "Open leads" }}>
          {data.latestLeads.length ? (
            <ul className="divide-y divide-border">
              {data.latestLeads.map((lead) => (
                <li key={lead.id}>
                  <Link
                    to="/leads/$leadId"
                    params={{ leadId: lead.id }}
                    className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/60"
                  >
                    <Initials name={lead.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{lead.name ?? "Unnamed lead"}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[lead.service, lead.suburb].filter(Boolean).join(" · ") || "No details yet"}
                      </span>
                    </span>
                    <LeadState needsReply={lead.needsReply} status={lead.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              text="New enquiries from your quote page, Facebook and other sources land here."
              action={{ to: "/import", label: "Bring in old customers" }}
            />
          )}
        </Panel>

        {setup ? (
          <SetupCard steps={setup.steps} />
        ) : (
          <Panel title="Coming up" action={{ to: "/bookings", label: "Open bookings" }}>
            <Bookings data={data} />
          </Panel>
        )}
      </div>

      {setup ? (
        <Panel title="Coming up" action={{ to: "/bookings", label: "Open bookings" }}>
          <Bookings data={data} />
        </Panel>
      ) : null}

      <AskAssistant />
    </div>
  );
}

function greeting(name: string | null) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name}` : part;
}

function TodayCard({
  data,
  nextStep,
}: {
  data: Summary;
  nextStep: { title: string; path: string; search?: Record<string, unknown>; hash?: string } | null;
}) {
  const items: Array<{ key: string; icon: typeof Inbox; text: string; to: string; label: string; search?: Record<string, unknown>; hash?: string; others?: Array<{ id: string; name: string | null }> }> = [];
  if (data.waiting.leads) {
    const first = data.waitingLeads[0];
    const firstName = first?.name?.trim().split(/\s+/)[0] ?? null;
    items.push({
      key: "leads",
      icon: Inbox,
      text:
        data.waiting.leads === 1 && firstName
          ? `${firstName} is waiting for your reply`
          : `${data.waiting.leads} ${data.waiting.leads === 1 ? "lead is" : "leads are"} waiting for your reply`,
      // Straight into the conversation, not the whole list.
      to: first ? `/leads/${first.id}` : "/leads",
      label: "Reply",
      ...(data.waitingLeads.length > 1 ? { others: data.waitingLeads } : {}),
    });
  }
  if (data.waiting.social) {
    items.push({
      key: "social",
      icon: MessagesSquare,
      text: `${data.waiting.social} Facebook or Instagram ${data.waiting.social === 1 ? "comment needs" : "comments need"} a reply`,
      to: "/social",
      label: "Review",
    });
  }
  if (nextStep) {
    items.push({ key: "setup", icon: ListChecks, text: `Next setup step: ${nextStep.title}`, to: nextStep.path, label: "Do it", ...(nextStep.search ? { search: nextStep.search } : {}), ...(nextStep.hash ? { hash: nextStep.hash } : {}) });
  }

  if (!items.length) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold">You're all caught up</p>
          <p className="text-xs text-muted-foreground">New enquiries get an instant text. We'll let you know when someone needs you.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="today-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
        <h2 id="today-heading" className="text-sm font-semibold">
          {items.length} {items.length === 1 ? "thing needs" : "things need"} you today
        </h2>
      </div>
      <ul className="divide-y divide-border">
        {items.map(({ key, icon: Icon, text, to, label, search, hash, others }) => (
          <li key={key} className="flex items-center gap-3 px-4 py-2.5">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 text-sm">
              {text}
              {others ? (
                <span className="mt-1 flex flex-wrap gap-1.5">
                  {others.map((lead) => (
                    <Link
                      key={lead.id}
                      to="/leads/$leadId"
                      params={{ leadId: lead.id }}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    >
                      {lead.name ?? "Unnamed lead"}
                    </Link>
                  ))}
                </span>
              ) : null}
            </span>
            <Button asChild size="sm" variant={key === items[0]?.key ? "default" : "outline"}>
              <Link to={to} {...(search ? { search } : {})} {...(hash ? { hash } : {})}>{label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1 text-2xl font-semibold">{value}</dd>
    </div>
  );
}

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: { to: "/leads" | "/bookings"; label: string };
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action ? (
          <Link to={action.to} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            {action.label} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Initials({ name }: { name: string | null }) {
  const letters = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold text-foreground">
      {letters || "?"}
    </span>
  );
}

function LeadState({ needsReply, status }: { needsReply: boolean; status: string | null }) {
  if (needsReply) {
    return <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Needs reply</span>;
  }
  const label = status ? (LEAD_STATUS_LABELS[status as LeadStatus] ?? status) : null;
  if (!label) return null;
  const booked = status === "scheduled" || status === "completed";
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", booked ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground")}>
      {label}
    </span>
  );
}

function Bookings({ data }: { data: Summary }) {
  if (!data.nextBookings.length) {
    return <Empty text="Booked jobs show up here so you can see the week ahead." />;
  }
  return (
    <ul className="divide-y divide-border">
      {data.nextBookings.map((job) => {
        const when = new Date(job.scheduledAt);
        return (
          <li key={job.id}>
            <Link to="/leads/$leadId" params={{ leadId: job.leadId }} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/60">
              <span className="grid w-11 shrink-0 place-items-center rounded-md border border-border py-1 text-center">
                <span className="text-[10px] font-medium uppercase text-muted-foreground">
                  {when.toLocaleDateString("en-AU", { weekday: "short" })}
                </span>
                <span className="text-sm font-semibold leading-none">{when.getDate()}</span>
                <span className="mt-0.5 text-[10px] text-muted-foreground">{when.toLocaleDateString("en-AU", { month: "short" })}</span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{job.name ?? "Customer"}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {when.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
                  {job.service ? ` · ${job.service}` : ""}
                </span>
              </span>
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SetupCard({
  steps,
}: {
  steps: Array<{ id: string; title: string; detail: string; path: string; done: boolean; blockedBy?: unknown; search?: Record<string, unknown>; hash?: string }>;
}) {
  const done = steps.filter((step) => step.done).length;
  return (
    <section aria-labelledby="setup-heading" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 id="setup-heading" className="text-sm font-semibold">Get set up</h2>
          <span className="text-xs text-muted-foreground">{onboardingProgressLabel(steps as never)}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round((done / Math.max(steps.length, 1)) * 100)}%` }} />
        </div>
      </div>
      <ol className="p-1.5">
        {steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.path}
              {...(step.search ? { search: step.search } : {})}
              {...(step.hash ? { hash: step.hash } : {})}
              className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-md px-2.5 py-2 hover:bg-secondary/60"
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 place-items-center rounded-full border",
                  step.done ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground",
                )}
              >
                {step.done ? <Check className="size-3" /> : step.blockedBy ? <Lock className="size-2.5" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm", step.done ? "text-muted-foreground line-through" : "font-medium")}>{step.title}</span>
                {!step.done ? (
                  <span className="block text-xs text-muted-foreground">
                    {step.blockedBy ? "Contact BookedSecure to unlock this step." : step.detail}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Empty({ text, action }: { text: string; action?: { to: "/import"; label: string } }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="mx-auto max-w-xs text-sm text-muted-foreground">{text}</p>
      {action ? (
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      ) : null}
    </div>
  );
}

function AskAssistant() {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim()) saveAssistantDraft(text.trim());
    navigate({ to: "/assistant" });
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2 rounded-xl border border-border bg-card p-2 pl-4">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <label htmlFor="home-ask" className="sr-only">Ask the assistant</label>
      <input
        id="home-ask"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Ask the assistant to text a lead, book a job or start a campaign"
        className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="sm">
        Ask <ArrowRight />
      </Button>
    </form>
  );
}
