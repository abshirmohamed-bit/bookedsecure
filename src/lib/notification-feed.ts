/**
 * Turns raw notification rows into a tidy feed: related alerts are grouped
 * (every message in one conversation, a day's comments on one platform, repeat
 * alerts for the same lead), raw data is cleaned into plain words, and each
 * group says where to go next. Pure and browser-safe: the bell, the full page
 * and the unread badge all use these same rules.
 */
import { humanizeAnswer } from "@/lib/lead-sync";

export type FeedRow = {
  id: string;
  lead_id: string | null;
  kind: string;
  title: string;
  body: string;
  metadata?: unknown;
  created_at: string;
  read_at: string | null;
};

export type FeedCategory = "leads" | "bookings" | "messages" | "comments" | "account";

export const FEED_FILTERS = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "leads", label: "Leads" },
  { id: "bookings", label: "Bookings" },
  { id: "messages", label: "Messages" },
  { id: "comments", label: "Comments" },
  { id: "account", label: "Account" },
] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number]["id"];

const CATEGORY_BY_KIND: Record<string, FeedCategory> = {
  new_lead: "leads",
  booking_confirmed: "bookings",
  booking_change_request: "bookings",
  customer_reply: "messages",
  social_message: "messages",
  email_reply: "messages",
  social_comment: "comments",
  sms_failed: "account",
  ai_analysis_failed: "account",
  low_credits: "account",
  trial_ending: "account",
  assistant_change: "account",
};

export function categoryOf(kind: string): FeedCategory {
  return CATEGORY_BY_KIND[kind] ?? "account";
}

/** Notification kinds a filter covers, for the server query (null = every kind). */
export function kindsForFeedFilter(filter: FeedFilter): string[] | null {
  if (filter === "all" || filter === "unread") return null;
  return Object.entries(CATEGORY_BY_KIND)
    .filter(([, category]) => category === filter)
    .map(([kind]) => kind);
}

export type FeedLink =
  | { to: "/leads/$leadId"; params: { leadId: string } }
  | { to: "/social"; search: { view: "comments" | "messages"; platform?: "facebook" | "instagram" } }
  | { to: "/campaigns/replies"; search: { thread?: string; conversation?: string } }
  | { to: "/bookings" }
  | { to: "/settings/billing" }
  | { to: "/settings/messaging" }
  | { to: "/assistant" };

export type FeedGroup = {
  key: string;
  kind: string;
  category: FeedCategory;
  ids: string[];
  unreadIds: string[];
  latestAt: string;
  title: string;
  subtitle: string | null;
  preview: string[];
  count: number;
  countLabel: string | null;
  link: FeedLink | null;
  action: string | null;
  platform: "facebook" | "instagram" | null;
};

const meta = (row: FeedRow) => (row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {});
const str = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);

function platformOf(row: FeedRow): "facebook" | "instagram" | null {
  const text = row.title.toLowerCase();
  if (text.includes("instagram")) return "instagram";
  if (text.includes("facebook") || text.includes("messenger")) return "facebook";
  return null;
}

/** "imabshir: hello" → ["imabshir", "hello"]. */
function splitAuthor(body: string): [string | null, string] {
  const match = body.match(/^([^:\n]{1,60}):\s([\s\S]*)$/);
  return match ? [match[1]!.trim(), match[2]!.trim()] : [null, body.trim()];
}

function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** Plain-words lines for a new-enquiry alert: no ISO timestamps, no option keys. */
export function cleanLeadLines(row: FeedRow): { name: string | null; lines: string[] } {
  const m = meta(row);
  const service = str(m["service_intent"]);
  const suburb = str(m["suburb"]) ?? str(m["service_address"]);
  const phone = str(m["mobile_number"]);
  const name = str(m["name"]);
  if (service || suburb || phone) {
    return {
      name,
      lines: [service ? humanizeAnswer(service) : null, [suburb, phone].filter(Boolean).join(" · ") || null].filter(
        (line): line is string => Boolean(line),
      ),
    };
  }
  const lines = row.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^received:/i.test(line))
    .map((line) => {
      const [label, ...rest] = line.split(": ");
      const value = rest.join(": ");
      if (!value) return line;
      if (/^(service|timing|starting prices|extras|vehicle)$/i.test(label!)) {
        return `${label}: ${value.split(/;\s*/).map((part) => humanizeAnswer(part.trim())).join("; ")}`;
      }
      return line;
    });
  return { name, lines: lines.slice(0, 3) };
}

/** Which conversation, comment batch or lead a row belongs to. */
export function groupKey(row: FeedRow): string {
  switch (row.kind) {
    case "social_message": {
      const [author] = splitAuthor(row.body);
      return `dm:${platformOf(row) ?? "social"}:${(author ?? row.id).toLowerCase()}`;
    }
    case "social_comment":
      return `comments:${platformOf(row) ?? "social"}:${localDay(row.created_at)}`;
    case "customer_reply":
      return row.lead_id ? `text:${row.lead_id}` : `row:${row.id}`;
    case "email_reply": {
      const recipient = str(meta(row)["recipient_id"]);
      const thread = str(meta(row)["thread_id"]);
      return recipient ? `email:${recipient}` : thread ? `email-thread:${thread}` : row.lead_id ? `email-lead:${row.lead_id}` : `row:${row.id}`;
    }
    case "new_lead":
      return row.lead_id ? `lead:${row.lead_id}` : `row:${row.id}`;
    case "sms_failed":
      return row.lead_id ? `failed:${row.lead_id}:${localDay(row.created_at)}` : `row:${row.id}`;
    default:
      return `row:${row.id}`;
  }
}

const platformName = (p: "facebook" | "instagram" | null) => (p === "instagram" ? "Instagram" : p === "facebook" ? "Facebook" : "social");

function describe(rows: FeedRow[]): Omit<FeedGroup, "key" | "ids" | "unreadIds" | "latestAt" | "count"> {
  const latest = rows[0]!;
  const kind = latest.kind;
  const category = categoryOf(kind);
  const platform = platformOf(latest);
  const unread = rows.filter((r) => !r.read_at).length;
  const n = rows.length;

  if (kind === "social_message") {
    const [author] = splitAuthor(latest.body);
    return {
      kind, category, platform,
      title: author ?? `${platformName(platform)} message`,
      subtitle: `${platformName(platform)} message${n > 1 ? "s" : ""}`,
      preview: rows.slice(0, 2).map((r) => splitAuthor(r.body)[1]).reverse(),
      countLabel: n > 1 ? `${unread > 1 ? unread : n} ${unread > 1 ? "new" : "messages"}` : null,
      link: { to: "/social", search: { view: "messages", ...(platform === "facebook" || platform === "instagram" ? { platform } : {}) } },
      action: "Reply",
    };
  }
  if (kind === "social_comment") {
    return {
      kind, category, platform,
      title: n > 1 ? `${n} ${platformName(platform)} comments to review` : `${platformName(platform)} comment to review`,
      subtitle: null,
      preview: rows.slice(0, 3).map((r) => {
        const [author, text] = splitAuthor(r.body);
        return author ? `${author}: ${text}` : text;
      }),
      countLabel: null,
      link: { to: "/social", search: { view: "comments", ...(platform === "facebook" || platform === "instagram" ? { platform } : {}) } },
      action: n > 1 ? "Review all" : "Review",
    };
  }
  if (kind === "email_reply") {
    const name = latest.title.replace(/^Email from\s+/i, "");
    const recipient = str(meta(latest)["recipient_id"]);
    const thread = str(meta(latest)["thread_id"]);
    return {
      kind, category, platform,
      title: name,
      subtitle: thread ? (n > 1 ? "Emails" : "Email") : n > 1 ? "Email replies" : "Email reply",
      preview: rows.slice(0, 2).map((r) => r.body.trim()).reverse(),
      countLabel: n > 1 ? `${n} emails` : null,
      link: { to: "/campaigns/replies", search: recipient ? { thread: recipient } : thread ? { conversation: thread } : {} },
      action: "Reply",
    };
  }
  if (kind === "customer_reply") {
    const name = latest.title.replace(/^Text from\s+/i, "");
    return {
      kind, category, platform,
      title: name,
      subtitle: n > 1 ? "Text replies" : "Text reply",
      preview: rows.slice(0, 2).map((r) => r.body.trim()).reverse(),
      countLabel: n > 1 ? `${n} texts` : null,
      link: latest.lead_id ? { to: "/leads/$leadId", params: { leadId: latest.lead_id } } : null,
      action: "Reply",
    };
  }
  if (kind === "new_lead") {
    const { name, lines } = cleanLeadLines(latest);
    const headline = latest.title;
    const label = /^returning/i.test(headline)
      ? "Returning customer"
      : /booking request/i.test(headline)
        ? "Booking request"
        : /quote request/i.test(headline)
          ? "Quote request"
          : "New enquiry";
    const fromTitle = headline.split(": ").slice(1).join(": ").trim() || null;
    return {
      kind, category, platform,
      title: name ?? fromTitle ?? "New enquiry",
      subtitle: label,
      preview: lines,
      countLabel: null,
      link: latest.lead_id ? { to: "/leads/$leadId", params: { leadId: latest.lead_id } } : null,
      action: "Open lead",
    };
  }
  const link: FeedLink | null = kind.startsWith("booking")
    ? { to: "/bookings" }
    : kind === "low_credits" || kind === "trial_ending"
      ? { to: "/settings/billing" }
      : kind === "sms_failed" && latest.lead_id
        ? { to: "/leads/$leadId", params: { leadId: latest.lead_id } }
        : kind === "assistant_change"
          ? { to: "/assistant" }
          : latest.lead_id
            ? { to: "/leads/$leadId", params: { leadId: latest.lead_id } }
            : null;
  const action = kind.startsWith("booking")
    ? "View booking"
    : kind === "low_credits" || kind === "trial_ending"
      ? "Top up"
      : link
        ? "Open"
        : null;
  return {
    kind, category, platform,
    title: latest.title,
    subtitle: null,
    preview: latest.body ? [latest.body.trim()] : [],
    countLabel: n > 1 ? `${n} times` : null,
    link,
    action,
  };
}

/**
 * Groups rows (newest first) and sorts the groups. Leads always come first:
 * unread leads, then the rest of the unread items, then everything read;
 * newest first within each.
 */
export function buildFeed(rows: FeedRow[]): FeedGroup[] {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const buckets = new Map<string, FeedRow[]>();
  for (const row of sorted) {
    const key = groupKey(row);
    const list = buckets.get(key);
    if (list) list.push(row);
    else buckets.set(key, [row]);
  }
  const groups: FeedGroup[] = [...buckets.entries()].map(([key, list]) => ({
    key,
    ids: list.map((r) => r.id),
    unreadIds: list.filter((r) => !r.read_at).map((r) => r.id),
    latestAt: list[0]!.created_at,
    count: list.length,
    ...describe(list),
  }));
  const rank = (g: FeedGroup) => (g.unreadIds.length ? (g.category === "leads" ? 0 : 1) : 2);
  return groups.sort((a, b) => rank(a) - rank(b) || b.latestAt.localeCompare(a.latestAt));
}

/** Unread conversations and items, as the owner sees them (not raw rows). */
export function unreadGroupCount(rows: FeedRow[]): number {
  return new Set(rows.filter((r) => !r.read_at).map(groupKey)).size;
}

/** Unread leads (one per lead): the number the bell badge shows. */
export function unreadLeadCount(rows: FeedRow[]): number {
  return new Set(rows.filter((r) => !r.read_at && categoryOf(r.kind) === "leads").map(groupKey)).size;
}

export type FeedSection = { id: string; label: string; groups: FeedGroup[]; more?: number };

/**
 * Leads first, everything else after:
 *   New leads → Recent leads (read, last 7 days) → Other new → Today / Yesterday / This week / Older.
 * `recentLeadLimit` keeps the bell short; the rest are one tap away on the Leads page.
 */
export function feedSections(groups: FeedGroup[], now: Date = new Date(), options: { recentLeadLimit?: number } = {}): FeedSection[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const yesterday = new Date(start.getTime() - 86_400_000);
  const week = new Date(start.getTime() - 6 * 86_400_000);
  const newLeads: FeedGroup[] = [];
  const recentLeads: FeedGroup[] = [];
  const otherNew: FeedGroup[] = [];
  const byDay: FeedGroup[][] = [[], [], [], []];
  for (const group of groups) {
    const at = new Date(group.latestAt);
    const isLead = group.category === "leads";
    if (group.unreadIds.length) (isLead ? newLeads : otherNew).push(group);
    else if (isLead && at >= week) recentLeads.push(group);
    else byDay[at >= start ? 0 : at >= yesterday ? 1 : at >= week ? 2 : 3]!.push(group);
  }
  const limit = options.recentLeadLimit ?? Infinity;
  const sections: FeedSection[] = [
    { id: "new-leads", label: "New leads", groups: newLeads },
    { id: "recent-leads", label: "Recent leads", groups: recentLeads.slice(0, limit), more: Math.max(0, recentLeads.length - limit) },
    { id: "other-new", label: newLeads.length || recentLeads.length ? "Everything else" : "New", groups: otherNew },
    { id: "today", label: "Today", groups: byDay[0]! },
    { id: "yesterday", label: "Yesterday", groups: byDay[1]! },
    { id: "week", label: "This week", groups: byDay[2]! },
    { id: "older", label: "Older", groups: byDay[3]! },
  ];
  return sections.filter((s) => s.groups.length > 0);
}

/** Short toast text for a newly arrived row. */
export function toastText(row: FeedRow): { title: string; description: string } {
  const [group] = buildFeed([row]);
  const title = group?.subtitle ? `${group.title} · ${group.subtitle}` : (group?.title ?? row.title);
  return { title, description: (group?.preview.at(-1) ?? row.body).slice(0, 120) };
}

/**
 * Push text for a new lead: who and what, so the owner can act from the lock
 * screen. Service and suburb only (no phone number or street address), and the
 * tap opens that lead.
 */
export function leadPushContent(input: { title: string; leadId: string | null; metadata: unknown }): { title: string; body: string; path: string } {
  const m = input.metadata && typeof input.metadata === "object" ? (input.metadata as Record<string, unknown>) : {};
  const service = str(m["service_intent"]);
  const suburb = str(m["suburb"]);
  const detail = [service ? humanizeAnswer(service) : null, suburb].filter(Boolean).join(" · ");
  return {
    title: input.title.slice(0, 160) || "New lead",
    body: detail ? `${detail}. Tap to reply.` : "New enquiry. Tap to reply.",
    path: input.leadId ? `/leads/${input.leadId}` : "/leads",
  };
}
