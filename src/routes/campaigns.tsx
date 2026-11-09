import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  Mail,
  PenLine,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
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
import { cn } from "@/lib/utils";
import { getSession } from "@/lib/app.functions";
import { CAMPAIGN_TEMPLATES, initials, previewParagraphs } from "@/lib/campaign-templates";
import {
  cancelEmailCampaign,
  createEmailCampaign,
  getEmailCampaigns,
  searchCampaignLeads,
  sendEmailCampaign,
} from "@/lib/email-campaigns.functions";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaigns | BookedSecure" },
      {
        name: "description",
        content:
          "Draft email campaigns to your customers, review them, and send when ready. Unsubscribed customers are always skipped.",
      },
      { property: "og:title", content: "Email campaigns | BookedSecure" },
      {
        property: "og:description",
        content: "Draft, review and send email campaigns to your customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CampaignsPage,
});

type Campaign = Awaited<ReturnType<typeof getEmailCampaigns>>[number];
type LeadOption = Awaited<ReturnType<typeof searchCampaignLeads>>[number];
type Confirm = { kind: "send" | "cancel"; campaign: Campaign } | null;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function CampaignsPage() {
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
  const [confirm, setConfirm] = useState<Confirm>(null);
  const composerRef = useRef<HTMLElement>(null);

  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [leadQuery, setLeadQuery] = useState("");
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [hideNoEmail, setHideNoEmail] = useState(true);
  const [selected, setSelected] = useState<Map<string, LeadOption>>(new Map());
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
    const drafts = campaigns.filter((c) => c.status === "draft").length;
    const sentCampaigns = campaigns.filter((c) => c.status === "sent").length;
    const emailsSent = campaigns.reduce((sum, c) => sum + c.counts.sent, 0);
    const failed = campaigns.reduce((sum, c) => sum + c.counts.failed, 0);
    return { drafts, sentCampaigns, emailsSent, failed };
  }, [campaigns]);

  const canSave = Boolean(name.trim() && subject.trim() && bodyText.trim() && selected.size > 0);
  const steps = [
    { label: "Write", done: Boolean(subject.trim() && bodyText.trim()) },
    { label: "Customers", done: selected.size > 0 },
    { label: "Save draft", done: false },
  ];

  function toggleLead(lead: LeadOption) {
    if (!lead.email) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(lead.id)) next.delete(lead.id);
      else next.set(lead.id, lead);
      return next;
    });
  }

  function selectAllShown() {
    setSelected((prev) => {
      const next = new Map(prev);
      for (const lead of selectable) next.set(lead.id, lead);
      return next;
    });
  }

  function applyTemplate(id: string) {
    const template = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!template) return;
    if (bodyText.trim() && !window.confirm("Replace what you've written with this starter?")) return;
    setName((current) => current.trim() || template.name);
    setSubject(template.subject);
    setBodyText(template.body(businessName));
  }

  function startNew() {
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => composerRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 350);
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
        },
      });
      toast.success(
        `Draft saved for ${plural(result.emailable, "customer")}` +
          (result.skippedUnsubscribed > 0 ? ` (${result.skippedUnsubscribed} unsubscribed skipped)` : "") +
          (result.skippedNoEmail > 0 ? ` (${result.skippedNoEmail} without an email skipped)` : ""),
      );
      if (!result.fromDeliverable) {
        toast.warning(
          "Emails will only reach your own inbox until your sending domain is verified with the email provider.",
        );
      }
      setName("");
      setSubject("");
      setBodyText("");
      setSelected(new Map());
      setMobileView("write");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the draft.");
    } finally {
      setBusy(false);
    }
  }

  async function runConfirmed() {
    if (!confirm) return;
    const { kind, campaign } = confirm;
    setConfirm(null);
    setBusy(true);
    try {
      if (kind === "send") {
        const result = await sendEmailCampaign({ data: { campaignId: campaign.id } });
        toast.success(
          `Sent ${plural(result.sent, "email")}` +
            (result.failed > 0 ? `, ${result.failed} failed` : "") +
            (result.skipped > 0 ? `, ${result.skipped} unsubscribed skipped` : ""),
        );
      } else {
        await cancelEmailCampaign({ data: { campaignId: campaign.id } });
        toast.success("Draft cancelled.");
      }
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : kind === "send"
            ? "Could not send the campaign."
            : "Could not cancel the draft.",
      );
    } finally {
      setBusy(false);
    }
  }

  const preview = (
    <EmailPreview
      businessName={businessName}
      fromAddress={fromAddress}
      subject={subject}
      bodyText={bodyText}
    />
  );

  return (
    <AppShell title="Campaigns">
      <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Campaigns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Email your customers in your own words. Nothing is sent until you press Send.
            </p>
          </div>
          <Button onClick={startNew}>
            <Plus /> New campaign
          </Button>
        </header>

        <section aria-label="Campaign totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Drafts" value={stats.drafts} tone="warning" />
          <Stat label="Campaigns sent" value={stats.sentCampaigns} tone="primary" />
          <Stat label="Emails sent" value={stats.emailsSent} tone="success" />
          <Stat label="Failed" value={stats.failed} tone={stats.failed > 0 ? "destructive" : "muted"} />
        </section>

        <section aria-labelledby="your-campaigns" className="glass overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-white/60 px-4 py-3 sm:px-5">
            <h2 id="your-campaigns" className="text-[17px] font-semibold tracking-[-0.01em]">
              Your campaigns
            </h2>
            <span className="text-xs text-muted-foreground">{campaigns.length ? plural(campaigns.length, "campaign") : ""}</span>
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
            <CampaignList campaigns={campaigns} busy={busy} onAsk={setConfirm} />
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
                      step.done
                        ? "bg-primary text-primary-foreground"
                        : "bg-white/70 text-muted-foreground shadow-[inset_0_1px_0_white]",
                    )}
                  >
                    {step.done ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className={step.done ? "font-medium text-foreground" : "text-muted-foreground"}>
                    {step.label}
                  </span>
                  {index < steps.length - 1 && <span className="mx-1 h-px w-4 bg-foreground/15" />}
                </li>
              ))}
            </ol>
          </div>

          <div className="inline-flex rounded-xl border border-white/60 bg-white/40 p-1 backdrop-blur-xl lg:hidden" role="tablist">
            {(["write", "preview"] as const).map((view) => (
              <button
                key={view}
                type="button"
                role="tab"
                aria-selected={mobileView === view}
                onClick={() => setMobileView(view)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                  mobileView === view ? "bg-white/90 text-primary shadow-sm" : "text-muted-foreground",
                )}
              >
                {view === "write" ? <PenLine className="size-4" /> : <Eye className="size-4" />}
                {view === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
            <div className={cn("min-w-0 space-y-4", mobileView === "preview" && "hidden lg:block")}>
              <div className="glass space-y-4 p-4 sm:p-5">
                <StepTitle number={1} title="Write the email" hint="Plain words work best. Blank lines start a new paragraph." />
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Sparkles className="size-3.5 text-primary" /> Start from
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {CAMPAIGN_TEMPLATES.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyTemplate(template.id)}
                        className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-xs font-medium text-foreground shadow-[inset_0_1px_0_white] transition-colors hover:bg-white/90 hover:text-primary"
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>
                <Field label="Campaign name" hint="Only you see this">
                  <Input placeholder="e.g. Spring special" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
                </Field>
                <Field label="Subject line">
                  <Input placeholder="What customers see in their inbox" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} />
                </Field>
                <Field label="Email" hint={`${bodyText.length} / 5000`}>
                  <Textarea
                    placeholder="Write the email in your own words..."
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    rows={8}
                    maxLength={5000}
                  />
                </Field>
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
                <StepTitle number={2} title="Choose customers" hint="Customers who unsubscribed are always skipped." />
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Search customers by name or email"
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
                    <Button size="sm" variant="ghost" onClick={selectAllShown} disabled={selectable.length === 0}>
                      Select all shown{selectable.length ? ` (${selectable.length})` : ""}
                    </Button>
                    {selected.size > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => setSelected(new Map())}>
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
                  <p className="text-xs text-muted-foreground">Showing the 50 newest matches. Search to find others.</p>
                )}
              </div>
            </div>

            <aside className={cn("min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start", mobileView === "write" && "hidden lg:block")}>
              {preview}
              <div className="glass space-y-3 p-4 sm:p-5">
                <StepTitle number={3} title="Review and save" />
                <div className="flex items-center gap-2 text-sm">
                  <Users className="size-4 text-primary" />
                  <span>
                    <span className="font-semibold">{plural(selected.size, "customer")}</span> selected
                  </span>
                </div>
                {selected.size > 0 && (
                  <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                    {[...selected.values()].map((lead) => (
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
                  </div>
                )}
                <p className="flex items-start gap-2 rounded-xl bg-white/45 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                  Saving makes a draft. Every email includes an unsubscribe link, and nothing is sent until you press Send on the draft.
                </p>
                <Button className="w-full" onClick={onCreate} disabled={busy || !canSave}>
                  {busy ? "Saving…" : "Save draft"}
                </Button>
                {!canSave && (
                  <p className="text-center text-xs text-muted-foreground">
                    {!name.trim() || !subject.trim() || !bodyText.trim()
                      ? "Add a name, subject and email to continue."
                      : "Choose at least one customer."}
                  </p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "send" ? `Send "${confirm.campaign.name}"?` : `Cancel "${confirm?.campaign.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "send"
                ? `This emails ${plural(confirm.campaign.counts.pending, "customer")} now and cannot be undone.${
                    confirm.campaign.fromDeliverable ? "" : " Your sending domain isn't verified yet, so emails only reach your own inbox."
                  }`
                : "The draft will be cancelled and nothing will be sent."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirm?.kind === "send" ? "Not yet" : "Keep draft"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={runConfirmed}
              className={confirm?.kind === "cancel" ? "bg-destructive !bg-none text-destructive-foreground hover:bg-destructive/90" : undefined}
            >
              {confirm?.kind === "send" ? "Send now" : "Cancel draft"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "primary" | "success" | "warning" | "destructive" | "muted" }) {
  const dot = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
    muted: "bg-foreground/25",
  }[tone];
  return (
    <div className="glass p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", dot)} />
        {label}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">{value}</p>
    </div>
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

function EmailPreview({
  businessName,
  fromAddress,
  subject,
  bodyText,
}: {
  businessName: string | null;
  fromAddress: string;
  subject: string;
  bodyText: string;
}) {
  const paragraphs = previewParagraphs(bodyText);
  const sender = businessName ?? "Your business";
  return (
    <div className="glass overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/60 px-4 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">What customers get</p>
        <span className="flex gap-1" aria-hidden>
          <span className="size-2 rounded-full bg-foreground/15" />
          <span className="size-2 rounded-full bg-foreground/15" />
          <span className="size-2 rounded-full bg-foreground/15" />
        </span>
      </div>
      <div className="space-y-3 bg-white/80 p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary-deep)] text-xs font-semibold text-white">
            {initials(sender, null)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{sender}</p>
            <p className="truncate text-xs text-muted-foreground">{fromAddress.trim() || "Sent from BookedSecure"}</p>
          </div>
        </div>
        <p className={cn("text-[15px] font-semibold", !subject.trim() && "text-muted-foreground/70")}>
          {subject.trim() || "Your subject line"}
        </p>
        <div className="space-y-3 text-sm leading-relaxed text-[#1f2933]">
          {paragraphs.length === 0 ? (
            <p className="text-muted-foreground/70">Your email appears here as you write it.</p>
          ) : (
            paragraphs.map((lines, i) => (
              <p key={i} className="break-words">
                {lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
            ))
          )}
        </div>
        <div className="border-t border-[#e4e7eb] pt-3 text-xs text-[#6b7280]">
          Sent by {sender}. <span className="underline">Unsubscribe from these emails</span>.
        </div>
      </div>
    </div>
  );
}

function CampaignList({
  campaigns,
  busy,
  onAsk,
}: {
  campaigns: Campaign[];
  busy: boolean;
  onAsk: (confirm: Confirm) => void;
}) {
  return (
    <>
      <table className="hidden w-full text-sm md:table">
        <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b border-white/60">
            <th className="px-5 py-2.5 font-medium">Campaign</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-3 py-2.5 text-right font-medium">Recipients</th>
            <th className="px-3 py-2.5 text-right font-medium">Sent</th>
            <th className="px-3 py-2.5 text-right font-medium">Failed</th>
            <th className="px-3 py-2.5 font-medium">Date</th>
            <th className="px-5 py-2.5 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/60">
          {campaigns.map((campaign) => (
            <tr key={campaign.id} className="align-top transition-colors hover:bg-white/35">
              <td className="max-w-0 px-5 py-3">
                <p className="truncate font-medium">{campaign.name}</p>
                <p className="truncate text-xs text-muted-foreground">{campaign.subject}</p>
                <DomainWarning campaign={campaign} />
                <Recipients campaign={campaign} />
              </td>
              <td className="px-3 py-3">
                <StatusPill status={campaign.status} />
              </td>
              <td className="tabular px-3 py-3 text-right">{campaign.counts.total}</td>
              <td className="tabular px-3 py-3 text-right">{campaign.counts.sent}</td>
              <td className={cn("tabular px-3 py-3 text-right", campaign.counts.failed > 0 && "font-medium text-destructive")}>
                {campaign.counts.failed}
              </td>
              <td className="whitespace-nowrap px-3 py-3 text-xs text-muted-foreground">{formatDate(campaign.sentAt ?? campaign.createdAt)}</td>
              <td className="px-5 py-3">
                <CampaignActions campaign={campaign} busy={busy} onAsk={onAsk} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="divide-y divide-white/60 md:hidden">
        {campaigns.map((campaign) => (
          <li key={campaign.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{campaign.name}</p>
                <p className="truncate text-xs text-muted-foreground">{campaign.subject}</p>
              </div>
              <StatusPill status={campaign.status} />
            </div>
            <p className="tabular text-xs text-muted-foreground">
              {campaign.status === "draft"
                ? `${plural(campaign.counts.pending, "recipient")} waiting`
                : `${campaign.counts.sent} of ${campaign.counts.total} sent`}
              {campaign.counts.failed > 0 ? ` · ${campaign.counts.failed} failed` : ""} · {formatDate(campaign.sentAt ?? campaign.createdAt)}
            </p>
            <DomainWarning campaign={campaign} />
            <CampaignActions campaign={campaign} busy={busy} onAsk={onAsk} />
            <Recipients campaign={campaign} />
          </li>
        ))}
      </ul>
    </>
  );
}

function CampaignActions({ campaign, busy, onAsk }: { campaign: Campaign; busy: boolean; onAsk: (confirm: Confirm) => void }) {
  if (campaign.status !== "draft") return null;
  return (
    <div className="flex gap-2 md:justify-end">
      <Button size="sm" onClick={() => onAsk({ kind: "send", campaign })} disabled={busy || campaign.counts.pending === 0}>
        <Send /> Send
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAsk({ kind: "cancel", campaign })} disabled={busy}>
        <Trash2 /> Cancel
      </Button>
    </div>
  );
}

function DomainWarning({ campaign }: { campaign: Campaign }) {
  if (campaign.fromDeliverable || campaign.status === "cancelled") return null;
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-warning-foreground">
      <AlertTriangle className="size-3.5 shrink-0 text-warning" />
      Sending domain not verified, so emails only reach your own inbox for now.
    </p>
  );
}

function Recipients({ campaign }: { campaign: Campaign }) {
  if (campaign.recipients.length === 0) return null;
  return (
    <details className="group mt-1 text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-primary">
        {plural(campaign.recipients.length, "recipient")}
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {campaign.recipients.map((r) => (
          <li key={r.email} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-white/45 px-2 py-1">
            <span className="truncate">{r.email}</span>
            <span className={cn("shrink-0 capitalize", r.status === "failed" ? "text-destructive" : "text-muted-foreground")} title={r.error ?? undefined}>
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === "sent"
      ? "bg-success/15 text-success-foreground"
      : status === "draft"
        ? "bg-warning/20 text-warning-foreground"
        : "bg-foreground/8 text-muted-foreground";
  const label = status === "sent" ? "Sent" : status === "draft" ? "Draft" : status === "cancelled" ? "Cancelled" : status;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", style)}>
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}
