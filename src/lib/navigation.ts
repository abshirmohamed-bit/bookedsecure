/**
 * Information architecture for the app shell.
 *
 * Pure data + pure functions so navigation behaviour can be tested without a DOM.
 * Primary navigation is deliberately limited to the two daily jobs (Leads,
 * Analytics). Occasional tasks (importing CRM data, configuring the account)
 * live inside the Leads workspace and the account menu respectively.
 */

export type PrimaryNavItem = {
  to: "/leads" | "/analytics";
  label: string;
  /** Extra paths that should keep this item in its active state. */
  contextPaths?: readonly string[];
};

export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { to: "/leads", label: "Leads", contextPaths: ["/", "/import"] },
  { to: "/analytics", label: "Analytics" },
] as const;

export type AccountMenuItem = {
  to: "/profile" | "/settings/business" | "/settings/messaging" | "/settings/automation" | "/settings/team";
  label: string;
};

export const ACCOUNT_MENU_ITEMS: readonly AccountMenuItem[] = [
  { to: "/profile", label: "Profile" },
  { to: "/settings/business", label: "Business settings" },
  { to: "/settings/messaging", label: "Messaging" },
  { to: "/settings/automation", label: "Automation" },
  { to: "/settings/team", label: "Team access" },
] as const;

/** True when a primary nav item should render as active for this pathname. */
export function isPrimaryNavActive(item: PrimaryNavItem, pathname: string): boolean {
  if (pathname === item.to || pathname.startsWith(`${item.to}/`)) return true;
  return (item.contextPaths ?? []).some(
    (path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)),
  );
}

/** Contextual trail shown under the header, e.g. "Leads / Import". */
export function navBreadcrumb(pathname: string): string[] {
  if (pathname === "/import" || pathname.startsWith("/import/")) return ["Leads", "Import"];
  if (pathname === "/analytics") return ["Analytics"];
  if (pathname.startsWith("/leads/")) return ["Leads", "Conversation"];
  if (pathname === "/leads" || pathname === "/") return ["Leads"];
  if (pathname === "/profile") return ["Account", "Profile"];
  if (pathname.startsWith("/settings")) {
    const section = ACCOUNT_MENU_ITEMS.find((item) => item.to === pathname);
    return ["Account", section?.label ?? "Settings"];
  }
  return [];
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
  const parts = source.replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return source.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

export type AccountMenuEvent =
  | { type: "toggle" }
  | { type: "escape" }
  | { type: "click_outside" }
  | { type: "select_item" };

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
