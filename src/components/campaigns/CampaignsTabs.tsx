import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight, Inbox, Mail, SearchCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEmailReplyThreads } from "@/lib/email-replies.functions";
import { getNavCounts } from "@/lib/home.functions";
import { getOutreachProgress } from "@/lib/lead-finder.functions";

/** Unread customer replies, from the same query the Replies inbox uses so both stay in step. */
export function useReplyThreads() {
  const listThreads = useServerFn(getEmailReplyThreads);
  return useQuery({ queryKey: ["email-replies"], queryFn: () => listThreads(), refetchInterval: 60_000 });
}

export type OutreachSection = "finder" | "campaigns" | "replies";

/**
 * Outreach: Find businesses | Campaigns | Inbox, at the top of all three pages
 * (one sidebar item), with the Found → Emailed → Replied → Booked strip under it.
 * On a phone the sidebar is tucked away, so this is how owners move between them.
 */
export function OutreachTabs({ active }: { active: OutreachSection }) {
  // Same query as the sidebar badge: unread email in the inbox, campaign replies included.
  const fetchCounts = useServerFn(getNavCounts);
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: () => fetchCounts(), staleTime: 60_000, retry: false });
  const unread = counts.data?.campaigns ?? 0;
  const item = "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-sm font-medium transition-colors sm:flex-none sm:px-4";
  const on = "bg-white/90 text-foreground shadow-[0_1px_2px_rgb(15_40_90/0.12),inset_0_1px_0_white]";
  const off = "text-muted-foreground hover:text-foreground";
  const current = (section: OutreachSection) => (active === section ? "page" : undefined);
  return (
    <nav aria-label="Outreach" className="flex w-full rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl sm:inline-flex sm:w-auto">
      <Link to="/lead-finder" aria-current={current("finder")} className={cn(item, active === "finder" ? on : off)}>
        <SearchCheck className="size-4 shrink-0 max-sm:hidden" /> <span className="truncate"><span className="sm:hidden">Find</span><span className="max-sm:hidden">Find businesses</span></span>
      </Link>
      <Link to="/campaigns" aria-current={current("campaigns")} className={cn(item, active === "campaigns" ? on : off)}>
        <Mail className="size-4 shrink-0 max-sm:hidden" /> <span className="truncate">Campaigns</span>
      </Link>
      <Link to="/campaigns/replies" aria-current={current("replies")} className={cn(item, active === "replies" ? on : off)}>
        <Inbox className="size-4 shrink-0 max-sm:hidden" /> <span className="truncate">Inbox</span>
        {unread > 0 && (
          <span className="tabular rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground" aria-label={`${unread} unread`}>
            {unread}
          </span>
        )}
      </Link>
    </nav>
  );
}

/** Found → Emailed → Replied → Booked for Lead finder businesses (last 30 days); hidden until there is something to show. */
export function OutreachProgress() {
  const fetchProgress = useServerFn(getOutreachProgress);
  const progress = useQuery({ queryKey: ["outreach-progress"], queryFn: () => fetchProgress(), staleTime: 60_000, retry: false });
  const p = progress.data;
  if (!p || p.found === 0) return null;
  const steps = [
    { label: "Found", value: p.found, to: "/lead-finder" as const },
    { label: "Emailed", value: p.emailed, to: "/campaigns" as const },
    { label: "Replied", value: p.replied, to: "/campaigns/replies" as const },
    { label: "Booked", value: p.booked, to: "/bookings" as const },
  ];
  return (
    <nav aria-label="Lead finder progress, last 30 days" className="glass flex items-center gap-1 overflow-x-auto px-2 py-1.5 text-sm">
      <span className="shrink-0 px-1.5 text-xs text-muted-foreground max-sm:hidden">Last 30 days</span>
      {steps.map((s, i) => (
        <span key={s.label} className="flex shrink-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 text-muted-foreground/70" aria-hidden />}
          <Link to={s.to} className="flex items-baseline gap-1.5 rounded-full px-2 py-1 hover:bg-white/60">
            <span className="tabular font-semibold">{s.value}</span>
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}
