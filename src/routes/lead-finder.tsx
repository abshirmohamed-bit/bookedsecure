import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CheckSquare, Download, ExternalLink, EyeOff, Globe, Loader2, Mail, MailCheck, MailWarning, Phone, RefreshCw, Ruler, Search, Sparkles, Star, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { OutreachProgress, OutreachTabs } from "@/components/campaigns/CampaignsTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Portal } from "@/components/Portal";
import { relativeTime } from "@/lib/notifications";
import { addLeadFinderResults, checkLeadFinderRemaining, dismissLeadFinderResults, getLeadFinder, runLeadFinderSearch, suggestLeadFinderSearches } from "@/lib/lead-finder.functions";
import { csvForResults, filterResults, RESULT_FILTERS, type ResultFilter, type ResultSort } from "@/lib/lead-finder-view";

export const Route = createFileRoute("/lead-finder")({
  head: () => ({
    meta: [
      { title: "Lead finder | BookedSecure" },
      { name: "description", content: "Find local businesses that match who you want to reach, with their published email checked, ready for an email campaign." },
    ],
  }),
  // ?like=<lead id> starts from "find businesses like this customer".
  validateSearch: (search: Record<string, unknown>): { like?: string } =>
    typeof search["like"] === "string" && /^[0-9a-f-]{36}$/i.test(search["like"]) ? { like: search["like"] } : {},
  component: LeadFinderPage,
});

const FIT_LABEL = { good: "Good fit", maybe: "Maybe", no: "Not a fit", unknown: "Not checked" } as const;
const FIT_STYLE = { good: "bg-[#30d158]/15 text-[#1f8a3b]", maybe: "bg-[#ff9f0a]/15 text-[#a35d00]", no: "bg-muted text-muted-foreground", unknown: "bg-muted text-muted-foreground" } as const;
const PROGRESS_LABEL = { added: "Added to customers", emailed: "Emailed", replied: "Replied", booked: "Booked" } as const;
const EMAIL_LABEL = { valid: "Checked", unverified: "Mail server found", risky: "Risky", invalid: "Bounces", none: "No email" } as const;
/** What a search is doing, by how long it has been running (it runs as one request). */
const SEARCH_STEPS = [
  { from: 0, label: "Planning the search" },
  { from: 6, label: "Finding businesses on the web and the map" },
  { from: 35, label: "Reading their websites and checking they fit" },
  { from: 100, label: "Checking emails and saving" },
] as const;

function LeadFinderPage() {
  const qc = useQueryClient();
  const navigate = Route.useNavigate();
  const { like } = Route.useSearch();
  const load = useServerFn(getLeadFinder);
  const run = useServerFn(runLeadFinderSearch);
  const add = useServerFn(addLeadFinderResults);
  const dismiss = useServerFn(dismissLeadFinderResults);
  const [searchId, setSearchId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["lead-finder", searchId], queryFn: () => load({ data: { searchId } }) });
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [criteria, setCriteria] = useState("");
  const [limit, setLimit] = useState(20);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [sort, setSort] = useState<ResultSort>("best");
  const [elapsed, setElapsed] = useState(0);
  const [ask, setAsk] = useState("");
  const suggestFn = useServerFn(suggestLeadFinderSearches);
  const suggest = useMutation({
    mutationFn: (likeLeadId?: string) => suggestFn({ data: { request: ask.trim() || null, likeLeadId: likeLeadId ?? null } }),
    onSuccess: (r) => {
      if (r.suggestions.length === 0) toast.message("Co-Work couldn't suggest a search. Try describing who you want to reach.");
      else if ((ask.trim() || like) && r.suggestions[0]) applySuggestion(r.suggestions[0]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Co-Work couldn't suggest searches."),
  });
  const applySuggestion = (s: { what: string; where: string; criteria: string | null }) => { setWhat(s.what); setWhere(s.where); setCriteria(s.criteria ?? ""); };
  // Opened from a customer's page: Co-Work suggests businesses like them straight away.
  const likeStarted = useRef(false);
  useEffect(() => {
    if (!like || likeStarted.current) return;
    likeStarted.current = true;
    suggest.mutate(like);
  }, [like, suggest]);

  const search = useMutation({
    mutationFn: () => run({ data: { what, where, criteria: criteria.trim() || null, limit } }),
    onSuccess: async (r) => {
      toast.success(`Found ${r.found} business${r.found === 1 ? "" : "es"}, ${r.withEmail} with a published email.`);
      setPicked([]);
      setSearchId(r.searchId);
      await qc.invalidateQueries({ queryKey: ["lead-finder"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "The search didn't work."),
  });
  useEffect(() => {
    if (!search.isPending) { setElapsed(0); return; }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [search.isPending]);
  const checkFn = useServerFn(checkLeadFinderRemaining);
  const checkM = useMutation({
    mutationFn: (id: string) => checkFn({ data: { searchId: id } }),
    onSuccess: async (r) => {
      toast.success(r.checked || r.removed
        ? `Checked ${r.checked} more${r.removed ? `, removed ${r.removed} that weren't businesses` : ""}.`
        : "Nothing more could be read this time. Try again in a minute.");
      await qc.invalidateQueries({ queryKey: ["lead-finder"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't check them."),
  });
  const addM = useMutation({
    mutationFn: () => add({ data: { ids: picked } }),
    onSuccess: async (r) => {
      toast.success(`Added ${r.added} to your customers${r.skipped ? ` (${r.skipped} skipped: no email or phone, or already added)` : ""}.`, {
        action: r.added ? { label: "Email them", onClick: () => void navigate({ to: "/campaigns", search: { audience: "lead_finder" } }) } : undefined,
      });
      setPicked([]);
      await qc.invalidateQueries({ queryKey: ["lead-finder"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't add them."),
  });
  const dismissM = useMutation({
    mutationFn: () => dismiss({ data: { ids: picked } }),
    onSuccess: async () => { setPicked([]); await qc.invalidateQueries({ queryKey: ["lead-finder"] }); },
  });

  const d = q.data;
  const ready = d && !d.setupMissing && d.missingSettings.length === 0;
  const results = (d?.results ?? []).filter((r) => r.status !== "dismissed");
  const shown = filterResults(results, filter, sort);
  const counts = Object.fromEntries(RESULT_FILTERS.map((f) => [f.id, filterResults(results, f.id, sort).length])) as Record<ResultFilter, number>;
  const unread = results.filter((r) => r.fit === "unknown" && r.status === "new").length;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickGood = () => setPicked(results.filter((r) => r.fit === "good" && r.status === "new" && (r.email || r.phone)).map((r) => r.id));
  const exportCsv = () => {
    const current = d?.searches.find((s) => s.id === d.currentSearchId);
    const blob = new Blob([csvForResults(shown)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lead-finder-${(current ? `${current.query}-${current.area}` : "results").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const step = [...SEARCH_STEPS].reverse().find((s) => elapsed >= s.from) ?? SEARCH_STEPS[0];
  const canFind = Boolean(ready && d?.isOwner && !search.isPending && what.trim().length >= 3 && where.trim().length >= 2);
  const pickSearch = (id: string) => { setSearchId(id); setPicked([]); };
  const searchLabel = (s: { query: string; area: string; status: string; found: number }) => `${s.query} · ${s.area}`;
  const searchMeta = (s: { status: string; found: number; createdAt: string }) => `${s.status === "failed" ? "Failed" : `${s.found} found`} · ${relativeTime(s.createdAt)}`;

  return (
    <AppShell title="Lead finder">
      <div className={`mx-auto max-w-6xl space-y-4 p-4 md:p-6 ${picked.length ? "pb-28" : ""}`}>
        <header className="space-y-3 sm:flex sm:items-end sm:justify-between sm:gap-3 sm:space-y-0">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Lead finder</h1>
            <p className="text-sm text-muted-foreground">Find businesses that fit, read their websites, and keep the email they publish. Nothing is sent from here.</p>
          </div>
          <OutreachTabs active="finder" />
        </header>
        <OutreachProgress />
        {d && <p className="w-fit rounded-full border border-border bg-card/60 px-3 py-1 text-xs tabular-nums text-muted-foreground">{d.usedThisMonth} of {d.monthlyLimit} searches used this month</p>}

        {d && !ready && (
          <div className="glass p-4 text-sm text-muted-foreground">
            {d.setupMissing ? "Lead finder is waiting for a one-time database update." : "Lead finder isn't switched on for BookedSecure yet. It will work as soon as it is."}
          </div>
        )}

        {/* One search card: the search itself, with Co-Work's help folded in underneath. */}
        <section className="glass overflow-hidden p-0">
          <form
            className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto_auto] lg:items-center"
            onSubmit={(e) => { e.preventDefault(); if (canFind) search.mutate(); }}
          >
            <Input value={what} maxLength={120} aria-label="What kind of business?" placeholder="What kind of business? e.g. cleaning companies" onChange={(e) => setWhat(e.target.value)} className="h-11" />
            <Input value={where} maxLength={80} aria-label="Where?" placeholder="Where? e.g. Parramatta NSW, NSW or Australia" onChange={(e) => setWhere(e.target.value)} className="h-11" />
            <Input value={criteria} maxLength={400} aria-label="Who exactly? (optional)" placeholder="Who exactly? (optional) e.g. own team, not franchises" onChange={(e) => setCriteria(e.target.value)} className="h-11 sm:col-span-2 lg:col-span-1" />
            <select aria-label="How many" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-11 rounded-md border border-input bg-background px-2 text-sm">
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n} results</option>)}
            </select>
            <Button type="submit" className="btn-glow h-11" disabled={!canFind}>
              {search.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find
            </Button>
          </form>

          <div className="space-y-2 border-t border-border bg-primary/[0.04] px-3 py-2.5">
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); suggest.mutate(undefined); }}>
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <input value={ask} maxLength={500} onChange={(e) => setAsk(e.target.value)} aria-label="Ask Co-Work who to look for"
                placeholder={like ? "Co-Work is suggesting businesses like this customer…" : "Not sure? Ask Co-Work, e.g. gyms around Auburn with 20+ staff, or leave empty"}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
              <Button type="submit" size="sm" variant="outline" disabled={suggest.isPending} className="shrink-0">
                {suggest.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span className="hidden sm:inline">{ask.trim() ? "Fill the search" : "Suggest"}</span>
              </Button>
            </form>
            {suggest.data && suggest.data.suggestions.length > 0 && (
              <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none]">
                {suggest.data.suggestions.map((s) => (
                  <button key={`${s.what}|${s.where}`} type="button" onClick={() => applySuggestion(s)} title={[s.criteria, s.why].filter(Boolean).join(" · ") || undefined}
                    className={`shrink-0 rounded-full border px-3 py-1 text-left text-xs hover:border-primary/60 ${what === s.what && where === s.where ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70"}`}>
                    <span className="font-medium">{s.what}</span> <span className="text-muted-foreground">in {s.where}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            A state or "Australia" searches its major cities. Only emails a business publishes on its own website are kept; email them only about their work (every campaign has an unsubscribe link, as the Spam Act requires).
          </p>
        </section>

        {search.isPending && (
          <section className="glass p-4" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 animate-spin text-primary" />{step.label}…</p>
              <span className="tabular-nums text-xs text-muted-foreground">{elapsed}s · usually 1–2 minutes</span>
            </div>
            <ol className="mt-3 grid gap-1.5 sm:grid-cols-4">
              {SEARCH_STEPS.map((s) => {
                const now = s === step;
                const done = elapsed >= s.from && !now;
                return (
                  <li key={s.label} className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${now ? "border-primary bg-primary/10 text-primary" : done ? "border-border text-foreground" : "border-border/60 text-muted-foreground"}`}>
                    {done ? <CheckCircle2 className="mr-1 inline h-3 w-3 text-[#1f8a3b]" /> : null}{s.label}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {d && d.searches.length > 0 && (
          <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            {/* Past searches: a side list on wide screens, a picker on phones. */}
            <aside className="lg:sticky lg:top-4">
              <label className="block lg:hidden">
                <span className="sr-only">Past searches</span>
                <select value={d.currentSearchId ?? ""} onChange={(e) => pickSearch(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                  {d.searches.map((s) => <option key={s.id} value={s.id}>{searchLabel(s)} ({searchMeta(s)})</option>)}
                </select>
              </label>
              <nav aria-label="Past searches" className="glass hidden p-2 lg:block">
                <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past searches</p>
                <ul className="space-y-0.5">
                  {d.searches.map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => pickSearch(s.id)} aria-current={s.id === d.currentSearchId ? "true" : undefined}
                        className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${s.id === d.currentSearchId ? "bg-primary/10 text-primary" : "hover:bg-card/70"}`}>
                        <span className="block truncate text-sm font-medium">{searchLabel(s)}</span>
                        <span className={`block text-[11px] ${s.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{searchMeta(s)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </nav>
            </aside>

            <section className="glass min-w-0 overflow-hidden p-0">
              <div className="space-y-2 border-b border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="-mx-3 flex min-w-0 gap-1.5 overflow-x-auto px-3 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Show">
                    {RESULT_FILTERS.map((f) => (
                      <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/60 text-muted-foreground hover:text-foreground"}`}>
                        {f.label} <span className="tabular-nums opacity-80">{counts[f.id]}</span>
                      </button>
                    ))}
                  </div>
                  <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as ResultSort)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    <option value="best">Best match first</option>
                    <option value="contact">Most contact details first</option>
                    <option value="name">Name A–Z</option>
                  </select>
                </div>
                {results.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={pickGood}><CheckSquare className="h-3.5 w-3.5" />Select good fits</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={exportCsv}><Download className="h-3.5 w-3.5" />CSV</Button>
                    <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" asChild><Link to="/campaigns" search={{ audience: "lead_finder" }}><Mail className="h-3.5 w-3.5" />Email the ones you added</Link></Button>
                  </div>
                )}
                {unread > 0 && d.currentSearchId && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs">
                    <span>{unread} weren't read in time, so their fit and email aren't known yet.</span>
                    <Button size="sm" variant="outline" className="h-8" disabled={checkM.isPending || !d.isOwner} onClick={() => checkM.mutate(d.currentSearchId!)}>
                      {checkM.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Check them (free)
                    </Button>
                  </div>
                )}
              </div>

              {results.length === 0 ? (
                q.isFetching ? null : <p className="p-8 text-center text-sm text-muted-foreground">No businesses to show for this search.</p>
              ) : shown.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">None of these match that filter.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {shown.map((r) => {
                    const isPicked = picked.includes(r.id);
                    const added = r.status === "added";
                    const EmailIcon = r.emailStatus === "valid" ? MailCheck : r.emailStatus === "risky" ? MailWarning : Mail;
                    const details = [r.category, r.suburb].filter(Boolean).join(" · ");
                    return (
                      <li key={r.id} className={`flex items-start gap-3 px-3 py-2.5 transition-colors ${isPicked ? "bg-primary/5" : "hover:bg-card/60"}`}>
                        <input id={`pick-${r.id}`} type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" aria-label={`Select ${r.name}`} checked={isPicked} disabled={added} onChange={() => toggle(r.id)} />
                        <label htmlFor={`pick-${r.id}`} className={`min-w-0 flex-1 ${added ? "" : "cursor-pointer"}`}>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className="text-sm font-semibold leading-tight">{r.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${FIT_STYLE[r.fit]}`}>{FIT_LABEL[r.fit]}</span>
                            {added && (r.leadId
                              ? <Link to="/leads/$leadId" params={{ leadId: r.leadId }} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b] hover:underline"><CheckCircle2 className="h-3 w-3" />{PROGRESS_LABEL[r.progress ?? "added"]}</Link>
                              : <span className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b]"><CheckCircle2 className="h-3 w-3" />Added</span>)}
                          </div>
                          {(details || r.rating !== null || r.sizeHint || r.contactName) && (
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              {details}
                              {r.rating !== null && <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" />{r.rating.toFixed(1)} ({r.reviewCount ?? 0})</span>}
                              {r.sizeHint && <span className="inline-flex items-center gap-0.5 text-foreground"><Ruler className="h-3 w-3" />{r.sizeHint}</span>}
                              {r.contactName && <span className="inline-flex items-center gap-0.5 font-medium text-foreground"><UserRound className="h-3 w-3 text-primary" />{r.contactName}{r.contactRole ? `, ${r.contactRole}` : ""}</span>}
                            </p>
                          )}
                          {(r.summary || r.fitReason) && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" title={r.fitReason ?? undefined}>{r.summary ?? `Why: ${r.fitReason}`}</p>}
                        </label>
                        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] sm:flex-row sm:items-center">
                          {r.email
                            ? <a href={`mailto:${r.email}`} className="inline-flex max-w-[11rem] items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/15" title={`${r.email} · ${EMAIL_LABEL[r.emailStatus]}`}><EmailIcon className="h-3 w-3 shrink-0" /><span className="truncate">{r.email}</span></a>
                            : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground" title="No published email"><Mail className="h-3 w-3" /><span className="hidden sm:inline">No email</span><span className="sm:hidden">—</span></span>}
                          {r.phone && <a href={`tel:${r.phone.replace(/[^+0-9]/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 hover:bg-muted/70" title={r.phone}><Phone className="h-3 w-3" /><span className="hidden md:inline">{r.phone}</span></a>}
                          {r.website && <a href={r.website} target="_blank" rel="noreferrer" aria-label={`${r.name} website`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-primary hover:bg-muted/70"><Globe className="h-3 w-3" /><ExternalLink className="h-2.5 w-2.5" /></a>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {results.length > 0 && (
                <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">Added businesses appear in Leads and in the campaign audience "Businesses from Lead finder", never in your customer audiences. Ones with only a phone number are added for calling; campaigns skip them.</p>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Actions for the selection, only while something is selected. */}
      {picked.length > 0 && (
        <Portal>
          <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" role="region" aria-label="Selected businesses">
            <div className="glass flex w-full max-w-3xl items-center gap-1.5 px-2 py-2 shadow-lg sm:gap-2 sm:px-3">
              <button type="button" aria-label="Clear selection" onClick={() => setPicked([])} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"><X className="h-4 w-4" /></button>
              <p className="mr-auto min-w-0 truncate text-sm font-medium">{picked.length} selected</p>
              <Button size="sm" variant="ghost" className="shrink-0" aria-label="Hide selected" disabled={dismissM.isPending} onClick={() => dismissM.mutate()}><EyeOff className="h-4 w-4" /><span className="hidden sm:inline">Hide</span></Button>
              <Button size="sm" className="btn-glow shrink-0" disabled={addM.isPending || !d?.isOwner} onClick={() => addM.mutate()}>
                {addM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Add to customers
              </Button>
            </div>
          </div>
        </Portal>
      )}
    </AppShell>
  );
}
