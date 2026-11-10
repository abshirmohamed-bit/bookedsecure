import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Linkedin, Loader2, Megaphone, MessagesSquare, Phone, Plus, Send, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { getAnalytics } from "@/lib/app.functions";
import { getSmsDeliverySummary } from "@/lib/sms-delivery.functions";
import { getAdPerformance } from "@/lib/meta-direct.functions";
import { getUnfinishedProspects } from "@/lib/quote-funnel.functions";
import { listSocialComments, listSocialThreads } from "@/lib/social-comments.functions";
import { getEmailCampaigns } from "@/lib/email-campaigns.functions";
import { getLinkedIn, postToLinkedIn, writeLinkedInPost } from "@/lib/linkedin.functions";

/**
 * Small views of the main tools for Home on tablets and bigger screens: each
 * reads the same data as its own page (same query keys, so caches are shared)
 * and links through to the full page. Nothing new is stored here.
 */

function Snippet({ title, icon, to, linkLabel, children, className }: {
  title: string;
  icon?: ReactNode;
  to: string;
  linkLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-3.5 shadow-sm", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold">{icon}{title}</h2>
        <Link to={to} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
          {linkLabel} <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {children}
    </section>
  );
}

const Loading = () => <div className="h-14 animate-pulse rounded-lg bg-secondary/60" />;
const Quiet = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted-foreground">{children}</p>;

function Figure({ label, value, tone }: { label: string; value: string; tone?: "warn" | undefined }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("tabular text-base font-semibold", tone === "warn" && "text-warning-foreground")}>{value}</dd>
    </div>
  );
}

export function TextMessagesSnippet() {
  const load = useServerFn(getSmsDeliverySummary);
  const q = useQuery({ queryKey: ["sms-delivery-summary"], queryFn: () => load() });
  const d = q.data;
  const attention = d ? d.failed + d.undelivered : 0;
  return (
    <Snippet title="Text messages" to="/analytics" linkLabel="Results">
      {q.isLoading ? <Loading /> : !d ? <Quiet>Text numbers couldn't be loaded.</Quiet> : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <Figure label="Outbound" value={String(d.total)} />
          <Figure label="Delivered" value={String(d.delivered)} />
          <Figure label="Delivery rate" value={d.deliveryRate == null ? "–" : `${Math.round(d.deliveryRate * 100)}%`} />
          <Figure label="Needs attention" value={String(attention)} tone={attention > 0 ? "warn" : undefined} />
        </dl>
      )}
    </Snippet>
  );
}

export function LeadProgressSnippet() {
  const load = useServerFn(getAnalytics);
  const q = useQuery({ queryKey: ["analytics", "all-time"], queryFn: () => load({ data: { from: null, to: null, source: null } }) });
  const f = q.data?.funnel;
  const rows = f ? ([["Enquiries", f.enquiries], ["Contacted", f.contacted], ["Replied", f.replied], ["Booked", f.scheduled], ["Completed", f.completed]] as const) : [];
  const top = f?.enquiries || 1;
  return (
    <Snippet title="Lead progress" to="/analytics" linkLabel="Results">
      {q.isLoading ? <Loading /> : !f ? <Quiet>Lead numbers couldn't be loaded.</Quiet> : (
        <ul className="space-y-1.5">
          {rows.map(([label, value]) => (
            <li key={label} className="text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">{label}</span><span className="tabular font-semibold">{value}</span></div>
              <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(value ? 2 : 0, Math.round((value / top) * 100))}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Snippet>
  );
}

export function FacebookAdsSnippet() {
  const load = useServerFn(getAdPerformance);
  const q = useQuery({ queryKey: ["fb-ad-performance", 30], queryFn: () => load({ data: { days: 30 } }), retry: false });
  // Owner-only report: staff accounts simply don't see this panel.
  if (q.isError && /owner/i.test(q.error instanceof Error ? q.error.message : "")) return null;
  const d = q.data;
  if (d && !d.account && d.campaigns.length === 0) return null;
  const currency = d?.account?.currency ?? "AUD";
  const money = (n: number | null) => (n === null ? "–" : new Intl.NumberFormat("en-AU", { style: "currency", currency, maximumFractionDigits: n >= 100 ? 0 : 2 }).format(n));
  return (
    <Snippet title="Facebook ads · 30 days" icon={<Megaphone className="size-3.5 text-primary" />} to="/analytics" linkLabel="Details">
      {q.isLoading ? <Loading /> : !d ? <Quiet>Ad results couldn't be loaded.</Quiet> : (
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
          <Figure label="Spend" value={money(d.total.spend)} />
          <Figure label="Leads" value={String(d.total.leads)} />
          <Figure label="Cost/lead" value={money(d.total.costPerLead)} />
          <Figure label="Booked" value={String(d.total.booked)} />
          <Figure label="Completed" value={String(d.total.completed)} />
          <Figure label="Return" value={d.total.roas === null ? "–" : `${d.total.roas.toFixed(1)}×`} />
        </dl>
      )}
    </Snippet>
  );
}

export function UnfinishedSnippet() {
  const load = useServerFn(getUnfinishedProspects);
  const q = useQuery({ queryKey: ["unfinished-prospects", 90], queryFn: () => load({ data: { days: 90 } }) });
  const list = q.data?.prospects ?? [];
  return (
    <Snippet title={`Unfinished quotes${list.length ? ` · ${list.length}` : ""}`} to="/unfinished" linkLabel="All">
      {q.isLoading ? <Loading /> : list.length === 0 ? <Quiet>Nobody has left a quote half done.</Quiet> : (
        <ul className="divide-y divide-border">
          {list.slice(0, 3).map((p) => (
            <li key={p.conversationId} className="flex items-center gap-2 py-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name ?? "No name given"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{[p.services[0], p.suburb, p.stageLabel].filter(Boolean).join(" · ")}</p>
              </div>
              <a href={`tel:${p.mobile.replace(/\s/g, "")}`} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2 py-1 text-[11px] font-medium hover:bg-secondary">
                <Phone className="size-3" /> Call
              </a>
            </li>
          ))}
        </ul>
      )}
    </Snippet>
  );
}

export function SocialSnippet() {
  const loadComments = useServerFn(listSocialComments);
  const loadThreads = useServerFn(listSocialThreads);
  const comments = useQuery({ queryKey: ["social-comments", "pending_review"], queryFn: () => loadComments({ data: { status: "pending_review" } }) });
  const threads = useQuery({ queryKey: ["social-threads"], queryFn: () => loadThreads(), refetchInterval: 60_000 });
  const toReview = comments.data ?? [];
  const waiting = (threads.data?.threads ?? []).filter((t) => t.lastFromCustomer);
  return (
    <Snippet title="Facebook and Instagram" icon={<MessagesSquare className="size-3.5 text-primary" />} to="/social" linkLabel="Open">
      {comments.isLoading || threads.isLoading ? <Loading /> : (
        <>
          <dl className="mb-2 grid grid-cols-2 gap-x-4">
            <Figure label="Comments to review" value={String(toReview.length)} tone={toReview.length ? "warn" : undefined} />
            <Figure label="Messages waiting" value={String(waiting.length)} tone={waiting.length ? "warn" : undefined} />
          </dl>
          {toReview.length === 0 && waiting.length === 0 ? <Quiet>You're all caught up.</Quiet> : (
            <ul className="divide-y divide-border">
              {toReview.slice(0, 2).map((c) => (
                <li key={c.id} className="py-1.5">
                  <p className="truncate text-xs"><span className="font-medium">{c.author_name ?? "Someone"}</span> <span className="text-muted-foreground">· {c.platform === "instagram" ? "Instagram" : "Facebook"} comment</span></p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.comment_text}</p>
                </li>
              ))}
              {waiting.slice(0, Math.max(0, 3 - Math.min(2, toReview.length))).map((t) => (
                <li key={`${t.platform}:${t.participantId}`} className="py-1.5">
                  <p className="truncate text-xs"><span className="font-medium">{t.name ?? "Someone"}</span> <span className="text-muted-foreground">· message · {relativeTime(t.lastAt)}</span></p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.last}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Snippet>
  );
}

export function CampaignsSnippet() {
  const load = useServerFn(getEmailCampaigns);
  const q = useQuery({ queryKey: ["email-campaigns-home"], queryFn: () => load() });
  const list = q.data ?? [];
  const sent = list.reduce((n, c) => n + c.counts.sent + c.counts.followUpsSent, 0);
  const booked = list.reduce((n, c) => n + c.counts.booked, 0);
  const replies = list.reduce((n, c) => n + (c.counts.replied ?? 0), 0);
  const live = list.filter((c) => c.status === "draft" || c.status === "scheduled").length;
  return (
    <Snippet title="Campaigns" to="/campaigns" linkLabel="Open">
      {q.isLoading ? <Loading /> : (
        <>
          <dl className="mb-2 grid grid-cols-4 gap-x-2">
            <Figure label="Drafts" value={String(live)} />
            <Figure label="Sent" value={String(sent)} />
            <Figure label="Replies" value={String(replies)} />
            <Figure label="Booked" value={String(booked)} />
          </dl>
          {list.length === 0 ? <Quiet>No campaigns yet.</Quiet> : (
            <ul className="divide-y divide-border">
              {list.slice(0, 3).map((c) => (
                <li key={c.id}>
                  <Link to="/campaigns/$campaignId" params={{ campaignId: c.id }} className="flex items-center gap-2 py-1.5 hover:text-primary">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{c.name}</span>
                    <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{c.status}</span>
                    <span className="shrink-0 tabular text-[11px] text-muted-foreground">{c.counts.sent}/{c.counts.total}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/campaigns" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Plus className="size-3.5" /> New campaign
          </Link>
        </>
      )}
    </Snippet>
  );
}

/** A quick LinkedIn post (text only); photos, video and documents are on the full page. */
export function LinkedInSnippet() {
  const qc = useQueryClient();
  const load = useServerFn(getLinkedIn);
  const write = useServerFn(writeLinkedInPost);
  const post = useServerFn(postToLinkedIn);
  const q = useQuery({ queryKey: ["linkedin"], queryFn: () => load() });
  const [text, setText] = useState("");
  const draft = useMutation({
    mutationFn: () => write({ data: { brief: text, chips: [] } }),
    onSuccess: (r) => setText(r.text),
    onError: (e) => toast.error(e instanceof Error ? e.message : "The AI couldn't write a post."),
  });
  const publish = useMutation({
    mutationFn: () => post({ data: { text, authorUrn: q.data?.defaultAuthorUrn ?? null, media: null } }),
    onSuccess: (r) => {
      toast.success(r.duplicate ? "That post was already published." : `Posted to LinkedIn as ${r.authorName}.`);
      setText("");
      void qc.invalidateQueries({ queryKey: ["linkedin"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "LinkedIn didn't accept the post."),
  });
  const d = q.data;
  if (q.isLoading) return <Snippet title="LinkedIn posts" icon={<Linkedin className="size-3.5 text-[#0a66c2]" />} to="/linkedin" linkLabel="Open"><Loading /></Snippet>;
  if (!d || d.setupMissing) return null;
  const author = d.authors.find((a) => a.urn === d.defaultAuthorUrn) ?? d.authors[0];
  return (
    <Snippet title="LinkedIn posts" icon={<Linkedin className="size-3.5 text-[#0a66c2]" />} to="/linkedin" linkLabel="Open">
      {!d.connected ? (
        <Quiet>Connect LinkedIn to post from here. <Link to="/linkedin" className="font-medium text-primary hover:underline">Connect</Link></Quiet>
      ) : (
        <div className="space-y-2">
          <Textarea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a post, or type what it's about and press Write with AI."
            className="resize-none text-sm"
            aria-label="LinkedIn post"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => draft.mutate()} disabled={draft.isPending}>
              {draft.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />} Write with AI
            </Button>
            {d.isOwner && (
              <Button size="sm" className="ml-auto" onClick={() => publish.mutate()} disabled={!text.trim() || publish.isPending || d.expired}>
                {publish.isPending ? <Loader2 className="animate-spin" /> : <Send />} Post
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Posts as {author?.name ?? "you"}. Photos, video and documents: open the full page.</p>
          {d.posts[0] && (
            <p className="truncate border-t border-border pt-2 text-[11px] text-muted-foreground">
              Last post {relativeTime(d.posts[0].publishedAt ?? d.posts[0].createdAt)}: {d.posts[0].bodyText}
            </p>
          )}
        </div>
      )}
    </Snippet>
  );
}
