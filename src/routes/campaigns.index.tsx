import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowRight, CalendarClock, ChevronRight, Inbox, Mail, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CampaignComposer } from "@/components/campaigns/CampaignComposer";
import { CAMPAIGN_AUDIENCES, type CampaignAudienceId } from "@/lib/email-campaigns";
import { OutreachProgress, OutreachTabs } from "@/components/campaigns/CampaignsTabs";
import { formatDate, plural, SendDialog, StatusPill } from "@/components/campaigns/CampaignParts";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/app.functions";
import {
  cancelEmailCampaign,
  getEmailCampaigns,
  scheduleEmailCampaign,
  sendEmailCampaign,
  unscheduleEmailCampaign,
} from "@/lib/email-campaigns.functions";

export const Route = createFileRoute("/campaigns/")({
  head: () => ({
    meta: [
      { title: "Campaigns | BookedSecure" },
      {
        name: "description",
        content:
          "Email campaigns with follow-ups: write with AI, pick an audience, send now or schedule. Unsubscribed customers are always skipped.",
      },
      { property: "og:title", content: "Email campaigns | BookedSecure" },
      { property: "og:description", content: "Draft, schedule and send email campaigns with follow-ups." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // ?tab=replies opens the replies inbox; &thread=<recipient> opens one conversation.
  // ?leads=<ids> (from Leads) or ?audience=<id> (from Lead finder) opens a new campaign with them.
  validateSearch: (search: Record<string, unknown>): { tab?: "replies"; thread?: string; leads?: string; audience?: CampaignAudienceId } => ({
    ...(search["tab"] === "replies" ? { tab: "replies" as const } : {}),
    ...(typeof search["thread"] === "string" && /^[0-9a-f-]{36}$/i.test(search["thread"]) ? { thread: search["thread"] } : {}),
    ...(typeof search["leads"] === "string" && /^[0-9a-f-]{36}(,[0-9a-f-]{36}){0,199}$/i.test(search["leads"]) ? { leads: search["leads"] } : {}),
    ...(typeof search["audience"] === "string" && CAMPAIGN_AUDIENCES.some((a) => a.id === search["audience"]) ? { audience: search["audience"] as CampaignAudienceId } : {}),
  }),
  component: CampaignsPage,
});

type Campaign = Awaited<ReturnType<typeof getEmailCampaigns>>[number];

function CampaignsPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  // Older links (?tab=replies) now open the Replies page under Campaigns.
  useEffect(() => {
    if (search.tab === "replies") void navigate({ to: "/campaigns/replies", search: search.thread ? { thread: search.thread } : {}, replace: true });
  }, [search.tab, search.thread, navigate]);
  const fetchSession = useServerFn(getSession);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: () => fetchSession(),
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  const businessName = session.data?.business?.name ?? null;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(Boolean(search.leads || search.audience));
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Campaign | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await getEmailCampaigns();
      setCampaigns(list);
      setLoadError(false);
      return list;
    } catch {
      setLoadError(true);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stats = useMemo(() => {
    const live = campaigns.filter((c) => c.status === "draft" || c.status === "scheduled").length;
    const emailsSent = campaigns.reduce((sum, c) => sum + c.counts.sent + c.counts.followUpsSent, 0);
    const booked = campaigns.reduce((sum, c) => sum + c.counts.booked, 0);
    const reached = campaigns.reduce((sum, c) => sum + c.counts.sent, 0);
    const replied = campaigns.reduce((sum, c) => sum + c.counts.replied, 0);
    const pct = (n: number) => (reached ? Math.round((n / reached) * 1000) / 10 : 0);
    return { live, emailsSent, booked, replied, replyRate: pct(replied), rate: pct(booked) };
  }, [campaigns]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function sendNow(campaign: Campaign) {
    setSendTarget(null);
    setBusy(true);
    try {
      const result = await sendEmailCampaign({ data: { campaignId: campaign.id } });
      toast.success(
        `Sent ${plural(result.sent, "email")}` +
          (result.failed > 0 ? `, ${result.failed} failed` : "") +
          (result.skipped > 0 ? `, ${result.skipped} unsubscribed skipped` : ""),
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the campaign.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaved(campaignId: string, andSend: boolean) {
    setComposing(false);
    const list = await refresh();
    if (andSend) {
      const saved = list?.find((c) => c.id === campaignId);
      if (saved) setSendTarget(saved);
    }
  }

  return (
    <AppShell title="Campaigns">
      <div className="mx-auto max-w-6xl space-y-4 md:p-6">
        <header className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Campaigns</h1>
              <p className="text-sm text-muted-foreground">
                Email your customers, with an automatic follow-up for anyone who doesn't book.
              </p>
            </div>
            <Button onClick={() => setComposing(true)} className="shrink-0 max-sm:hidden">
              <Plus /> New campaign
            </Button>
          </div>
          <OutreachTabs active="campaigns" />
        </header>
        <OutreachProgress />

        <section aria-labelledby="your-campaigns" className="glass overflow-hidden">
          {/* Metrics live in the card header instead of a separate row of tiles. */}
          <div className="grid grid-cols-2 border-b border-white/60 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Drafts and scheduled" value={stats.live} dot="bg-warning" loading={loading} />
            <Metric label="Emails sent" value={stats.emailsSent} dot="bg-primary" loading={loading} />
            <Metric label="Replied" value={stats.replied} dot="bg-primary" loading={loading} />
            <Metric label="Reply rate" value={`${stats.replyRate}%`} dot="bg-info" loading={loading} />
            <Metric label="Booked after an email" value={stats.booked} dot="bg-success" loading={loading} />
            <Metric label="Booking rate" value={`${stats.rate}%`} dot="bg-info" loading={loading} />
          </div>
          <h2 id="your-campaigns" className="sr-only">
            Your campaigns
          </h2>

          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-white/50" />
              ))}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
              <AlertTriangle className="size-5 text-warning" />
              <p className="text-sm">Your campaigns couldn't be loaded.</p>
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
                Try again
              </Button>
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <span className="grid size-12 place-items-center rounded-2xl bg-white/75 text-primary shadow-[inset_0_1px_0_white]">
                <Mail className="size-5" />
              </span>
              <div>
                <p className="font-medium">No campaigns yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Write an email, or let AI draft it, pick your customers, and send now or schedule it.
                </p>
              </div>
              <Button onClick={() => setComposing(true)}>
                <Plus /> Create your first campaign
              </Button>
            </div>
          ) : (
            <CampaignTable
              campaigns={campaigns}
              busy={busy}
              onOpen={(c) => navigate({ to: "/campaigns/$campaignId", params: { campaignId: c.id } })}
              onSend={setSendTarget}
              onCancel={setCancelTarget}
              onUnschedule={(c) => run(() => unscheduleEmailCampaign({ data: { campaignId: c.id } }), "Moved back to drafts.")}
            />
          )}
        </section>
      </div>

      {/* On a phone the main action sits at the thumb, above the safe area. */}
      {!composing && campaigns.length > 0 && (
        <Button
          onClick={() => setComposing(true)}
          className="btn-glow fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 h-12 rounded-full px-5 shadow-lg sm:hidden"
        >
          <Plus /> New campaign
        </Button>
      )}

      {composing && (
        <CampaignComposer
          businessName={businessName}
          onClose={() => { setComposing(false); if (search.leads || search.audience) void navigate({ to: "/campaigns", search: {}, replace: true }); }}
          onSaved={onSaved}
          initialAudience={search.audience}
          initialLeadIds={search.leads ? search.leads.split(",") : undefined}
        />
      )}

      {sendTarget && (
        <SendDialog
          open
          name={sendTarget.name}
          recipients={sendTarget.counts.pending}
          followUpDays={sendTarget.followUp?.delayDays ?? null}
          fromDeliverable={sendTarget.fromDeliverable}
          onClose={() => setSendTarget(null)}
          onSendNow={() => sendNow(sendTarget)}
          onSchedule={(at) => {
            const target = sendTarget;
            setSendTarget(null);
            void run(
              () => scheduleEmailCampaign({ data: { campaignId: target.id, scheduledAt: at } }),
              `Scheduled for ${formatDate(at, true)}.`,
            );
          }}
        />
      )}

      <AlertDialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel "{cancelTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>The draft will be cancelled and nothing will be sent.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive !bg-none text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const target = cancelTarget;
                setCancelTarget(null);
                if (target) void run(() => cancelEmailCampaign({ data: { campaignId: target.id } }), "Draft cancelled.");
              }}
            >
              Cancel draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Metric({ label, value, dot, loading }: { label: string; value: number | string; dot: string; loading?: boolean }) {
  return (
    <div className="border-white/60 px-4 py-3 odd:border-r sm:border-r sm:last:border-r-0 [&:nth-child(-n+2)]:border-b sm:[&:nth-child(-n+2)]:border-b-0">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </p>
      {loading ? (
        <span className="mt-1 block h-6 w-10 animate-pulse rounded-md bg-white/60" aria-label="Loading" />
      ) : (
        <p className="tabular text-xl font-semibold tracking-[-0.02em]">{value}</p>
      )}
    </div>
  );
}

function CampaignTable({
  campaigns,
  busy,
  onOpen,
  onSend,
  onCancel,
  onUnschedule,
}: {
  campaigns: Campaign[];
  busy: boolean;
  onOpen: (c: Campaign) => void;
  onSend: (c: Campaign) => void;
  onCancel: (c: Campaign) => void;
  onUnschedule: (c: Campaign) => void;
}) {
  const actions = (c: Campaign) =>
    c.status === "draft" ? (
      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => onSend(c)} disabled={busy || c.counts.pending === 0}>
          <Send /> Send
        </Button>
        <Button size="icon-sm" variant="outline" onClick={() => onCancel(c)} disabled={busy} aria-label={`Cancel ${c.name}`} title="Cancel draft">
          <Trash2 />
        </Button>
      </div>
    ) : c.status === "scheduled" ? (
      <div onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={() => onUnschedule(c)} disabled={busy}>
          <CalendarClock /> Unschedule
        </Button>
      </div>
    ) : null;

  const when = (c: Campaign) =>
    c.status === "scheduled" ? `Sends ${formatDate(c.scheduledAt, true)}` : formatDate(c.sentAt ?? c.createdAt);
  const warn = (c: Campaign) => !c.fromDeliverable && c.status !== "cancelled";

  return (
    <>
      <table className="hidden w-full table-fixed text-sm md:table">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-white/60">
            <th className="w-[36%] px-5 py-2.5 font-medium">Campaign</th>
            <th className="w-[12%] px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 text-right font-medium">Sent</th>
            <th className="px-3 py-2.5 text-right font-medium">Follow-ups</th>
            <th className="px-3 py-2.5 text-right font-medium">Replies</th>
            <th className="px-3 py-2.5 text-right font-medium">Booked</th>
            <th className="w-[13%] px-3 py-2.5 font-medium">Date</th>
            <th className="w-[16%] px-5 py-2.5" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-white/60">
          {campaigns.map((c) => (
            <tr key={c.id} onClick={() => onOpen(c)} className="cursor-pointer transition-colors hover:bg-white/40">
              <td className="px-5 py-3">
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {warn(c) && (
                    <span title="Sending domain not verified: emails only reach your own inbox">
                      <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Sending domain not verified" />
                    </span>
                  )}
                  <span className="truncate">{c.name}</span>
                </p>
                <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
              </td>
              <td className="px-3 py-3">
                <StatusPill status={c.status} />
              </td>
              <td className="tabular px-3 py-3 text-right">
                {c.counts.sent}
                <span className="text-muted-foreground">/{c.counts.total}</span>
                {c.counts.failed > 0 && <span className="block text-[11px] text-destructive">{c.counts.failed} failed</span>}
              </td>
              <td className="tabular px-3 py-3 text-right">
                {c.followUp ? (
                  <>
                    {c.counts.followUpsSent}
                    {c.counts.followUpsWaiting > 0 && <span className="block text-[11px] text-muted-foreground">{c.counts.followUpsWaiting} waiting</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="tabular px-3 py-3 text-right">
                {c.counts.replied > 0 ? (
                  <Link
                    to="/campaigns/replies"
                    search={{ campaign: c.id }}
                    onClick={(e) => e.stopPropagation()}
                    className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-white/70", c.counts.unreadReplies > 0 ? "font-semibold text-primary" : "text-foreground")}
                    title={c.counts.unreadReplies > 0 ? `${c.counts.unreadReplies} new` : "Read replies"}
                  >
                    {c.counts.unreadReplies > 0 && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
                    {c.counts.replied}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </td>
              <td className={cn("tabular px-3 py-3 text-right", c.counts.booked > 0 && "font-semibold text-success-foreground")}>{c.counts.booked}</td>
              <td className="px-3 py-3 text-xs text-muted-foreground">{when(c)}</td>
              <td className="px-5 py-3">
                <div className="flex items-center justify-end gap-2">
                  {actions(c)}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-white/60 pb-16 sm:pb-0 md:hidden">
        {campaigns.map((c) => (
          <li key={c.id} className="min-w-0 px-4 py-3.5">
            <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="block">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {warn(c) && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Sending domain not verified" />}
                    <span className="truncate">{c.name}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <p className="tabular mt-1 text-xs text-muted-foreground">
                {c.counts.sent}/{c.counts.total} sent
                {c.followUp ? ` · ${c.counts.followUpsSent} follow-ups` : ""} · {c.counts.booked} booked · {when(c)}
              </p>
            </Link>
            <div className="mt-2 flex items-center justify-between gap-2">
              {actions(c)}
              {c.counts.replied > 0 && (
                <Link
                  to="/campaigns/replies"
                  search={{ campaign: c.id }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                    c.counts.unreadReplies > 0 ? "bg-primary text-primary-foreground" : "bg-white/70 text-primary",
                  )}
                >
                  <Inbox className="size-3.5" /> {plural(c.counts.replied, "reply", "replies")}
                  {c.counts.unreadReplies > 0 ? ` · ${c.counts.unreadReplies} new` : ""}
                </Link>
              )}
              <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary">
                Open <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
