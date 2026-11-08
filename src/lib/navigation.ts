/**
 * Information architecture for the app shell.
 *
 * Pure data + pure functions so navigation behaviour can be tested without a DOM.
 * One sidebar, grouped by the job the owner is doing: today's overview, the
 * inboxes that need replies, the day-to-day work, and setup. Each setting has
 * its own page so nothing hides behind tabs or the account menu.
 */

export type NavPath =
  | "/dashboard"
  | "/assistant"
  | "/leads"
  | "/social"
  | "/unfinished"
  | "/bookings"
  | "/campaigns"
  | "/analytics"
  | "/settings/business"
  | "/settings/messaging"
  | "/settings/automation"
  | "/settings/integrations"
  | "/settings/team";

export type NavIcon =
  | "home"
  | "assistant"
  | "leads"
  | "social"
  | "unfinished"
  | "bookings"
  | "campaigns"
  | "results"
  | "business"
  | "texting"
  | "automations"
  | "connections"
  | "team";

/** Live counts shown next to inbox items (what is waiting for the owner). */
export type NavBadge = "leads" | "social";

export type NavItem = {
  to: NavPath;
  label: string;
  /** Icon key resolved to a component by the shell, keeping this module pure. */
  icon: NavIcon;
  badge?: NavBadge;
  /** Extra paths that should keep this item in its active state. */
  contextPaths?: readonly string[];
};

export type NavSection = { label: string | null; items: readonly NavItem[] };

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: null,
    items: [
      { to: "/dashboard", label: "Home", icon: "home" },
      { to: "/assistant", label: "Assistant", icon: "assistant" },
    ],
  },
  {
    label: "Inbox",
    items: [
      { to: "/leads", label: "Leads", icon: "leads", badge: "leads", contextPaths: ["/import"] },
      { to: "/social", label: "Facebook and Instagram", icon: "social", badge: "social" },
      { to: "/unfinished", label: "Unfinished quotes", icon: "unfinished" },
    ],
  },
  {
    label: "Work",
    items: [
      { to: "/bookings", label: "Bookings", icon: "bookings" },
      { to: "/campaigns", label: "Campaigns", icon: "campaigns" },
      { to: "/analytics", label: "Results", icon: "results" },
    ],
  },
  {
    label: "Setup",
    items: [
      { to: "/settings/business", label: "Business and services", icon: "business" },
      { to: "/settings/messaging", label: "Texting", icon: "texting" },
      { to: "/settings/automation", label: "Automations", icon: "automations" },
      { to: "/settings/integrations", label: "Connections", icon: "connections" },
      { to: "/settings/team", label: "Team", icon: "team" },
    ],
  },
] as const;

/** Every sidebar item, in order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export type AccountMenuItem = {
  to: "/profile" | "/settings/billing" | "/notifications";
  label: string;
};

/** Personal destinations only; business settings live in the sidebar. */
export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { to: "/profile", label: "Your profile" },
  { to: "/notifications", label: "Alerts and notifications" },
  { to: "/settings/billing", label: "Account access" },
] as const;

function matches(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/** True when a sidebar item should render as active for this pathname. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (matches(pathname, item.to)) return true;
  return (item.contextPaths ?? []).some((path) => matches(pathname, path));
}

/** Page title trail shown in the header, e.g. "Leads / Import". */
export function navBreadcrumb(pathname: string): string[] {
  if (matches(pathname, "/import")) return ["Leads", "Import"];
  if (matches(pathname, "/leads/deleted")) return ["Leads", "Deleted"];
  if (pathname.startsWith("/leads/")) return ["Leads", "Conversation"];
  if (matches(pathname, "/profile")) return ["Account", "Your profile"];
  if (matches(pathname, "/notifications")) return ["Account", "Alerts and notifications"];
  if (matches(pathname, "/settings/billing")) return ["Account", "Account access"];
  const item = NAV_ITEMS.find((candidate) => isNavItemActive(candidate, pathname));
  if (!item) return [];
  const section = NAV_SECTIONS.find((candidate) => candidate.items.includes(item));
  return section?.label === "Setup" ? ["Setup", item.label] : [item.label];
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  staff: "Staff",
  platform_admin: "Platform admin",
};

/** Initials for the account button avatar; never falls back to an empty label. */
export function accountInitials(name?: string | null, email?: string | null): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  if (!source) return "?";
  const parts = source
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

export type AccountMenuEvent =
  { type: "toggle" } | { type: "escape" } | { type: "click_outside" } | { type: "select_item" };

/** Open/closed state machine for the account dropdown. */
export function accountMenuReducer(open: boolean, event: AccountMenuEvent): boolean {
  switch (event.type) {
    case "toggle":
      return !open;
    case "escape":
    case "click_outside":
    case "select_item":
      return false;
    default:
      return open;
  }
}
