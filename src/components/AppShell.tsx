import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Building2,
  CalendarDays,
  Check,
  Copy,
  Hourglass,
  Home,
  Inbox,
  Linkedin,
  Megaphone,
  SearchCheck,
  Menu,
  MessageCircle,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Phone,
  Plug,
  Reply,
  ShieldCheck,
  Sparkles,
  SquareArrowOutUpRight,
  Users,
  X,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { NotificationBell } from "@/components/NotificationBell";
import { PushForegroundListener } from "@/components/PushForegroundListener";
import { AutoPushPrompt } from "@/components/AutoPushPrompt";
import { AccountMenu } from "@/components/AccountMenu";
import { FeedbackButton } from "@/components/FeedbackButton";
import { TenantMark } from "@/components/TenantMark";
import { Button } from "@/components/ui/button";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";

import { useAuth } from "@/hooks/useAuth";
import { getSession } from "@/lib/app.functions";
import { getNavCounts } from "@/lib/home.functions";
import { cn } from "@/lib/utils";
import { NAV_SECTIONS, isNavItemActive, navBreadcrumb, type NavIcon, type NavItem } from "@/lib/navigation";
import { tenantHeaderTitle, tenantQuotePath, tenantQuoteUrl } from "@/lib/tenant-nav";

/** Icon per nav item, keeping the navigation data module DOM-free. */
const NAV_ICONS: Record<NavIcon, typeof Home> = {
  home: Home,
  assistant: Sparkles,
  leads: Inbox,
  social: MessagesSquare,
  unfinished: Hourglass,
  bookings: CalendarDays,
  finder: SearchCheck,
  campaigns: Megaphone,
  replies: Reply,
  linkedin: Linkedin,
  results: BarChart3,
  business: Building2,
  texting: MessageCircle,
  automations: Zap,
  connections: Plug,
  team: Users,
};

const COLLAPSE_KEY = "bookedsecure:sidebar-collapsed";

export function AppShell({ children, title, wide = false }: { children: ReactNode; title?: string; /** Use the whole screen width on tablets and up (Home). */ wide?: boolean }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fetchSession = useServerFn(getSession);
  const fetchCounts = useServerFn(getNavCounts);
  const appSession = useQuery({
    queryKey: ["session"],
    queryFn: () => fetchSession(),
    enabled: Boolean(session),
    // Tenant identity for the shell rarely changes: cache it so navigating
    // between pages does not re-resolve the business on every mount.
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const counts = useQuery({
    queryKey: ["nav-counts"],
    queryFn: () => fetchCounts(),
    enabled: Boolean(session),
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: false,
  });

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "true");
    } catch {
      /* storage unavailable: keep the sidebar open */
    }
  }, []);

  // Close the mobile menu whenever the page changes.
  useEffect(() => setMobileNavOpen(false), [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  const breadcrumb = navBreadcrumb(pathname);
  const business = appSession.data?.business ?? null;
  const isPlatformOwner = Boolean(appSession.data?.isPlatformAdmin);
  const tenantName = business?.name ?? null;
  const quotePath = tenantQuotePath(business?.slug ?? null);
  const fullHeight = pathname.startsWith("/assistant");
  // The icon-only state applies on desktop; the mobile drawer is always full width.
  const compact = collapsed && !mobileNavOpen;
  const signOut = () => navigate({ to: "/auth", replace: true });

  return (
    <div
      className={cn(
        "transition-[padding] duration-200",
        fullHeight ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden" : "min-h-screen",
        collapsed ? "lg:pl-16" : "lg:pl-64",
      )}
    >
      {pathname !== "/notifications" && <PushForegroundListener />}
      <AutoPushPrompt />

      <aside
        aria-label="Main navigation"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(86vw,18rem)] flex-col border-r border-sidebar-border bg-sidebar shadow-[inset_-1px_0_0_rgb(255_255_255/0.5),8px_0_30px_-20px_oklch(0.3_0.1_258/0.3)] backdrop-blur-2xl backdrop-saturate-150 transition-[transform,width] duration-200 lg:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:w-16" : "lg:w-64",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 px-3", compact && "lg:justify-center lg:px-0")}>
          <Link
            to="/dashboard"
            onClick={() => setMobileNavOpen(false)}
            className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md", compact && "lg:hidden")}
            title={isPlatformOwner ? "BookedSecure" : (tenantName ?? "Home")}
          >
            {isPlatformOwner ? (
              <img src={brandMark.url} alt="" className="size-8 shrink-0 object-contain" />
            ) : (
              <TenantMark name={tenantName} logoUrl={business?.logo_url ?? null} size={32} />
            )}
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-sidebar-foreground">
                {isPlatformOwner ? "BookedSecure" : tenantHeaderTitle(tenantName)}
              </span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {isPlatformOwner ? "Platform owner" : "Your workspace"}
              </span>
            </span>
          </Link>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="hidden size-8 shrink-0 text-muted-foreground lg:inline-flex"
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="size-8 lg:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav
          aria-label="Workspace"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-3"
          // Any tapped link closes the phone menu, even when the page keeps this shell mounted.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setMobileNavOpen(false);
          }}
        >
          {isPlatformOwner ? (
            <NavGroup label="Platform" compact={compact}>
              <SidebarLink
                to="/admin/overview"
                label="Control room"
                icon={ShieldCheck}
                active={pathname.startsWith("/admin")}
                compact={compact}
              />
            </NavGroup>
          ) : null}
          {NAV_SECTIONS.map((section, index) => (
            <NavGroup
              key={section.label ?? `section-${index}`}
              label={section.label}
              compact={compact}
            >
              {section.items.map((item) => (
                <SidebarLink
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  icon={NAV_ICONS[item.icon]}
                  active={isNavItemActive(item, pathname)}
                  compact={compact}
                  badge={badgeFor(item, counts.data)}
                  sub={Boolean(item.sub)}
                />
              ))}
            </NavGroup>
          ))}
        </nav>

        <div
          className={cn("shrink-0 space-y-0.5 border-t border-sidebar-border p-2", compact && "lg:flex lg:flex-col lg:items-center")}
          onClick={(event) => {
            const link = (event.target as HTMLElement).closest("a");
            if (link && !link.getAttribute("href")?.startsWith("tel:") && link.getAttribute("target") !== "_blank") setMobileNavOpen(false);
          }}
        >
          {quotePath ? (
            <a
              href={quotePath}
              target="_blank"
              rel="noreferrer"
              title="Your quote page"
              className={cn(itemClass(false), compact && "lg:size-10 lg:justify-center lg:px-0")}
            >
              <SquareArrowOutUpRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className={cn("truncate", compact && "lg:sr-only")}>Your quote page</span>
            </a>
          ) : null}
          {!isPlatformOwner ? (
            <a
              href="tel:+61466907824"
              title="Call BookedSecure support"
              className={cn(itemClass(false), compact && "lg:size-10 lg:justify-center lg:px-0")}
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className={cn("truncate", compact && "lg:sr-only")}>Call support</span>
            </a>
          ) : null}
          <div className={cn("flex items-center gap-1 pt-1", compact && "lg:flex-col")}>
            <div className="min-w-0 flex-1">
              <AccountMenu sidebar compact={compact} onSignOut={signOut} />
            </div>
            <FeedbackButton rail />
          </div>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation overlay"
          className="fixed inset-0 z-30 bg-foreground/20 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b border-white/60 bg-white/45 px-3 backdrop-blur-2xl backdrop-saturate-150 sm:px-5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
          className="lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {breadcrumb.length > 1 ? <span className="hidden sm:inline">{breadcrumb.slice(0, -1).join(" / ")}&nbsp; / &nbsp;</span> : null}
          <span className="font-semibold text-foreground">{breadcrumb.at(-1) ?? title ?? "Home"}</span>
        </p>
        <div className="flex items-center gap-1">
          {quotePath ? <QuotePageControl quotePath={quotePath} slug={business?.slug ?? null} /> : null}
          <NotificationBell />
        </div>
      </header>

      <main
        className={cn(
          "min-w-0",
          fullHeight ? "min-h-0 flex-1 overflow-hidden" : cn("mx-auto max-w-[1400px] px-4 py-5 sm:px-6 lg:px-8", wide && "md:max-w-none 2xl:px-10"),
        )}
      >
        {children}
      </main>
    </div>
  );
}

function badgeFor(item: NavItem, counts: Partial<Record<NonNullable<NavItem["badge"]>, number>> | undefined): number {
  if (!item.badge || !counts) return 0;
  return counts[item.badge] ?? 0;
}

function itemClass(active: boolean) {
  return cn(
    "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    active
      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground shadow-[inset_0_1px_0_rgb(255_255_255),0_2px_10px_-4px_oklch(0.3_0.1_258/0.25)]"
      : "text-muted-foreground hover:bg-white/50 hover:text-sidebar-foreground",
  );
}

function NavGroup({ label, compact, children }: { label: string | null; compact: boolean; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-1">
      {label ? (
        <p className={cn("mb-1 px-2.5 text-[11px] font-medium text-muted-foreground/80", compact && "lg:sr-only")}>
          {label}
        </p>
      ) : null}
      {label && compact ? <div className="mx-3 mb-2 hidden border-t border-sidebar-border lg:block" aria-hidden="true" /> : null}
      <div className={cn("space-y-0.5", compact && "lg:flex lg:flex-col lg:items-center")}>{children}</div>
    </div>
  );
}

function SidebarLink({
  to,
  label,
  active,
  icon: Icon,
  compact,
  badge = 0,
  sub = false,
}: {
  to: NavItem["to"] | "/admin/overview";
  label: string;
  active: boolean;
  icon: typeof Home;
  compact: boolean;
  badge?: number;
  sub?: boolean;
}) {
  const badgeText = badge > 99 ? "99+" : String(badge);
  return (
    <Link
      to={to}
      // Our own active rule decides; stop the router also marking parents (Campaigns on /campaigns/replies).
      activeOptions={{ exact: true }}
      aria-current={active ? "page" : undefined}
      title={compact ? label : undefined}
      className={cn(itemClass(active), "relative", sub && "ml-5 border-l border-sidebar-border pl-3 text-[13px]", compact && "lg:ml-0 lg:size-10 lg:justify-center lg:border-l-0 lg:px-0")}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate", compact && "lg:sr-only")}>{label}</span>
      {badge > 0 ? (
        <span
          aria-label={`${badge} waiting`}
          className={cn(
            "grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground",
            compact && "lg:absolute lg:-right-0.5 lg:-top-0.5 lg:h-4 lg:min-w-4 lg:px-1 lg:text-[10px]",
          )}
        >
          {badgeText}
        </span>
      ) : null}
    </Link>
  );
}

/** Opens and copies only the signed-in tenant's public quote URL. */
function QuotePageControl({ quotePath, slug }: { quotePath: string; slug: string | null }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const origin = typeof window === "undefined" ? null : window.location.origin;
    const url = tenantQuoteUrl(origin, slug);
    if (!url) {
      toast.error("Public quote link is unavailable.");
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Public quote link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link.");
    }
  };

  return (
    <span className="hidden items-center rounded-md sm:inline-flex">
      <a
        href={quotePath}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden="true" /> Quote page
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy public quote link"
        className="inline-flex items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </span>
  );
}
