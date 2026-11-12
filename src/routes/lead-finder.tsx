import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CheckSquare, Download, ExternalLink, Globe, Loader2, Mail, MailCheck, MailWarning, Phone, RefreshCw, Ruler, Search, Sparkles, Star, UserPlus, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  return (
    <AppShell title="Lead finder">
      <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
        <header>
          <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Lead finder</h1>
          <p className="text-sm text-muted-foreground">Describe the businesses you want to reach. We find them, read their websites, check they fit, and keep the email they publish. Nothing is sent from here.</p>
        </header>

        {d && !ready && (
          <div className="glass p-4 text-sm text-muted-foreground">
            {d.setupMissing ? "Lead finder is waiting for a one-time database update." : "Lead finder isn't switched on for BookedSecure yet. It will work as soon as it is."}
          </div>
        )}

        <section className="glass space-y-3 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Ask Co-Work who to look for</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea rows={1} value={ask} maxLength={500} className="flex-1" placeholder="Optional: e.g. warehouses and gyms around Auburn with 20+ staff. Leave empty and Co-Work suggests from your business profile."
              onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); suggest.mutate(undefined); } }} />
            <Button variant="outline" disabled={suggest.isPending} onClick={() => suggest.mutate(undefined)}>
              {suggest.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />} {ask.trim() ? "Fill the search" : "Suggest searches"}
            </Button>
          </div>
          {suggest.data && suggest.data.suggestions.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {suggest.data.suggestions.map((s) => (
                <button key={`${s.what}|${s.where}`} type="button" onClick={() => applySuggestion(s)}
                  className={`rounded-xl border p-3 text-left text-sm hover:border-primary/60 ${what === s.what && where === s.where ? "border-primary bg-primary/5" : "border-border bg-card/60"}`}>
                  <span className="font-medium">{s.what}</span> <span className="text-muted-foreground">in {s.where}</span>
                  {s.criteria && <span className="block text-xs text-muted-foreground">{s.criteria}</span>}
                  {s.why && <span className="block text-[11px] text-primary">{s.why}</span>}
                </button>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{like ? "Suggestions are based on the customer you opened this from. " : ""}Co-Work reads your business profile and fills the search below. You can change anything before pressing Find.</p>
        </section>

        <section className="glass grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-medium">What kind of business?</span>
            <Input value={what} maxLength={120} placeholder="e.g. cleaning companies" onChange={(e) => setWhat(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Where?</span>
            <Input value={where} maxLength={80} placeholder="e.g. Parramatta NSW, NSW or Australia" onChange={(e) => setWhere(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Who exactly? (optional)</span>
            <Textarea rows={1} value={criteria} maxLength={400} placeholder="e.g. office cleaners with their own team, not franchises" onChange={(e) => setCriteria(e.target.value)} />
          </label>
          <div className="flex items-end gap-2">
            <select aria-label="How many" value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="h-10 rounded-md border border-input bg-background px-2 text-sm">
              {[10, 20, 50].map((n) => <option key={n} value={n}>{n} results</option>)}
            </select>
            <Button disabled={!ready || !d?.isOwner || search.isPending || what.trim().length < 3 || where.trim().length < 2} onClick={() => search.mutate()}>
              {search.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />} Find
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground lg:col-span-4">
            {d ? `${d.usedThisMonth} of ${d.monthlyLimit} searches used this month.` : ""}
            {" "}A state or "Australia" searches its major cities. Only emails a business publishes on its own website are kept. Email them only about their work, and every campaign includes an unsubscribe link, as Australia's Spam Act requires.
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
          <div className="flex flex-wrap gap-1.5">
            {d.searches.map((s) => (
              <button key={s.id} type="button" onClick={() => { setSearchId(s.id); setPicked([]); }}
                className={`rounded-full border px-3 py-1 text-xs ${s.id === d.currentSearchId ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
                {s.query} · {s.area} · {s.status === "failed" ? "failed" : `${s.found} found`} · {relativeTime(s.createdAt)}
              </button>
            ))}
          </div>
        )}

        {results.length > 0 && (
          <section className="glass space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Show">
                {RESULT_FILTERS.map((f) => (
                  <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${filter === f.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card/60 text-muted-foreground hover:text-foreground"}`}>
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

            {unread > 0 && d?.currentSearchId && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
                <span>{unread} business{unread === 1 ? "" : "es"} weren't read in time, so their fit and email aren't known yet.</span>
                <Button size="sm" variant="outline" disabled={checkM.isPending || !d.isOwner} onClick={() => checkM.mutate(d.currentSearchId!)}>
                  {checkM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}Check them (doesn't use a search)
                </Button>
              </div>
            )}

            <div className="sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/80 px-3 py-2 backdrop-blur">
              <p className="text-sm text-muted-foreground">{picked.length ? `${picked.length} selected` : "Select businesses to add to your customers."}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={pickGood}><CheckSquare className="mr-1.5 h-4 w-4" />Select good fits</Button>
                <Button size="sm" variant="outline" disabled={!picked.length || dismissM.isPending} onClick={() => dismissM.mutate()}><X className="mr-1.5 h-4 w-4" />Hide</Button>
                <Button size="sm" className="btn-glow" disabled={!picked.length || addM.isPending || !d?.isOwner} onClick={() => addM.mutate()}>
                  {addM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}Add to customers
                </Button>
                <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
                <Button size="sm" variant="outline" asChild><Link to="/campaigns" search={{ audience: "lead_finder" }}><Mail className="mr-1.5 h-4 w-4" />Email the ones you added</Link></Button>
              </div>
            </div>

            {shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">None of these match that filter.</p>
            ) : (
              <ul className="grid gap-2 md:grid-cols-2">
                {shown.map((r) => {
                  const isPicked = picked.includes(r.id);
                  const added = r.status === "added";
                  const EmailIcon = r.emailStatus === "valid" ? MailCheck : r.emailStatus === "risky" ? MailWarning : Mail;
                  return (
                    <li key={r.id} className={`rounded-xl border p-3 transition-colors ${isPicked ? "border-primary bg-primary/5" : r.fit === "good" ? "border-[#30d158]/40 bg-card/70" : "border-border bg-card/60"} ${added ? "" : "hover:border-primary/50"}`}>
                      <label className={`flex items-start gap-3 ${added ? "" : "cursor-pointer"}`}>
                        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" aria-label={`Select ${r.name}`} checked={isPicked} disabled={added} onChange={() => toggle(r.id)} />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold leading-tight">{r.name}</p>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${FIT_STYLE[r.fit]}`}>{FIT_LABEL[r.fit]}</span>
                            {added && (r.leadId
                              ? <Link to="/leads/$leadId" params={{ leadId: r.leadId }} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b] hover:underline"><CheckCircle2 className="h-3 w-3" />{PROGRESS_LABEL[r.progress ?? "added"]}</Link>
                              : <span className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b]"><CheckCircle2 className="h-3 w-3" />Added</span>)}
                          </div>
                          {([r.category, r.suburb].some(Boolean) || r.rating !== null || r.sizeHint) && (
                            <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              {[r.category, r.suburb].filter(Boolean).join(" · ")}
                              {r.rating !== null && <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3" />{r.rating.toFixed(1)} ({r.reviewCount ?? 0})</span>}
                              {r.sizeHint && <span className="inline-flex items-center gap-0.5 text-foreground"><Ruler className="h-3 w-3" />{r.sizeHint}</span>}
                            </p>
                          )}
                          {r.summary && <p className="text-xs leading-relaxed">{r.summary}</p>}
                          {r.contactName && (
                            <p className="inline-flex items-center gap-1 text-xs font-medium"><UserRound className="h-3.5 w-3.5 text-primary" />{r.contactName}{r.contactRole ? <span className="font-normal text-muted-foreground">, {r.contactRole}</span> : null}</p>
                          )}
                          {r.fitReason && <p className="text-[11px] text-muted-foreground">Why: {r.fitReason}</p>}
                        </div>
                      </label>
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-7 text-[11px]">
                        {r.email
                          ? <a href={`mailto:${r.email}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary hover:bg-primary/15" title={EMAIL_LABEL[r.emailStatus]}><EmailIcon className="h-3 w-3 shrink-0" /><span className="truncate">{r.email}</span></a>
                          : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground"><Mail className="h-3 w-3" />No published email</span>}
                        {r.phone && <a href={`tel:${r.phone.replace(/[^+0-9]/g, "")}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 hover:bg-muted/70"><Phone className="h-3 w-3" />{r.phone}</a>}
                        {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-primary hover:bg-muted/70"><Globe className="h-3 w-3" />Website <ExternalLink className="h-2.5 w-2.5" /></a>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">Added businesses appear in Leads and in the campaign audience "Businesses from Lead finder", never in your customer audiences. Ones with only a phone number are added for calling; campaigns skip them.</p>
          </section>
        )}
        {d && results.length === 0 && d.searches.length > 0 && !q.isFetching && <div className="glass p-8 text-center text-sm text-muted-foreground">No businesses to show for this search.</div>}
      </div>
    </AppShell>
  );
}
