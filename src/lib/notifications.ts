// Browser-safe notification helpers shared by the bell, the full page and settings.

export type NotificationFilter = "all" | "unread" | "bookings" | "messages";

export const NOTIFICATION_KINDS = [
  { kind: "booking_confirmed", label: "New bookings", group: "bookings" },
  { kind: "booking_change_request", label: "Booking change requests", group: "bookings" },
  { kind: "new_lead", label: "New enquiries", group: "messages" },
  { kind: "customer_reply", label: "Customer text replies", group: "messages" },
  { kind: "sms_failed", label: "Texts that didn't arrive", group: "messages" },
  { kind: "low_credits", label: "Low text credits", group: "account" },
  { kind: "trial_ending", label: "Trial ending soon", group: "account" },
  { kind: "assistant_change", label: "Changes made by ChatGPT or other AI apps", group: "account" },
  { kind: "ai_analysis_failed", label: "AI couldn't read a message", group: "messages" },
] as const;

export function kindsForFilter(filter: NotificationFilter): string[] | null {
  if (filter === "bookings") return NOTIFICATION_KINDS.filter((k) => k.group === "bookings").map((k) => k.kind);
  if (filter === "messages") return NOTIFICATION_KINDS.filter((k) => k.group === "messages").map((k) => k.kind);
  return null;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const seconds = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export function dayGroup(iso: string, now: Date = new Date()): "Today" | "Yesterday" | "Earlier" {
  const d = new Date(iso);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (d >= start) return "Today";
  start.setDate(start.getDate() - 1);
  if (d >= start) return "Yesterday";
  return "Earlier";
}

/** Trial reminder fires once in the last 3 days of a trial. */
export function trialEndingSoon(status: string | null | undefined, periodEnd: string | null | undefined, now: Date = new Date()): boolean {
  if (status !== "trialing" || !periodEnd) return false;
  const ms = new Date(periodEnd).getTime() - now.getTime();
  return ms > 0 && ms <= 3 * 24 * 3600 * 1000;
}
