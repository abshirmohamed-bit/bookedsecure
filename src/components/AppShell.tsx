import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SubscriptionBanner } from "@/components/billing/SubscriptionBanner";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  FileUp,
  Inbox,
  Menu,
  MessageCircle,
  PanelLeft,
  Settings,
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
import { AccountMenu } from "@/components/AccountMenu";
import { FeedbackButton } from "@/components/FeedbackButton";
import { TenantMark } from "@/components/TenantMark";
import { Button } from "@/components/ui/button";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";

import { useAuth } from "@/hooks/useAuth";
import { getSession } from "@/lib/app.functions";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isPrimaryNavActive, navBreadcrumb } from "@/lib/navigation";
import { tenantHeaderTitle, tenantQuotePath, tenantQuoteUrl } from "@/lib/tenant-nav";

/** Icon per primary nav item, keeping the navigation data module DOM-free. */
const NAV_ICONS = {
  assistant: Sparkles,
  inbox: Inbox,
  analytics: BarChart3,
  bookings: CalendarDays,
} as const;

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fetchSession = useServerFn(getSession);
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

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [tenantRailCollapsed, setTenantRailCollapsed] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  useEffect(() => {
    const saved = window.localStorage.getItem("bookedsecure:tenant-rail-collapsed");
    setTenantRailCollapsed(saved === "true");
  }, []);

  const toggleTenantRail = () => {
    setTenantRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("bookedsecure:tenant-rail-collapsed", String(next));
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
  const tenantName = business?.name ?? null;
  const quotePath = tenantQuotePath(business?.slug ?? null);

  const isAssistantHome = pathname === "/dashboard" || pathname.startsWith("/assistant");

  return (
    <div
      className={cn(
        isAssistantHome
          ? "flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-background transition-[padding] duration-200 lg:pl-[19.5rem]"
          : "min-h-screen bg-background transition-[padding] duration-200 lg:pl-[19.5rem]",
        tenantRailCollapsed && "lg:pl-16",
      )}
    >
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-3 lg:flex">
        <Link
          to="/"
          title="BookedSecure home"
          aria-label="BookedSecure home"
          className="grid size-10 place-items-center rounded-md"
        >
          <img
            src={brandMark.url}
            alt="BookedSecure"
            className="h-8 w-8 shrink-0 object-contain object-center"
          />
        </Link>

        <div className="mt-6 flex flex-col gap-2">
          <FeedbackButton rail />

          <Button size="icon" variant="ghost" onClick={toggleTenantRail} title={tenantRailCollapsed ? "Open tenant navigation" : "Collapse tenant navigation"} aria-label={tenantRailCollapsed ? "Open tenant navigation" : "Collapse tenant navigation"}>
            {tenantRailCollapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <NotificationBell rail />
          <AccountMenu rail onSignOut={() => navigate({ to: "/auth", replace: true })} />
        </div>
      </aside>
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(86vw,19rem)] flex-col border-r border-sidebar-border bg-sidebar transition-[transform,width] duration-200 lg:left-16 lg:w-[15.5rem] lg:translate-x-0",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          tenantRailCollapsed && "lg:w-0 lg:overflow-hidden lg:border-r-0",
        )}
      >
        <div className="grid h-20 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-sidebar-border px-4">
          <TenantMark name={tenantName} logoUrl={business?.logo_url ?? null} size={38} />
          <div className="min-w-0">
            <p className="truncate font-heading text-base font-semibold text-sidebar-foreground">
              {tenantHeaderTitle(tenantName)}
            </p>
            <p className="text-[11px] font-medium text-muted-foreground">Tenant workspace</p>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav aria-label="Tenant navigation" className={cn("shrink-0 overflow-y-auto px-3 py-4", isAssistantHome && "max-h-[48dvh]")}>
          <SidebarLabel>Workspace</SidebarLabel>
          {PRIMARY_NAV.map((item) => (
            <SidebarLink
              key={item.to}
              to={item.to}
              label={item.label}
              active={isPrimaryNavActive(item, pathname)}
              icon={NAV_ICONS[item.icon]}
              onClick={() => setMobileNavOpen(false)}
            />
          ))}
          <SidebarLabel className="mt-5">Leads & growth</SidebarLabel>
          <SidebarLink
            to="/unfinished"
            label="Unfinished prospects"
            active={pathname.startsWith("/unfinished")}
            icon={PanelLeft}
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarLink
            to="/import"
            label="Import data"
            active={pathname.startsWith("/import")}
            icon={FileUp}
            onClick={() => setMobileNavOpen(false)}
          />
          {quotePath ? (
            <a
              href={quotePath}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <SquareArrowOutUpRight className="h-4 w-4" /> Quote page
            </a>
          ) : null}
          <SidebarLabel className="mt-5">Manage</SidebarLabel>
          <SidebarLink
            to="/settings/business"
            label="Business settings"
            active={pathname.startsWith("/settings/business")}
            icon={Settings}
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarLink
            to="/settings/messaging"
            label="Messaging"
            active={pathname.startsWith("/settings/messaging")}
            icon={MessageCircle}
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarLink
            to="/settings/automation"
            label="Automation"
            active={pathname.startsWith("/settings/automation")}
            icon={Zap}
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarLink
            to="/settings/team"
            label="Team access"
            active={pathname.startsWith("/settings/team")}
            icon={Users}
            onClick={() => setMobileNavOpen(false)}
          />
          <SidebarLink
            to="/settings/billing"
            label="Plan & billing"
            active={pathname.startsWith("/settings/billing")}
            icon={CreditCard}
            onClick={() => setMobileNavOpen(false)}
          />
        </nav>
        {isAssistantHome ? <div id="assistant-context-slot" className="min-h-0 flex-1 border-t border-sidebar-border" /> : <div className="flex-1" />}
        <div className="shrink-0 border-t border-sidebar-border p-3">
          <div className="flex items-center gap-2 rounded-md bg-sidebar-accent/55 px-3 py-2 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>Lead operations</span>
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
       <header className="sticky top-0 z-20 grid h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center border-b border-border bg-card/95 px-3 backdrop-blur sm:px-5">
         <Button
          type="button"
           size="icon"
           variant="outline"
          aria-label="Open navigation"
          onClick={() => setMobileNavOpen(true)}
           className="mr-3 lg:hidden"
        >
          <Menu className="h-4 w-4" />
         </Button>
        <p className="min-w-0 truncate text-sm text-muted-foreground">
          <span className="hidden sm:inline">Workspace&nbsp; / &nbsp;</span>
          <span className="font-medium text-foreground">
            {breadcrumb.at(-1) ?? title ?? "Workspace"}
          </span>
        </p>
         <div className="ml-auto flex items-center gap-1">
           <div className="lg:hidden"><FeedbackButton rail /></div>
           <div className="lg:hidden"><NotificationBell /></div>

          {quotePath ? (
            <QuotePageControl quotePath={quotePath} slug={business?.slug ?? null} />
          ) : null}
           <div className="lg:hidden"><AccountMenu onSignOut={() => navigate({ to: "/auth", replace: true })} /></div>
        </div>
      </header>
       <SubscriptionBanner />
       <main className={cn("min-w-0", isAssistantHome ? "min-h-0 flex-1 overflow-hidden" : "mx-auto max-w-[1500px] px-4 py-5 sm:px-6")}>{children}</main>
    </div>
  );
}

function SidebarLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "mb-1 px-3 text-[10px] font-semibold uppercase text-muted-foreground",
        className,
      )}
    >
      {children}
    </p>
  );
}

function SidebarLink({
  to,
  label,
  active,
  icon: Icon,
  onClick,
}: {
  to:
    | "/dashboard"
    | "/leads"
    | "/bookings"
    | "/analytics"
    | "/import"
     | "/unfinished"
    | "/settings/business"
    | "/settings/messaging"
    | "/settings/automation"
    | "/settings/team"
    | "/settings/billing";
  label: string;
  active: boolean;
  icon: typeof BarChart3;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4", active && "text-primary")} aria-hidden="true" />
      {label}
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
        {copied ? (
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
