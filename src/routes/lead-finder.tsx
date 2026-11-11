import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ExternalLink, Globe, Loader2, Mail, Phone, Search, Sparkles, Star, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/notifications";
import { addLeadFinderResults, dismissLeadFinderResults, getLeadFinder, runLeadFinderSearch, suggestLeadFinderSearches } from "@/lib/lead-finder.functions";

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
  const [ask, setAsk] = useState("");
  const suggestFn = useServerFn(suggestLeadFinderSearches);
  const suggest = useMutation({
    mutationFn: (likeLeadId?: string) => suggestFn({ data: { request: ask.trim() || null, likeLeadId: likeLeadId ?? null } }),
    onSuccess: (r) => {
      if (r.suggestions.length === 0) toast.message("Co-work couldn't suggest a search. Try describing who you want to reach.");
      else if ((ask.trim() || like) && r.suggestions[0]) applySuggestion(r.suggestions[0]);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Co-work couldn't suggest searches."),
  });
  const applySuggestion = (s: { what: string; where: string; criteria: string | null }) => { setWhat(s.what); setWhere(s.where); setCriteria(s.criteria ?? ""); };
  // Opened from a customer's page: Co-work suggests businesses like them straight away.
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
  const addM = useMutation({
    mutationFn: () => add({ data: { ids: picked } }),
    onSuccess: async (r) => {
      toast.success(`Added ${r.added} to your customers${r.skipped ? ` (${r.skipped} skipped: no usable email or already added)` : ""}.`, {
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
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

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
          <p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Ask Co-work who to look for</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Textarea rows={1} value={ask} maxLength={500} className="flex-1" placeholder="Optional: e.g. warehouses and gyms around Auburn with 20+ staff. Leave empty and Co-work suggests from your business profile."
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
          <p className="text-[11px] text-muted-foreground">{like ? "Suggestions are based on the customer you opened this from. " : ""}Co-work reads your business profile and fills the search below. You can change anything before pressing Find.</p>
        </section>

        <section className="glass grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-medium">What kind of business?</span>
            <Input value={what} maxLength={120} placeholder="e.g. cleaning companies" onChange={(e) => setWhat(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-medium">Where?</span>
            <Input value={where} maxLength={80} placeholder="e.g. Parramatta NSW" onChange={(e) => setWhere(e.target.value)} />
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
            {search.isPending ? "Reading each business's website. This can take a minute." : d ? `${d.usedThisMonth} of ${d.monthlyLimit} searches used this month.` : ""}
            {" "}Only emails a business publishes on its own website are kept. Email them only about their work, and every campaign includes an unsubscribe link, as Australia's Spam Act requires.
          </p>
        </section>

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
          <section className="glass p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">{picked.length ? `${picked.length} selected` : "Select the businesses to add to your customers."}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!picked.length || dismissM.isPending} onClick={() => dismissM.mutate()}><X className="mr-1.5 h-4 w-4" />Hide</Button>
                <Button size="sm" disabled={!picked.length || addM.isPending || !d?.isOwner} onClick={() => addM.mutate()}>
                  {addM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserPlus className="mr-1.5 h-4 w-4" />}Add to customers
                </Button>
                <Button size="sm" variant="outline" asChild><Link to="/campaigns" search={{ audience: "lead_finder" }}>Email the businesses you added</Link></Button>
              </div>
            </div>
            <ul className="grid gap-2 md:grid-cols-2">
              {results.map((r) => (
                <li key={r.id} className={`rounded-xl border p-3 ${picked.includes(r.id) ? "border-primary bg-primary/5" : "border-border bg-card/60"}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" aria-label={`Select ${r.name}`} checked={picked.includes(r.id)} disabled={r.status === "added"} onChange={() => toggle(r.id)} />
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{r.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${FIT_STYLE[r.fit]}`}>{FIT_LABEL[r.fit]}</span>
                        {r.status === "added" && (
                          r.leadId
                            ? <Link to="/leads/$leadId" params={{ leadId: r.leadId }} className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b] hover:underline"><CheckCircle2 className="h-3 w-3" />{PROGRESS_LABEL[r.progress ?? "added"]}</Link>
                            : <span className="inline-flex items-center gap-1 text-[11px] text-[#1f8a3b]"><CheckCircle2 className="h-3 w-3" />Added</span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {[r.category, r.suburb].filter(Boolean).join(" · ")}
                        {r.rating !== null && <> · <Star className="inline h-3 w-3" /> {r.rating.toFixed(1)} ({r.reviewCount ?? 0})</>}
                      </p>
                      {r.summary && <p className="text-xs">{r.summary}</p>}
                      {r.fitReason && <p className="text-[11px] text-muted-foreground">Why: {r.fitReason}</p>}
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                        {r.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.email} <span className="text-muted-foreground">({EMAIL_LABEL[r.emailStatus]})</span></span>
                          : <span className="inline-flex items-center gap-1 text-muted-foreground"><Mail className="h-3 w-3" />No published email</span>}
                        {r.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone}</span>}
                        {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary"><Globe className="h-3 w-3" />Website <ExternalLink className="h-2.5 w-2.5" /></a>}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">Added businesses appear in Leads and in the campaign audience "Businesses from Lead finder". They're never mixed into your customer audiences.</p>
          </section>
        )}
        {d && results.length === 0 && d.searches.length > 0 && !q.isFetching && <div className="glass p-8 text-center text-sm text-muted-foreground">No businesses to show for this search.</div>}
      </div>
    </AppShell>
  );
}
