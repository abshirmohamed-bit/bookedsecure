import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  Mail,
  OctagonX,
  PenLine,
  Repeat2,
  Search,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailPreview, formatDate, plural, SendDialog, Stat, StatusPill } from "@/components/campaigns/CampaignParts";
import { CampaignEditor } from "@/components/campaigns/CampaignEditor";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/app.functions";
import { ATTRIBUTION_DAYS } from "@/lib/email-campaigns";
import {
  getEmailCampaign,
  scheduleEmailCampaign,
  sendEmailCampaign,
  stopCampaignFollowUps,
  unscheduleEmailCampaign,
} from "@/lib/email-campaigns.functions";

export const Route = createFileRoute("/campaigns/$campaignId")({
  head: () => ({ meta: [{ title: "Campaign | BookedSecure" }] }),
  component: CampaignWorkspace,
});

type Campaign = Awaited<ReturnType<typeof getEmailCampaign>>;
type Tab = "campaign" | "people" | "progress";

function CampaignWorkspace() {
  const { campaignId } = Route.useParams();
  const fetchSession = useServerFn(getSession);
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession(), staleTime: 10 * 60_000 });
  const businessName = session.data?.business?.name ?? null;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>("campaign");
  const [sendOpen, setSendOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      setCampaign(await getEmailCampaign({ data: { campaignId } }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the campaign.");
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const people = useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = campaign?.recipients ?? [];
    return term ? list.filter((r) => `${r.name ?? ""} ${r.email}`.toLowerCase().includes(term)) : list;
  }, [campaign, query]);

  if (error) {
    return (
      <AppShell title="Campaign">
        <div className="mx-auto max-w-3xl p-6">
          <BackLink />
          <div className="glass mt-4 p-6 text-sm">{error}</div>
        </div>
      </AppShell>
    );
  }
  if (!campaign) {
    return (
      <AppShell title="Campaign">
        <div className="mx-auto max-w-6xl space-y-4 p-6">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-white/50" />
          <div className="h-64 animate-pulse rounded-2xl bg-white/40" />
        </div>
      </AppShell>
    );
  }

  const c = campaign;
  const reached = c.counts.sent;
  const rate = reached ? Math.round((c.counts.booked / reached) * 1000) / 10 : 0;

  return (
    <AppShell title={c.name}>
      <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        <BackLink />
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[28px] font-semibold leading-tight tracking-[-0.02em]">{c.name}</h1>
              <StatusPill status={c.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {c.status === "scheduled"
                ? `Sends ${formatDate(c.scheduledAt, true)}`
                : c.sentAt
                  ? `Sent ${formatDate(c.sentAt, true)}`
                  : `Created ${formatDate(c.createdAt)}`}
              {c.audienceLabel ? ` · ${c.audienceLabel}` : ""} · {plural(c.counts.total, "customer")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(c.status === "draft" || c.status === "scheduled") && !editing && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setTab("campaign");
                  setEditing(true);
                }}
              >
                <PenLine /> Edit email
              </Button>
            )}
            {c.status === "draft" && (
              <Button onClick={() => setSendOpen(true)} disabled={busy || c.counts.pending === 0}>
                <Send /> Send or schedule
              </Button>
            )}
            {c.status === "scheduled" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => run(() => unscheduleEmailCampaign({ data: { campaignId: c.id } }), "Moved back to drafts.")}
              >
                <CalendarClock /> Unschedule
              </Button>
            )}
            {c.counts.followUpsWaiting > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(`Stop ${plural(c.counts.followUpsWaiting, "follow-up")} that haven't gone out yet?`)) return;
                  void run(() => stopCampaignFollowUps({ data: { campaignId: c.id } }), "Follow-ups stopped.");
                }}
              >
                <OctagonX /> Stop follow-ups
              </Button>
            )}
          </div>
        </header>

        {!c.fromDeliverable && c.status !== "cancelled" && (
          <p className="glass flex items-center gap-2 px-4 py-3 text-sm text-warning-foreground">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            Your sending domain isn't verified yet, so these emails only reach your own inbox.
          </p>
        )}

        <div className="inline-flex rounded-xl border border-white/60 bg-white/40 p-1 backdrop-blur-xl" role="tablist">
          {(
            [
              ["campaign", "Campaign", Mail],
              ["people", `People ${c.counts.total}`, Users],
              ["progress", "Progress", CheckCircle2],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                tab === value ? "bg-white/90 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>

        {tab === "campaign" && editing && (
          <CampaignEditor
            campaign={c}
            businessName={businessName}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              void load();
            }}
          />
        )}

        {tab === "campaign" && !editing && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <SequenceLabel icon={<Mail className="size-3.5" />} title="First email" detail={c.sentAt ? `Sent ${formatDate(c.sentAt, true)}` : "Sends when you press Send"} />
              <EmailPreview businessName={businessName} fromAddress={c.fromAddress} subject={c.subject} bodyText={c.bodyText} label="First email" />
            </div>
            <div className="space-y-2">
              {c.followUp ? (
                <>
                  <SequenceLabel
                    icon={<Repeat2 className="size-3.5" />}
                    title={`Follow-up after ${plural(c.followUp.delayDays, "day")}`}
                    detail={c.followUp.stopOnBooking ? "Only to customers who haven't booked" : "To everyone who got the first email"}
                  />
                  <EmailPreview businessName={businessName} fromAddress={c.fromAddress} subject={c.followUp.subject} bodyText={c.followUp.bodyText} label="Follow-up" />
                </>
              ) : (
                <div className="glass flex h-full min-h-40 flex-col items-center justify-center gap-2 p-6 text-center">
                  <Repeat2 className="size-5 text-muted-foreground" />
                  <p className="text-sm font-medium">No follow-up</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {c.status === "draft" || c.status === "scheduled"
                      ? "Nudge customers who don't book with an automatic follow-up."
                      : "Add a follow-up when you create your next campaign to nudge customers who don't book."}
                  </p>
                  {(c.status === "draft" || c.status === "scheduled") && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                      <Repeat2 /> Add a follow-up
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "people" && (
          <section className="glass overflow-hidden">
            <div className="border-b border-white/60 p-3">
              <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" placeholder="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
            </div>
            <ul className="divide-y divide-white/60">
              {people.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">Nobody matches.</li>}
              {people.map((r) => (
                <li key={r.email} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-48">
                    {r.leadId ? (
                      <Link to="/leads/$leadId" params={{ leadId: r.leadId }} className="block truncate text-sm font-medium hover:text-primary">
                        {r.name ?? r.email}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium">{r.name ?? r.email}</p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">{r.email}</p>
                  </div>
                  <StepBadge label="First email" status={r.status} at={r.sentAt} error={r.error} />
                  {c.followUp && <StepBadge label="Follow-up" status={r.followUpStatus} at={r.followUpSentAt} error={r.followUpError} />}
                  {r.booked && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success-foreground">
                      <CheckCircle2 className="size-3" /> Booked
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {tab === "progress" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Emailed" value={`${c.counts.sent}/${c.counts.total}`} tone="primary" />
              <Stat label="Follow-ups sent" value={c.followUp ? c.counts.followUpsSent : "—"} tone="info" hint={c.counts.followUpsWaiting ? `${c.counts.followUpsWaiting} waiting` : undefined} />
              <Stat label="Booked after" value={c.counts.booked} tone="success" hint={`Within ${ATTRIBUTION_DAYS} days`} />
              <Stat label="Booking rate" value={`${rate}%`} tone="warning" />
            </div>
            <div className="glass space-y-3 p-4 sm:p-5">
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Funnel</h2>
              <Bar label="In the campaign" value={c.counts.total} max={c.counts.total} />
              <Bar label="Got the first email" value={c.counts.sent} max={c.counts.total} />
              {c.followUp && <Bar label="Got the follow-up" value={c.counts.followUpsSent} max={c.counts.total} />}
              <Bar label="Booked" value={c.counts.booked} max={c.counts.total} tone="success" />
              {(c.counts.failed > 0 || c.counts.skipped > 0) && (
                <p className="text-xs text-muted-foreground">
                  {c.counts.failed > 0 ? `${c.counts.failed} failed. ` : ""}
                  {c.counts.skipped > 0 ? `${c.counts.skipped} skipped because they unsubscribed.` : ""}
                </p>
              )}
            </div>
            <div className="glass p-4 sm:p-5">
              <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.01em]">Timeline</h2>
              <ol className="space-y-3 border-l border-foreground/10 pl-4">
                <TimelineItem done label="Draft created" at={c.createdAt} />
                {c.scheduledAt && <TimelineItem done={c.status !== "scheduled"} label="Scheduled send" at={c.scheduledAt} />}
                <TimelineItem done={Boolean(c.sentAt)} label={c.sentAt ? `First email sent to ${plural(c.counts.sent, "customer")}` : "First email not sent yet"} at={c.sentAt} />
                {c.followUp && (
                  <TimelineItem
                    done={c.counts.followUpsWaiting === 0 && Boolean(c.sentAt)}
                    label={
                      c.sentAt
                        ? `Follow-ups: ${c.counts.followUpsSent} sent${c.counts.followUpsWaiting ? `, ${c.counts.followUpsWaiting} due from ${formatDate(new Date(Date.parse(c.sentAt) + c.followUp.delayDays * 86_400_000).toISOString(), true)}` : ""}`
                        : `Follow-up goes ${plural(c.followUp.delayDays, "day")} after the first email`
                    }
                    at={null}
                  />
                )}
                <TimelineItem done={c.counts.booked > 0} label={`${plural(c.counts.booked, "booking")} from this campaign`} at={null} />
              </ol>
            </div>
          </div>
        )}
      </div>

      {sendOpen && (
        <SendDialog
          open
          name={c.name}
          recipients={c.counts.pending}
          followUpDays={c.followUp?.delayDays ?? null}
          fromDeliverable={c.fromDeliverable}
          onClose={() => setSendOpen(false)}
          onSendNow={() => {
            setSendOpen(false);
            void run(async () => {
              const result = await sendEmailCampaign({ data: { campaignId: c.id } });
              if (result.sent === 0 && result.failed > 0) throw new Error(`${result.failed} failed to send.`);
            }, "Campaign sent.");
          }}
          onSchedule={(at) => {
            setSendOpen(false);
            void run(() => scheduleEmailCampaign({ data: { campaignId: c.id, scheduledAt: at } }), `Scheduled for ${formatDate(at, true)}.`);
          }}
        />
      )}
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
      <ArrowLeft className="size-4" /> Campaigns
    </Link>
  );
}

function SequenceLabel({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="grid size-6 place-items-center rounded-full bg-primary/12 text-primary">{icon}</span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="truncate text-xs text-muted-foreground">· {detail}</p>
    </div>
  );
}

function StepBadge({ label, status, at, error }: { label: string; status: string | null; at: string | null; error: string | null }) {
  const map: Record<string, [string, string]> = {
    sent: ["Sent", "bg-primary/12 text-primary"],
    pending: [label === "Follow-up" ? "Waiting" : "Not sent", "bg-foreground/8 text-muted-foreground"],
    sending: ["Sending", "bg-info/20 text-info-foreground"],
    failed: ["Failed", "bg-destructive/12 text-destructive"],
    skipped: ["Skipped", "bg-warning/20 text-warning-foreground"],
  };
  const [text, style] = status ? (map[status] ?? [status, "bg-foreground/8 text-muted-foreground"]) : ["—", "text-muted-foreground"];
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" title={error ?? (at ? formatDate(at, true) : undefined)}>
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("rounded-full px-2 py-0.5 font-medium", style)}>{text}</span>
    </span>
  );
}

function Bar({ label, value, max, tone = "primary" }: { label: string; value: number; max: number; tone?: "primary" | "success" }) {
  const pct = max ? Math.max(value ? 3 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="tabular font-medium">{value}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/60">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500", tone === "success" ? "bg-success" : "bg-gradient-to-r from-[var(--primary-bright)] to-[var(--primary)]")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TimelineItem({ done, label, at }: { done: boolean; label: string; at: string | null }) {
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-[22px] top-0.5 grid size-3 place-items-center rounded-full border-2",
          done ? "border-primary bg-primary" : "border-foreground/25 bg-white",
        )}
      />
      <p className={cn("text-sm", !done && "text-muted-foreground")}>{label}</p>
      {at && (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="size-3" /> {formatDate(at, true)}
        </p>
      )}
    </li>
  );
}
