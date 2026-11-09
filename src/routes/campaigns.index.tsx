import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Mail,
  PenLine,
  Plus,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { EmailPreview, formatDate, plural, SendDialog, Stat, StatusPill } from "@/components/campaigns/CampaignParts";
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/app.functions";
import { CAMPAIGN_TEMPLATES, initials } from "@/lib/campaign-templates";
import { CAMPAIGN_AUDIENCES, type CampaignAudienceId } from "@/lib/email-campaigns";
import {
  cancelEmailCampaign,
  createEmailCampaign,
  draftCampaignEmail,
  getCampaignAudience,
  getEmailCampaigns,
  scheduleEmailCampaign,
  searchCampaignLeads,
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
  component: CampaignsPage,
});

type Campaign = Awaited<ReturnType<typeof getEmailCampaigns>>[number];
type LeadOption = Awaited<ReturnType<typeof searchCampaignLeads>>[number];
type EmailTab = "first" | "follow_up";

const AI_CHIPS = ["Keep it short", "Mention our offer", "Ask for a reply", "Casual tone", "Professional tone", "No discounts"];
const DELAYS = [2, 3, 5, 7, 14];

function CampaignsPage() {
  const navigate = useNavigate();
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
  const [busy, setBusy] = useState(false);
  const [sendTarget, setSendTarget] = useState<Campaign | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Campaign | null>(null);
  const composerRef = useRef<HTMLElement>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [followUpOn, setFollowUpOn] = useState(false);
  const [followSubject, setFollowSubject] = useState("");
  const [followBody, setFollowBody] = useState("");
  const [delayDays, setDelayDays] = useState(3);
  const [stopOnBooking, setStopOnBooking] = useState(true);
  const [emailTab, setEmailTab] = useState<EmailTab>("first");
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstructions, setAiInstructions] = useState("");
  const [aiChips, setAiChips] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);

  const [leadQuery, setLeadQuery] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [hideNoEmail, setHideNoEmail] = useState(true);
  const [selected, setSelected] = useState<Map<string, LeadOption>>(new Map());
  const [audienceLabel, setAudienceLabel] = useState<string | null>(null);
  const [audienceBusy, setAudienceBusy] = useState<CampaignAudienceId | null>(null);
  const [mobileView, setMobileView] = useState<"write" | "preview">("write");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setCampaigns(await getEmailCampaigns());
    } catch {
      toast.error("Could not load email campaigns.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        setLeadOptions(await searchCampaignLeads({ data: { query: leadQuery } }));
      } catch {
        // Search is best-effort; the selected recipients stay put.
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [leadQuery]);

  const visibleOptions = useMemo(
    () => (hideNoEmail ? leadOptions.filter((lead) => lead.email) : leadOptions),
    [hideNoEmail, leadOptions],
  );
  const hiddenCount = leadOptions.length - visibleOptions.length;
  const selectable = visibleOptions.filter((lead) => lead.email && !selected.has(lead.id));

  const stats = useMemo(() => {
    const live = campaigns.filter((c) => c.status === "draft" || c.status === "scheduled").length;
    const emailsSent = campaigns.reduce((sum, c) => sum + c.counts.sent + c.counts.followUpsSent, 0);
    const booked = campaigns.reduce((sum, c) => sum + c.counts.booked, 0);
    const reached = campaigns.reduce((sum, c) => sum + c.counts.sent, 0);
    return { live, emailsSent, booked, rate: reached ? Math.round((booked / reached) * 1000) / 10 : 0 };
  }, [campaigns]);

  const firstReady = Boolean(subject.trim() && bodyText.trim());
  const followReady = !followUpOn || Boolean(followSubject.trim() && followBody.trim());
  const canSave = Boolean(name.trim() && firstReady && followReady && selected.size > 0);
  const steps = [
    { label: "Emails", done: firstReady && followReady },
    { label: "Customers", done: selected.size > 0 },
    { label: "Save", done: false },
  ];

  function toggleLead(lead: LeadOption) {
    if (!lead.email) return;
    setAudienceLabel(null);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, lead);
      return next;
    });
  }

  function addLeads(leads: LeadOption[]) {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const lead of leads) if (lead.email && next.size < 500) next.set(lead.id, lead);
      return next;
    });
  }

  async function pickAudience(id: CampaignAudienceId, label: string) {
    setAudienceBusy(id);
    try {
      const leads = await getCampaignAudience({ data: { audience: id } });
      if (leads.length === 0) {
        toast.info(`No customers with an email in "${label}".`);
        return;
      }
      setSelected(new Map());
      addLeads(leads);
      setAudienceLabel(label);
      toast.success(`${plural(Math.min(leads.length, 500), "customer")} selected from "${label}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load that audience.");
    } finally {
      setAudienceBusy(null);
    }
  }

  function applyTemplate(id: string) {
    const template = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    if (bodyText.trim() && !window.confirm("Replace what you've written with this starter?")) return;
    setName((current) => current.trim() || template.name);
    setSubject(template.subject);
    setBodyText(template.body(businessName));
  }

  async function writeWithAi() {
    if (emailTab === "follow_up" && !firstReady) {
      toast.error("Write the first email before the follow-up.");
      return;
    }
    const current = emailTab === "first" ? bodyText : followBody;
    if (current.trim() && !window.confirm("Replace what you've written with the AI's version?")) return;
    setAiBusy(true);
    try {
      const draft = await draftCampaignEmail({
        data: {
          kind: emailTab,
          instructions: aiInstructions,
          chips: aiChips,
          firstEmail: emailTab === "follow_up" ? { subject, bodyText } : null,
        },
      });
      if (emailTab === "first") {
        setSubject(draft.subject);
        setBodyText(draft.bodyText);
        setName((n) => n.trim() || draft.subject.slice(0, 60));
      } else {
        setFollowSubject(draft.subject);
        setFollowBody(draft.bodyText);
      }
      toast.success("Draft written. Read it through and make it yours.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI could not write the email.");
    } finally {
      setAiBusy(false);
    }
  }

  function startNew() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => composerRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 350);
  }

  function resetComposer() {
    setName("");
    setSubject("");
    setBodyText("");
    setFollowUpOn(false);
    setFollowSubject("");
    setFollowBody("");
    setSelected(new Map());
    setAudienceLabel(null);
    setEmailTab("first");
    setMobileView("write");
  }

  async function onCreate() {
    if (selected.size === 0) {
      toast.error("Pick at least one customer to email.");
      return;
    }
    setBusy(true);
    try {
      const result = await createEmailCampaign({
        data: {
          name,
          subject,
          bodyText,
          fromAddress: fromAddress || null,
          leadIds: [...selected.keys()],
          followUp: followUpOn ? { subject: followSubject, bodyText: followBody, delayDays, stopOnBooking } : null,
          audienceLabel,
        },
      });
      toast.success(
        `Draft saved for ${plural(result.emailable, "customer")}` +
          (result.skippedUnsubscribed > 0 ? ` (${result.skippedUnsubscribed} unsubscribed skipped)` : "") +
          (result.skippedNoEmail > 0 ? ` (${result.skippedNoEmail} without an email skipped)` : ""),
      );
      if (!result.fromDeliverable) {
        toast.warning("Emails will only reach your own inbox until your sending domain is verified with the email provider.");
      }
      resetComposer();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

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

  const activeSubject = emailTab === "first" ? subject : followSubject;
  const activeBody = emailTab === "first" ? bodyText : followBody;

  return (
    <AppShell title="Campaigns">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Email your customers with an automatic follow-up. Nothing is sent until you press Send or schedule it.
            </p>
          </div>
          <Button onClick={startNew}>
            <Plus /> New campaign
          </Button>
        </header>

        <section aria-label="Campaign performance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Drafts and scheduled" value={stats.live} tone="warning" />
          <Stat label="Emails sent" value={stats.emailsSent} tone="primary" hint="Includes follow-ups" />
          <Stat label="Booked after an email" value={stats.booked} tone="success" hint="Within 30 days" />
          <Stat label="Booking rate" value={`${stats.rate}%`} tone="info" hint="Of customers emailed" />
        </section>

        <section aria-labelledby="your-campaigns" className="glass overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/60 px-4 py-3 sm:px-5">
            <h2 id="your-campaigns" className="text-[17px] font-semibold tracking-[-0.01em]">
              Your campaigns
            </h2>
            <span className="text-xs text-muted-foreground">
              {campaigns.length ? plural(campaigns.length, "campaign") : ""}
            </span>
          </div>
          {loading ? (
            <div className="space-y-2 p-4">
              {[0, 1].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/50" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="grid size-11 place-items-center rounded-2xl bg-white/70 text-primary shadow-[inset_0_1px_0_white]">
                <Mail className="size-5" />
              </span>
              <p className="font-medium">No campaigns yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Write your first email below. It's saved as a draft so you can check it before anything goes out.
              </p>
            </div>
          ) : (
            <CampaignTable
              campaigns={campaigns}
              busy={busy}
              onOpen={(c) => navigate({ to: "/campaigns/$campaignId", params: { campaignId: c.id } })}
              onSend={setSendTarget}
              onCancel={setCancelTarget}
              onUnschedule={(c) =>
                run(() => unscheduleEmailCampaign({ data: { campaignId: c.id } }), "Moved back to drafts.")
              }
            />
          )}
        </section>

        <section ref={composerRef} aria-labelledby="new-campaign" className="scroll-mt-20 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="new-campaign" className="text-[21px] font-semibold tracking-[-0.02em]">
              New email campaign
            </h2>
            <ol className="flex items-center gap-1.5 text-xs" aria-label="Steps">
              {steps.map((step, index) => (
                <li key={step.label} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                      step.done ? "bg-primary text-primary-foreground" : "bg-white/70 text-muted-foreground shadow-[inset_0_1px_0_white]",
                    )}
                  >
                    {step.done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className={step.done ? "font-medium text-foreground" : "text-muted-foreground"}>{step.label}</span>
                  {index < steps.length - 1 && <span className="mx-1 h-px w-4 bg-foreground/15" />}
                </li>
              ))}
            </ol>
          </div>

          <Segmented
            className="lg:hidden"
            value={mobileView}
            onChange={setMobileView}
            options={[
              { value: "write", label: "Write", icon: <PenLine className="size-4" /> },
              { value: "preview", label: "Preview", icon: <Eye className="size-4" /> },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className={cn("min-w-0 space-y-4", mobileView === "preview" && "hidden lg:block")}>
              <div className="glass space-y-4 p-4 sm:p-5">
                <StepTitle number={1} title="Write the emails" hint="A first email, plus an optional follow-up for customers who don't book." />
                <Field label="Campaign name" hint="Only you see this">
                  <Input placeholder="e.g. Spring special" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>

                <Segmented
                  value={emailTab}
                  onChange={setEmailTab}
                  options={[
                    { value: "first", label: "First email", icon: <Mail className="size-4" /> },
                    {
                      value: "follow_up",
                      label: followUpOn ? `Follow-up · ${delayDays}d` : "Follow-up",
                      icon: <Repeat2 className="size-4" />,
                    },
                  ]}
                />

                {emailTab === "follow_up" && (
                  <div className="space-y-3 rounded-xl border border-white/60 bg-white/40 p-3">
                    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
                      Send a follow-up
                      <Toggle checked={followUpOn} onChange={setFollowUpOn} label="Send a follow-up" />
                    </label>
                    {followUpOn && (
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-muted-foreground">after</span>
                        <div className="flex gap-1">
                          {DELAYS.map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setDelayDays(d)}
                              className={cn(
                                "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                                delayDays === d ? "bg-primary text-primary-foreground" : "bg-white/60 hover:bg-white/90",
                              )}
                            >
                              {d} days
                            </button>
                          ))}
                        </div>
                        <label className="flex w-full cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            className="size-4 accent-[var(--primary)]"
                            checked={stopOnBooking}
                            onChange={(e) => setStopOnBooking(e.target.checked)}
                          />
                          Skip customers who book after the first email
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {(emailTab === "first" || followUpOn) && (
                  <>
                    <div className="rounded-xl border border-white/60 bg-gradient-to-br from-white/60 to-white/30">
                      <button
                        type="button"
                        onClick={() => setAiOpen((o) => !o)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium"
                        aria-expanded={aiOpen}
                      >
                        <span className="flex items-center gap-2">
                          <span className="grid size-6 place-items-center rounded-lg bg-primary/12 text-primary">
                            <Wand2 className="size-3.5" />
                          </span>
                          Write it with AI
                        </span>
                        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", aiOpen && "rotate-180")} />
                      </button>
                      {aiOpen && (
                        <div className="space-y-3 border-t border-white/60 p-3">
                          <Textarea
                            rows={3}
                            maxLength={2000}
                            placeholder={
                              emailTab === "first"
                                ? "What's the email about? e.g. We have openings next week, $20 off interior cleans until Friday."
                                : "Anything to add? e.g. Remind them the offer ends Friday."
                            }
                            value={aiInstructions}
                            onChange={(e) => setAiInstructions(e.target.value)}
                          />
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Frequently added</p>
                            <div className="flex flex-wrap gap-1.5">
                              {AI_CHIPS.map((chip) => {
                                const on = aiChips.includes(chip);
                                return (
                                  <button
                                    key={chip}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => setAiChips((prev) => (on ? prev.filter((c) => c !== chip) : [...prev, chip]))}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                                      on ? "border-primary/40 bg-primary/12 text-primary" : "border-white/70 bg-white/55 hover:bg-white/90",
                                    )}
                                  >
                                    {on ? <Check className="size-3" /> : <Plus className="size-3" />}
                                    {chip}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <Button size="sm" onClick={writeWithAi} disabled={aiBusy}>
                            {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                            {aiBusy ? "Writing…" : emailTab === "first" ? "Write the email" : "Write the follow-up"}
                          </Button>
                        </div>
                      )}
                    </div>

                    {emailTab === "first" && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">Or start from</span>
                        {CAMPAIGN_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => applyTemplate(template.id)}
                            className="rounded-full border border-white/70 bg-white/55 px-3 py-1 text-xs font-medium shadow-[inset_0_1px_0_white] transition-colors hover:bg-white/90 hover:text-primary"
                          >
                            {template.label}
                          </button>
                        ))}
                      </div>
                    )}

                    <Field label="Subject line">
                      <Input
                        placeholder="What customers see in their inbox"
                        value={activeSubject}
                        onChange={(e) => (emailTab === "first" ? setSubject : setFollowSubject)(e.target.value)}
                        maxLength={160}
                      />
                    </Field>
                    <Field label={emailTab === "first" ? "Email" : "Follow-up email"} hint={`${activeBody.length} / 5000`}>
                      <Textarea
                        placeholder={emailTab === "first" ? "Write the email in your own words..." : "A short nudge for customers who haven't booked..."}
                        value={activeBody}
                        onChange={(e) => (emailTab === "first" ? setBodyText : setFollowBody)(e.target.value)}
                        rows={emailTab === "first" ? 8 : 6}
                        maxLength={5000}
                      />
                    </Field>
                  </>
                )}

                <details className="group rounded-xl border border-white/60 bg-white/35 px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                    Sender address
                    <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-2 pb-1 pt-3">
                    <Input
                      placeholder="hello@yourbusiness.com.au (optional)"
                      value={fromAddress}
                      onChange={(e) => setFromAddress(e.target.value)}
                      maxLength={200}
                    />
                    <p className="text-xs text-muted-foreground">
                      Until your own sending domain is verified with the email provider, emails only reach your own inbox.
                    </p>
                  </div>
                </details>
              </div>

              <div className="glass space-y-3 p-4 sm:p-5">
                <StepTitle number={2} title="Choose customers" hint="Unsubscribed and opted-out customers are always skipped." />
                <div>
                  <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="size-3.5 text-primary" /> Quick audiences
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CAMPAIGN_AUDIENCES.map((audience) => (
                      <button
                        key={audience.id}
                        type="button"
                        disabled={audienceBusy !== null}
                        onClick={() => pickAudience(audience.id, audience.label)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
                          audienceLabel === audience.label
                            ? "border-primary/40 bg-primary/12 text-primary"
                            : "border-white/70 bg-white/55 shadow-[inset_0_1px_0_white] hover:bg-white/90",
                        )}
                      >
                        {audienceBusy === audience.id && <Loader2 className="size-3 animate-spin" />}
                        {audience.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Or search customers by name or email"
                    value={leadQuery}
                    onChange={(e) => setLeadQuery(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-muted-foreground">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={hideNoEmail}
                      onChange={(e) => setHideNoEmail(e.target.checked)}
                    />
                    Hide customers without an email{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
                  </label>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAudienceLabel(null);
                        addLeads(selectable);
                      }}
                      disabled={selectable.length === 0}
                    >
                      Select all shown{selectable.length ? ` (${selectable.length})` : ""}
                    </Button>
                    {selected.size > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSelected(new Map());
                          setAudienceLabel(null);
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
                <ul
                  className="max-h-80 divide-y divide-white/60 overflow-y-auto overscroll-contain rounded-xl border border-white/60 bg-white/40"
                  aria-label="Customers"
                >
                  {visibleOptions.length === 0 && (
                    <li className="p-4 text-center text-sm text-muted-foreground">
                      {searching ? "Searching…" : "No customers found."}
                    </li>
                  )}
                  {visibleOptions.map((lead) => {
                    const isSelected = selected.has(lead.id);
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          disabled={!lead.email}
                          aria-pressed={isSelected}
                          onClick={() => toggleLead(lead)}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-3 px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                            isSelected ? "bg-primary/10" : "hover:bg-white/60",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-5 shrink-0 place-items-center rounded-md border transition-colors",
                              isSelected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20 bg-white/70",
                            )}
                          >
                            {isSelected && <Check className="size-3.5" />}
                          </span>
                          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-[11px] font-semibold text-white">
                            {initials(lead.name, lead.email)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{lead.name ?? "Unnamed"}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {lead.email ?? "No email address"}
                              {lead.suburb ? ` · ${lead.suburb}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {leadOptions.length >= 50 && (
                  <p className="text-xs text-muted-foreground">Showing the 50 newest matches. Search, or use a quick audience, to reach others.</p>
                )}
              </div>
            </div>

            <aside className={cn("min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start", mobileView === "write" && "hidden lg:block")}>
              {followUpOn && (
                <Segmented
                  value={emailTab}
                  onChange={setEmailTab}
                  options={[
                    { value: "first", label: "First email" },
                    { value: "follow_up", label: `Follow-up · day ${delayDays}` },
                  ]}
                />
              )}
              <EmailPreview
                businessName={businessName}
                fromAddress={fromAddress}
                subject={emailTab === "first" || !followUpOn ? subject : followSubject}
                bodyText={emailTab === "first" || !followUpOn ? bodyText : followBody}
                label={emailTab === "follow_up" && followUpOn ? "Follow-up customers get" : "What customers get"}
              />
              <div className="glass space-y-3 p-4 sm:p-5">
                <StepTitle number={3} title="Review and save" />
                <ol className="space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-primary/12 text-primary">
                      <Mail className="size-3.5" />
                    </span>
                    <span className="min-w-0 truncate">{subject.trim() || "First email"}</span>
                  </li>
                  {followUpOn && (
                    <li className="flex items-center gap-2 text-muted-foreground">
                      <span className="grid size-6 place-items-center rounded-full bg-white/70">
                        <Repeat2 className="size-3.5" />
                      </span>
                      <span className="min-w-0 truncate">
                        Follow-up after {delayDays} days{stopOnBooking ? ", if they haven't booked" : ""}
                      </span>
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-white/70 text-primary">
                      <Users className="size-3.5" />
                    </span>
                    <span>
                      <span className="font-semibold">{plural(selected.size, "customer")}</span>
                      {audienceLabel ? ` · ${audienceLabel}` : " selected"}
                    </span>
                  </li>
                </ol>
                {selected.size > 0 && (
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {[...selected.values()].slice(0, 60).map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => toggleLead(lead)}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/70 bg-white/65 py-1 pl-2.5 pr-1.5 text-xs shadow-[inset_0_1px_0_white] hover:bg-white/90"
                        aria-label={`Remove ${lead.name ?? lead.email}`}
                      >
                        <span className="truncate">{lead.name ?? lead.email}</span>
                        <X className="size-3 shrink-0 text-muted-foreground" />
                      </button>
                    ))}
                    {selected.size > 60 && (
                      <span className="px-1 py-1 text-xs text-muted-foreground">and {selected.size - 60} more</span>
                    )}
                  </div>
                )}
                <p className="flex items-start gap-2 rounded-xl bg-white/45 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  Saving makes a draft. Every email has an unsubscribe link, and nothing is sent until you press Send or schedule it.
                </p>
                <Button className="w-full" onClick={onCreate} disabled={busy || !canSave}>
                  {busy ? "Saving…" : "Save draft"}
                </Button>
                {!canSave && (
                  <p className="text-center text-xs text-muted-foreground">
                    {!name.trim() || !firstReady
                      ? "Add a name, subject and email to continue."
                      : !followReady
                        ? "Finish the follow-up, or turn it off."
                        : "Choose at least one customer."}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>

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

function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-xl border border-white/60 bg-white/40 p-1 backdrop-blur-xl", className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
            value === option.value
              ? "bg-white/90 text-primary shadow-[inset_0_1px_0_white,0_2px_8px_-2px_oklch(0.3_0.1_258/0.25)]"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-foreground/20",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

function StepTitle({ number, title, hint }: { number: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/12 text-sm font-semibold text-primary">
        {number}
      </span>
      <div>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs font-medium">
        {label}
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
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
      <div className="flex gap-2 md:justify-end" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" onClick={() => onSend(c)} disabled={busy || c.counts.pending === 0}>
          <Send /> Send
        </Button>
        <Button size="sm" variant="outline" onClick={() => onCancel(c)} disabled={busy} aria-label={`Cancel ${c.name}`}>
          <Trash2 />
        </Button>
      </div>
    ) : c.status === "scheduled" ? (
      <div className="flex gap-2 md:justify-end" onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="outline" onClick={() => onUnschedule(c)} disabled={busy}>
          <CalendarClock /> Unschedule
        </Button>
      </div>
    ) : null;

  const when = (c: Campaign) =>
    c.status === "scheduled" ? `Sends ${formatDate(c.scheduledAt, true)}` : formatDate(c.sentAt ?? c.createdAt);

  return (
    <>
      <table className="hidden w-full table-fixed text-sm md:table">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-white/60">
            <th className="w-[34%] px-5 py-2.5 font-medium">Campaign</th>
            <th className="w-[11%] px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 text-right font-medium">Sent</th>
            <th className="px-3 py-2.5 text-right font-medium">Follow-ups</th>
            <th className="px-3 py-2.5 text-right font-medium">Booked</th>
            <th className="w-[14%] px-3 py-2.5 font-medium">Date</th>
            <th className="w-[17%] px-5 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/60">
          {campaigns.map((c) => (
            <tr
              key={c.id}
              onClick={() => onOpen(c)}
              className="cursor-pointer align-middle transition-colors hover:bg-white/40"
            >
              <td className="px-5 py-3">
                <p className="truncate font-medium">{c.name}</p>
                <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
                {!c.fromDeliverable && c.status !== "cancelled" && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-warning-foreground">
                    <AlertTriangle className="size-3 shrink-0 text-warning" />
                    <span className="truncate">Domain not verified: only reaches your inbox</span>
                  </p>
                )}
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
                    {c.counts.followUpsWaiting > 0 && (
                      <span className="block text-[11px] text-muted-foreground">{c.counts.followUpsWaiting} waiting</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className={cn("tabular px-3 py-3 text-right", c.counts.booked > 0 && "font-semibold text-success-foreground")}>
                {c.counts.booked}
              </td>
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

      <ul className="divide-y divide-white/60 md:hidden">
        {campaigns.map((c) => (
          <li key={c.id} className="space-y-2 px-4 py-3">
            <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="block space-y-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.subject}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <p className="tabular text-xs text-muted-foreground">
                {c.counts.sent}/{c.counts.total} sent
                {c.followUp ? ` · ${c.counts.followUpsSent} follow-ups` : ""} · {c.counts.booked} booked · {when(c)}
              </p>
              {!c.fromDeliverable && c.status !== "cancelled" && (
                <p className="flex items-center gap-1 text-[11px] text-warning-foreground">
                  <AlertTriangle className="size-3 shrink-0 text-warning" /> Domain not verified: only reaches your inbox
                </p>
              )}
            </Link>
            <div className="flex items-center justify-between gap-2">
              {actions(c)}
              <Link
                to="/campaigns/$campaignId"
                params={{ campaignId: c.id }}
                className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary"
              >
                Open <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
