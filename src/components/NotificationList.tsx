import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  CalendarCheck,
  CalendarClock,
  CreditCard,
  MessageSquare,
  UserPlus,
  Bell,
} from "lucide-react";
import { dayGroup, relativeTime } from "@/lib/notifications";

export type NotificationItem = {
  id: string;
  lead_id: string | null;
  kind: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const ICONS: Record<string, { icon: typeof Bell; tone: string }> = {
  booking_confirmed: { icon: CalendarCheck, tone: "text-primary" },
  booking_change_request: { icon: CalendarClock, tone: "text-primary" },
  new_lead: { icon: UserPlus, tone: "text-primary" },
  customer_reply: { icon: MessageSquare, tone: "text-foreground" },
  sms_failed: { icon: AlertTriangle, tone: "text-destructive" },
  ai_analysis_failed: { icon: AlertTriangle, tone: "text-destructive" },
  low_credits: { icon: CreditCard, tone: "text-destructive" },
  trial_ending: { icon: CreditCard, tone: "text-muted-foreground" },
  social_comment: { icon: MessageSquare, tone: "text-primary" },
  assistant_change: { icon: Bot, tone: "text-muted-foreground" },
};

function isBooking(kind: string) {
  return kind === "booking_confirmed" || kind === "booking_change_request";
}

export function NotificationList({
  items,
  onOpen,
}: {
  items: NotificationItem[];
  onOpen: (item: NotificationItem) => void;
}) {
  if (items.length === 0) {
    return <p className="px-1 py-6 text-center text-xs text-muted-foreground">Nothing here yet.</p>;
  }
  let lastGroup = "";
  return (
    <div className="space-y-1">
      {items.map((item) => {
        const group = dayGroup(item.created_at);
        const header = group !== lastGroup ? group : null;
        lastGroup = group;
        const { icon: Icon, tone } = ICONS[item.kind] ?? { icon: Bell, tone: "text-muted-foreground" };
        const unread = !item.read_at;
        return (
          <div key={item.id}>
            {header && (
              <p className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {header}
              </p>
            )}
            <div className={`flex gap-2 rounded-md px-2 py-2 text-xs ${unread ? "bg-secondary/60" : ""}`}>
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-medium ${unread ? "text-foreground" : "text-muted-foreground"}`}>{item.title}</p>
                  {unread && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                </div>
                <p className="mt-0.5 line-clamp-3 whitespace-pre-line break-words text-muted-foreground">{item.body}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <span className="text-[10px] text-muted-foreground" title={new Date(item.created_at).toLocaleString("en-AU")}>
                    {relativeTime(item.created_at)}
                  </span>
                  {isBooking(item.kind) && (
                    <Link to="/bookings" onClick={() => onOpen(item)} className="text-[11px] font-medium text-primary hover:underline">
                      View booking
                    </Link>
                  )}
                  {item.lead_id && (
                    <Link
                      to="/leads/$leadId"
                      params={{ leadId: item.lead_id }}
                      onClick={() => onOpen(item)}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      {item.kind === "customer_reply" || item.kind === "new_lead" ? "Reply" : "Open customer"}
                    </Link>
                  )}
                  {(item.kind === "low_credits" || item.kind === "trial_ending") && (
                    <Link to="/settings/billing" onClick={() => onOpen(item)} className="text-[11px] font-medium text-primary hover:underline">
                      Top up or contact us
                    </Link>
                  )}
                  {item.kind === "social_comment" && (
                    <Link to="/social" onClick={() => onOpen(item)} className="text-[11px] font-medium text-primary hover:underline">
                      Review comment
                    </Link>
                  )}
                  {unread && !item.lead_id && !isBooking(item.kind) && item.kind !== "low_credits" && item.kind !== "trial_ending" && item.kind !== "social_comment" && (
                    <button onClick={() => onOpen(item)} className="text-[11px] text-muted-foreground hover:text-foreground">
                      Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
