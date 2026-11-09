import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { getEmailReplyThreads } from "@/lib/email-replies.functions";

/** Unread customer replies, from the same query the Replies inbox uses so both stay in step. */
export function useReplyThreads() {
  const listThreads = useServerFn(getEmailReplyThreads);
  return useQuery({ queryKey: ["email-replies"], queryFn: () => listThreads(), refetchInterval: 60_000 });
}

/**
 * Campaigns | Replies switcher at the top of both pages. On a phone the sidebar
 * is tucked away, so this is how owners move between their emails and the answers.
 */
export function CampaignsTabs({ active }: { active: "campaigns" | "replies" }) {
  const threads = useReplyThreads();
  const unread = (threads.data?.threads ?? []).reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);
  const item = "flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors sm:flex-none";
  const on = "bg-white/90 text-foreground shadow-[0_1px_2px_rgb(15_40_90/0.12),inset_0_1px_0_white]";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <nav aria-label="Campaigns sections" className="flex w-full rounded-full border border-white/70 bg-white/40 p-1 backdrop-blur-xl sm:inline-flex sm:w-auto">
      <Link to="/campaigns" aria-current={active === "campaigns" ? "page" : undefined} className={cn(item, active === "campaigns" ? on : off)}>
        <Mail className="size-4" /> Campaigns
      </Link>
      <Link to="/campaigns/replies" aria-current={active === "replies" ? "page" : undefined} className={cn(item, active === "replies" ? on : off)}>
        <Inbox className="size-4" /> Replies
        {unread > 0 && (
          <span className="tabular rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-5 text-primary-foreground" aria-label={`${unread} unread`}>
            {unread}
          </span>
        )}
      </Link>
    </nav>
  );
}
