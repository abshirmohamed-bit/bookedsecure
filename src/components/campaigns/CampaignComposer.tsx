import { useRef, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  LayoutTemplate,
  Loader2,
  Mail,
  PenLine,
  Plus,
  Repeat2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Portal } from "@/components/Portal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmailPreview, plural } from "@/components/campaigns/CampaignParts";
import { cn } from "@/lib/utils";
import { CAMPAIGN_TEMPLATES, initials } from "@/lib/campaign-templates";
import { CAMPAIGN_AUDIENCES, type CampaignAudienceId } from "@/lib/email-campaigns";
import {
  createEmailCampaign,
  draftCampaignEmail,
  getCampaignAudience,
  searchCampaignLeads,
} from "@/lib/email-campaigns.functions";

type LeadOption = Awaited<ReturnType<typeof searchCampaignLeads>>[number];
type Step = "emails" | "customers" | "review";
type EmailTab = "first" | "follow_up";

const AI_CHIPS = ["Keep it short", "Mention our offer", "Ask for a reply", "Casual tone", "Professional tone", "No discounts"];
const DELAYS = [2, 3, 5, 7, 14];
const STEPS: { id: Step; label: string }[] = [
  { id: "emails", label: "Emails" },
  { id: "customers", label: "Customers" },
  { id: "review", label: "Review" },
];

/**
 * Full-screen campaign builder: one step at a time, the live preview always
 * beside it, and every action in a fixed header and footer, so nothing needs
 * a long page scroll. Saving creates a draft; "Save and send" hands the new
 * draft back so the page can open the send/schedule approval.
 */
export function CampaignComposer({
  businessName,
  onClose,
  onSaved,
  initialAudience,
  initialLeadIds,
}: {
  businessName: string | null;
  onClose: () => void;
  onSaved: (campaignId: string, andSend: boolean) => void;
  /** Opened from Lead finder: start with that audience. */
  initialAudience?: CampaignAudienceId | undefined;
  /** Opened from the Leads page: start with the customers chosen there. */
  initialLeadIds?: string[] | undefined;
}) {
  const [step, setStep] = useState<Step>("emails");
  const [mobilePreview, setMobilePreview] = useState(false);
  const [busy, setBusy] = useState(false);

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

  const [aiInstructions, setAiInstructions] = useState("");
  const [aiChips, setAiChips] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const [leadQuery, setLeadQuery] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, LeadOption>>(new Map());
  const [audienceLabel, setAudienceLabel] = useState<string | null>(null);
  const [audienceBusy, setAudienceBusy] = useState<CampaignAudienceId | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [busy, onClose]);

  useEffect(() => {
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        setLeadOptions(await searchCampaignLeads({ data: { query: leadQuery } }));
      } catch {
        // Search is best-effort; the selected customers stay put.
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [leadQuery]);

  const emailable = useMemo(() => leadOptions.filter((lead) => lead.email), [leadOptions]);
  const selectable = emailable.filter((lead) => !selected.has(lead.id));

  const firstReady = Boolean(subject.trim() && bodyText.trim());
  const followReady = !followUpOn || Boolean(followSubject.trim() && followBody.trim());
  const emailsDone = Boolean(name.trim()) && firstReady && followReady;
  const customersDone = selected.size > 0;
  const canSave = emailsDone && customersDone;
  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const blocker = !name.trim()
    ? "Give the campaign a name."
    : !firstReady
      ? "Write the first email's subject and message."
      : !followReady
        ? "Finish the follow-up, or turn it off."
        : !customersDone
          ? "Choose at least one customer."
          : null;

  const showFollow = emailTab === "follow_up" && followUpOn;
  const previewSubject = showFollow ? followSubject : subject;
  const previewBody = showFollow ? followBody : bodyText;
  const activeSubject = emailTab === "first" ? subject : followSubject;
  const activeBody = emailTab === "first" ? bodyText : followBody;
  const setActiveSubject = emailTab === "first" ? setSubject : setFollowSubject;
  const setActiveBody = emailTab === "first" ? setBodyText : setFollowBody;

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

  function addLeads(leads: LeadOption[], replace = false) {
    setSelected((prev) => {
      const next = replace ? new Map<string, LeadOption>() : new Map(prev);
      for (const lead of leads) if (lead.email && next.size < 500) next.set(lead.id, lead);
      return next;
    });
  }

  // Start with what the owner chose on the Leads or Lead finder page; they can still change it.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (initialLeadIds?.length) {
      void searchCampaignLeads({ data: { ids: initialLeadIds } }).then((leads) => {
        const withEmail = leads.filter((l) => l.email);
        addLeads(withEmail, true);
        setAudienceLabel(null);
        if (withEmail.length < initialLeadIds.length) toast.info(`${initialLeadIds.length - withEmail.length} of the chosen customers have no email, so they're left out.`);
      }).catch(() => undefined);
    } else if (initialAudience) {
      const def = CAMPAIGN_AUDIENCES.find((a) => a.id === initialAudience);
      if (def) void pickAudience(def.id, def.label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickAudience(id: CampaignAudienceId, label: string) {
    setAudienceBusy(id);
    try {
      const leads = await getCampaignAudience({ data: { audience: id } });
      if (leads.length === 0) {
        toast.info(`No customers with an email in "${label}".`);
        return;
      }
      addLeads(leads, true);
      setAudienceLabel(label);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load that audience.");
    } finally {
      setAudienceBusy(null);
    }
  }

  function applyTemplate(id: string) {
    setTemplatesOpen(false);
    const template = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    if (bodyText.trim() && !window.confirm("Replace what you've written with this starter?")) return;
    setEmailTab("first");
    setName((current) => current.trim() || template.name);
    setSubject(template.subject);
    setBodyText(template.body(businessName));
  }

  async function writeWithAi() {
    if (emailTab === "follow_up" && !firstReady) {
      toast.error("Write the first email before the follow-up.");
      return;
    }
    if (activeBody.trim() && !window.confirm("Replace what you've written with the AI's version?")) return;
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
      setActiveSubject(draft.subject);
      setActiveBody(draft.bodyText);
      if (emailTab === "first") setName((n) => n.trim() || draft.subject.slice(0, 60));
      toast.success("Draft written. Read it through and make it yours.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI could not write the email.");
    } finally {
      setAiBusy(false);
    }
  }

  async function save(andSend: boolean) {
    if (!canSave) {
      if (blocker) toast.error(blocker);
      setStep(emailsDone ? "customers" : "emails");
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
      const skipped = result.skippedUnsubscribed + result.skippedNoEmail;
      toast.success(`Draft saved for ${plural(result.emailable, "customer")}${skipped ? ` (${skipped} skipped)` : ""}.`);
      onSaved(result.campaignId, andSend);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  const summary = [
    plural(selected.size, "customer"),
    followUpOn ? `follow-up after ${delayDays} days` : "no follow-up",
  ].join(" · ");

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex bg-[oklch(0.22_0.06_258/0.3)] backdrop-blur-sm sm:p-4 lg:p-6" role="dialog" aria-modal="true" aria-label="New email campaign">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden border border-white/70 bg-white/72 shadow-[inset_0_1px_0_white,0_30px_80px_-24px_oklch(0.25_0.1_258/0.5)] backdrop-blur-2xl backdrop-saturate-150 sm:rounded-[20px]">
          {/* Header: name, steps, close */}
          <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/70 px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-white/80"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Name this campaign"
              aria-label="Campaign name (only you see this)"
              className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[17px] font-semibold tracking-[-0.01em] outline-none placeholder:text-muted-foreground/70 hover:bg-white/50 focus:bg-white/70"
            />
            <ol className="order-last flex w-full items-center gap-1 sm:order-none sm:w-auto" aria-label="Steps">
              {STEPS.map((s, index) => {
                const done = s.id === "emails" ? emailsDone : s.id === "customers" ? customersDone : false;
                return (
                  <li key={s.id} className="flex flex-1 items-center gap-1 sm:flex-none">
                    <button
                      type="button"
                      onClick={() => setStep(s.id)}
                      aria-current={step === s.id ? "step" : undefined}
                      className={cn(
                        "flex w-full items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors sm:w-auto",
                        step === s.id ? "bg-white/90 text-primary shadow-sm" : "text-muted-foreground hover:bg-white/50",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-5 place-items-center rounded-full text-[11px]",
                          done ? "bg-primary text-primary-foreground" : step === s.id ? "bg-primary/12 text-primary" : "bg-foreground/8",
                        )}
                      >
                        {done ? <Check className="size-3" /> : index + 1}
                      </span>
                      {s.label}
                    </button>
                    {index < STEPS.length - 1 && <span className="hidden h-px w-3 bg-foreground/15 sm:block" />}
                  </li>
                );
              })}
            </ol>
            <button
              type="button"
              onClick={() => setMobilePreview((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary lg:hidden"
            >
              {mobilePreview ? <PenLine className="size-4" /> : <Eye className="size-4" />}
              {mobilePreview ? "Edit" : "Preview"}
            </button>
          </header>

          {/* Body: current step + live preview */}
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className={cn("flex min-h-0 flex-col overflow-y-auto p-4 sm:p-5", mobilePreview && "hidden lg:flex")}>
              {step === "emails" && (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {/* One toolbar: which email, follow-up timing, templates */}
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-xl border border-white/70 bg-white/45 p-1" role="tablist">
                      {(
                        [
                          ["first", "First email", <Mail key="m" className="size-4" />],
                          ["follow_up", followUpOn ? `Follow-up · ${delayDays}d` : "Follow-up", <Repeat2 key="r" className="size-4" />],
                        ] as const
                      ).map(([value, label, icon]) => (
                        <button
                          key={value}
                          type="button"
                          role="tab"
                          aria-selected={emailTab === value}
                          onClick={() => setEmailTab(value)}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                            emailTab === value ? "bg-white/95 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {icon}
                          {label}
                        </button>
                      ))}
                    </div>
                    {emailTab === "follow_up" && (
                      <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium">
                        <Toggle checked={followUpOn} onChange={setFollowUpOn} label="Send a follow-up" />
                        Send a follow-up
                      </label>
                    )}
                    {emailTab === "first" && (
                      <div className="relative ml-auto">
                        <Button size="sm" variant="outline" onClick={() => setTemplatesOpen((o) => !o)} aria-expanded={templatesOpen}>
                          <LayoutTemplate /> Templates <ChevronDown className={cn("transition-transform", templatesOpen && "rotate-180")} />
                        </Button>
                        {templatesOpen && (
                          <ul className="absolute right-0 z-10 mt-1 w-56 overflow-hidden rounded-xl border border-white/70 bg-popover p-1 shadow-lg">
                            {CAMPAIGN_TEMPLATES.map((template) => (
                              <li key={template.id}>
                                <button
                                  type="button"
                                  onClick={() => applyTemplate(template.id)}
                                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/90"
                                >
                                  {template.label}
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>

                  {emailTab === "follow_up" && followUpOn && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-white/70 bg-white/45 px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Send after</span>
                      <div className="flex gap-1">
                        {DELAYS.map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setDelayDays(d)}
                            className={cn(
                              "rounded-md px-2 py-1 font-medium transition-colors",
                              delayDays === d ? "bg-primary text-primary-foreground" : "bg-white/70 hover:bg-white",
                            )}
                          >
                            {d}d
                          </button>
                        ))}
                      </div>
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                        <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={stopOnBooking} onChange={(e) => setStopOnBooking(e.target.checked)} />
                        Skip customers who book
                      </label>
                    </div>
                  )}

                  {emailTab === "follow_up" && !followUpOn ? (
                    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/15 p-8 text-center">
                      <Repeat2 className="size-6 text-primary" />
                      <p className="font-medium">Nudge customers who don't book</p>
                      <p className="max-w-sm text-sm text-muted-foreground">
                        Turn on a follow-up and it goes out automatically a few days after the first email, only to customers who haven't booked.
                      </p>
                      <Button size="sm" onClick={() => setFollowUpOn(true)}>
                        <Plus /> Add a follow-up
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* AI writer: one line + quick chips */}
                      <div className="rounded-xl border border-white/70 bg-gradient-to-br from-white/70 to-white/35 p-2.5">
                        <div className="flex gap-2">
                          <div className="relative min-w-0 flex-1">
                            <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
                            <Input
                              className="pl-9"
                              value={aiInstructions}
                              onChange={(e) => setAiInstructions(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && !aiBusy && void writeWithAi()}
                              maxLength={2000}
                              placeholder={emailTab === "first" ? "Tell AI what it's about, e.g. openings next week, $20 off interiors" : "Anything to add to the follow-up?"}
                            />
                          </div>
                          <Button onClick={writeWithAi} disabled={aiBusy}>
                            {aiBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
                            <span className="hidden sm:inline">{aiBusy ? "Writing…" : "Write it"}</span>
                          </Button>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {AI_CHIPS.map((chip) => {
                            const on = aiChips.includes(chip);
                            return (
                              <button
                                key={chip}
                                type="button"
                                aria-pressed={on}
                                onClick={() => setAiChips((prev) => (on ? prev.filter((c) => c !== chip) : [...prev, chip]))}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                                  on ? "border-primary/40 bg-primary/12 text-primary" : "border-white/80 bg-white/60 text-muted-foreground hover:bg-white",
                                )}
                              >
                                {on ? <Check className="size-3" /> : <Plus className="size-3" />}
                                {chip}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <Input
                        placeholder="Subject line"
                        aria-label="Subject line"
                        value={activeSubject}
                        onChange={(e) => setActiveSubject(e.target.value)}
                        maxLength={160}
                        className="h-11 text-[15px] font-medium"
                      />
                      <div className="relative flex min-h-[14rem] flex-1 flex-col">
                        <Textarea
                          aria-label={emailTab === "first" ? "Email" : "Follow-up email"}
                          placeholder={emailTab === "first" ? "Write the email in your own words. Blank lines start a new paragraph." : "A short nudge for customers who haven't booked..."}
                          value={activeBody}
                          onChange={(e) => setActiveBody(e.target.value)}
                          maxLength={5000}
                          className="min-h-[14rem] flex-1 resize-none pb-6"
                        />
                        <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-muted-foreground">{activeBody.length} / 5000</span>
                      </div>
                    </>
                  )}
                </div>
              )}

              {step === "customers" && (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    {CAMPAIGN_AUDIENCES.map((audience) => (
                      <button
                        key={audience.id}
                        type="button"
                        disabled={audienceBusy !== null}
                        onClick={() => pickAudience(audience.id, audience.label)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
                          audienceLabel === audience.label ? "border-primary/40 bg-primary/12 text-primary" : "border-white/80 bg-white/60 hover:bg-white",
                        )}
                      >
                        {audienceBusy === audience.id ? <Loader2 className="size-3 animate-spin" /> : audienceLabel === audience.label ? <Check className="size-3" /> : <Users className="size-3" />}
                        {audience.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-0 flex-1 basis-56">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                      <Input className="pl-9" placeholder="Search customers by name or email" value={leadQuery} onChange={(e) => setLeadQuery(e.target.value)} />
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { setAudienceLabel(null); addLeads(selectable); }} disabled={selectable.length === 0}>
                      Add all shown{selectable.length ? ` (${selectable.length})` : ""}
                    </Button>
                    {selected.size > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => { setSelected(new Map()); setAudienceLabel(null); }}>
                        Clear
                      </Button>
                    )}
                  </div>
                  <ul className="min-h-[12rem] flex-1 divide-y divide-white/70 overflow-y-auto overscroll-contain rounded-xl border border-white/70 bg-white/45" aria-label="Customers with an email">
                    {emailable.length === 0 && (
                      <li className="p-6 text-center text-sm text-muted-foreground">{searching ? "Searching…" : "No customers with an email found."}</li>
                    )}
                    {emailable.map((lead) => {
                      const isSelected = selected.has(lead.id);
                      return (
                        <li key={lead.id}>
                          <button
                            type="button"
                            aria-pressed={isSelected}
                            onClick={() => toggleLead(lead)}
                            className={cn("flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors", isSelected ? "bg-primary/10" : "hover:bg-white/70")}
                          >
                            <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border transition-colors", isSelected ? "border-primary bg-primary text-primary-foreground" : "border-foreground/20 bg-white/80")}>
                              {isSelected && <Check className="size-3.5" />}
                            </span>
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-[11px] font-semibold text-white">
                              {initials(lead.name, lead.email)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{lead.name ?? "Unnamed"}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {lead.email}
                                {lead.suburb ? ` · ${lead.suburb}` : ""}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-muted-foreground">
                    {leadOptions.length >= 50 ? "Showing the 50 newest matches; search or use an audience to reach others. " : ""}
                    Customers without an email, unsubscribed or opted out are never emailed.
                  </p>
                </div>
              )}

              {step === "review" && (
                <div className="space-y-3">
                  <ReviewRow icon={<Mail className="size-4" />} title="First email" detail={subject.trim() || "Not written yet"} done={firstReady} onEdit={() => { setEmailTab("first"); setStep("emails"); }} />
                  <ReviewRow
                    icon={<Repeat2 className="size-4" />}
                    title="Follow-up"
                    detail={followUpOn ? `${followSubject.trim() || "Not written yet"} · after ${delayDays} days${stopOnBooking ? ", skips customers who book" : ""}` : "Off"}
                    done={followReady}
                    onEdit={() => { setEmailTab("follow_up"); setStep("emails"); }}
                  />
                  <ReviewRow
                    icon={<Users className="size-4" />}
                    title="Customers"
                    detail={selected.size ? `${plural(selected.size, "customer")}${audienceLabel ? ` · ${audienceLabel}` : ""}` : "None chosen"}
                    done={customersDone}
                    onEdit={() => setStep("customers")}
                  />
                  {selected.size > 0 && (
                    <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-1">
                      {[...selected.values()].slice(0, 40).map((lead) => (
                        <button key={lead.id} type="button" onClick={() => toggleLead(lead)} className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/80 bg-white/70 py-0.5 pl-2.5 pr-1.5 text-xs hover:bg-white" aria-label={`Remove ${lead.name ?? lead.email}`}>
                          <span className="truncate">{lead.name ?? lead.email}</span>
                          <X className="size-3 shrink-0 text-muted-foreground" />
                        </button>
                      ))}
                      {selected.size > 40 && <span className="px-1 text-xs text-muted-foreground">and {selected.size - 40} more</span>}
                    </div>
                  )}
                  <label className="block space-y-1.5 rounded-xl border border-white/70 bg-white/45 p-3">
                    <span className="text-xs font-medium">Reply-to address (optional)</span>
                    <Input placeholder="hello@yourbusiness.com.au" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} maxLength={200} />
                    <span className="block text-[11px] text-muted-foreground">Emails are sent under your business name from BookedSecure. Customer replies go to this address, or to your login email if you leave it blank.</span>
                  </label>
                  <p className="flex items-start gap-2 rounded-xl bg-white/50 p-3 text-xs text-muted-foreground">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    Every email has an unsubscribe link. Nothing is sent until you approve it: Save draft keeps it for later, Save and send asks you to send now or pick a time.
                  </p>
                </div>
              )}
            </div>

            <aside className={cn("min-h-0 overflow-y-auto border-white/70 bg-white/25 p-4 lg:block lg:border-l", mobilePreview ? "block" : "hidden")}>
              {followUpOn && (
                <div className="mb-3 inline-flex rounded-xl border border-white/70 bg-white/45 p-1 text-xs">
                  {(["first", "follow_up"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEmailTab(tab)}
                      className={cn("rounded-lg px-2.5 py-1 font-medium", emailTab === tab ? "bg-white/95 text-primary shadow-sm" : "text-muted-foreground")}
                    >
                      {tab === "first" ? "First email" : `Follow-up · day ${delayDays}`}
                    </button>
                  ))}
                </div>
              )}
              <EmailPreview
                businessName={businessName}
                fromAddress={fromAddress}
                subject={previewSubject}
                bodyText={previewBody}
                label={showFollow ? "Follow-up customers get" : "What customers get"}
              />
            </aside>
          </div>

          {/* Footer: every action in one place */}
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/70 px-4 py-3 sm:px-5">
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {blocker && step === "review" ? <span className="text-warning-foreground">{blocker}</span> : summary}
            </p>
            {stepIndex > 0 && (
              <Button variant="ghost" onClick={() => setStep(STEPS[stepIndex - 1]!.id)} disabled={busy}>
                <ArrowLeft /> Back
              </Button>
            )}
            {step !== "review" ? (
              <Button onClick={() => setStep(STEPS[stepIndex + 1]!.id)}>
                Next <ArrowRight />
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => save(false)} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null} Save draft
                </Button>
                <Button onClick={() => save(true)} disabled={busy}>
                  <Send /> Save and send…
                </Button>
              </>
            )}
          </footer>
        </div>
      </div>
    </Portal>
  );
}

function ReviewRow({ icon, title, detail, done, onEdit }: { icon: ReactNode; title: string; detail: string; done: boolean; onEdit: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/70 bg-white/50 p-3">
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", done ? "bg-primary/12 text-primary" : "bg-warning/20 text-warning-foreground")}>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}>
        Edit
      </Button>
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
      className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-foreground/20")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}
