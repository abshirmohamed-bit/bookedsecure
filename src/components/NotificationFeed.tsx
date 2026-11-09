import type React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bell,
  Bot,
  CalendarCheck,
  CalendarClock,
  Check,
  CreditCard,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/notifications";
import { buildFeed, feedSections, type FeedGroup, type FeedRow } from "@/lib/notification-feed";

const KIND_ICON: Record<string, typeof Bell> = {
  new_lead: UserPlus,
  booking_confirmed: CalendarCheck,
  booking_change_request: CalendarClock,
  customer_reply: MessageSquare,
  social_message: MessageCircle,
  social_comment: MessagesSquare,
  sms_failed: AlertTriangle,
  ai_analysis_failed: AlertTriangle,
  low_credits: CreditCard,
  trial_ending: CreditCard,
  assistant_change: Bot,
};

const CATEGORY_TONE: Record<FeedGroup["category"], string> = {
  leads: "from-[var(--primary-bright)] to-[var(--primary)] text-white",
  bookings: "from-[oklch(0.78_0.13_165)] to-[oklch(0.62_0.15_165)] text-white",
  messages: "from-[oklch(0.74_0.13_225)] to-[oklch(0.56_0.15_245)] text-white",
  comments: "from-[oklch(0.8_0.1_210)] to-[oklch(0.62_0.13_225)] text-white",
  account: "from-white to-white/70 text-muted-foreground",
};

function GroupIcon({ group }: { group: FeedGroup }) {
  const Icon = KIND_ICON[group.kind] ?? Bell;
  const danger = group.kind === "sms_failed" || group.kind === "ai_analysis_failed" || group.kind === "low_credits";
  return (
    <span
      className={cn(
        "relative grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_4px_10px_-4px_oklch(0.3_0.1_258/0.35)]",
        danger ? "from-[oklch(0.75_0.15_30)] to-[oklch(0.6_0.2_25)] text-white" : CATEGORY_TONE[group.category],
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * The grouped notification feed shared by the bell and the full page.
 * One card per conversation, comment batch or item; tapping a card opens
 * where it belongs and marks the whole group read.
 */
export function NotificationFeed({
  rows,
  onMarkRead,
  onNavigate,
  compact = false,
  emptyText = "You're all caught up.",
}: {
  rows: FeedRow[];
  onMarkRead: (ids: string[]) => void;
  onNavigate?: () => void;
  compact?: boolean;
  emptyText?: string;
}) {
  const navigate = useNavigate();
  const sections = feedSections(buildFeed(rows), new Date(), compact ? { recentLeadLimit: 3 } : {});

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <span className="grid size-10 place-items-center rounded-2xl bg-white/70 text-primary shadow-[inset_0_1px_0_white]">
          <Check className="size-5" />
        </span>
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  const open = (group: FeedGroup) => {
    if (group.unreadIds.length) onMarkRead(group.unreadIds);
    if (!group.link) return;
    onNavigate?.();
    void navigate(group.link as Parameters<typeof navigate>[0]);
  };

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <section key={section.label} aria-label={section.label}>
          <p
            className={cn(
              "flex items-center gap-2 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider",
              section.id === "new-leads" ? "text-primary" : "text-muted-foreground",
            )}
          >
            {section.label}
            {(section.id === "new-leads" || section.id === "other-new") && (
              <span className={cn("rounded-full px-1.5 py-px text-[10px]", section.id === "new-leads" ? "bg-primary text-primary-foreground" : "bg-foreground/10")}>
                {section.groups.length}
              </span>
            )}
            {section.id === "other-new" && <span className="h-px flex-1 bg-foreground/10" />}
          </p>
          <ul className="space-y-1.5">
            {section.groups.map((group) => {
              const unread = group.unreadIds.length > 0;
              return (
                <li key={group.key}>
                  <div
                    role={group.link ? "link" : undefined}
                    tabIndex={group.link ? 0 : undefined}
                    onClick={() => open(group)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), open(group))}
                    className={cn(
                      "group/card flex gap-3 rounded-2xl border p-2.5 transition-all",
                      group.link && "cursor-pointer",
                      unread && group.category === "leads"
                        ? "border-primary/30 bg-white/90 shadow-[inset_0_1px_0_white,0_0_0_1px_color-mix(in_oklab,var(--primary)_18%,transparent),0_10px_24px_-14px_color-mix(in_oklab,var(--primary)_70%,transparent)] hover:bg-white"
                        : unread
                          ? "border-white/80 bg-white/70 shadow-[inset_0_1px_0_white,0_6px_18px_-12px_oklch(0.3_0.1_258/0.45)] hover:bg-white/90"
                          : "border-transparent bg-white/30 hover:bg-white/55",
                    )}
                  >
                    <GroupIcon group={group} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <p className={cn("min-w-0 flex-1 truncate text-sm", unread ? "font-semibold text-foreground" : "font-medium text-foreground/80")}>
                          {group.title}
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground" title={new Date(group.latestAt).toLocaleString("en-AU")}>
                          {relativeTime(group.latestAt)}
                        </span>
                        {unread && <span className="size-2 shrink-0 self-center rounded-full bg-primary" aria-label="Unread" />}
                      </div>
                      {(group.subtitle || group.countLabel) && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {group.subtitle && <span>{group.subtitle}</span>}
                          {group.countLabel && (
                            <span className={cn("rounded-full px-1.5 py-px font-medium", unread ? "bg-primary/12 text-primary" : "bg-foreground/8")}>
                              {group.countLabel}
                            </span>
                          )}
                        </p>
                      )}
                      {group.preview.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {group.preview.slice(compact ? -2 : -3).map((line, i) => (
                            <p key={i} className="line-clamp-2 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                              {line}
                            </p>
                          ))}
                        </div>
                      )}
                      {(group.action || unread) && (
                        <div className="mt-1.5 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                          {group.action && group.link && (
                            <Link
                              {...(group.link as React.ComponentProps<typeof Link>)}
                              onClick={() => {
                                if (unread) onMarkRead(group.unreadIds);
                                onNavigate?.();
                              }}
                              className="text-xs font-semibold text-primary hover:underline"
                            >
                              {group.action}
                            </Link>
                          )}
                          {unread && (
                            <button
                              type="button"
                              onClick={() => onMarkRead(group.unreadIds)}
                              className="text-xs text-muted-foreground opacity-80 hover:text-foreground hover:opacity-100"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          {section.more ? (
            <Link
              to="/leads"
              onClick={() => onNavigate?.()}
              className="mt-1.5 block rounded-xl px-2 py-1.5 text-center text-xs font-medium text-primary hover:bg-white/60"
            >
              {section.more} more recent lead{section.more === 1 ? "" : "s"} · Open Leads
            </Link>
          ) : null}
        </section>
      ))}
    </div>
  );
}
