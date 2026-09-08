import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  BarChart3,
  Check,
  Copy,
  FileUp,
  Menu,
  MessageCircle,
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
import { TenantMark } from "@/components/TenantMark";

import { useAuth } from "@/hooks/useAuth";
import { getSession } from "@/lib/app.functions";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isPrimaryNavActive, navBreadcrumb } from "@/lib/navigation";
import { tenantHeaderTitle, tenantQuotePath, tenantQuoteUrl } from "@/lib/tenant-nav";

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fetchSession = useServerFn(getSession);
  const appSession = useQuery({
    queryKey: ["session"],
    queryFn: () => fetchSession(),
    enabled: Boolean(session),
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

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

  return (
    <div className="min-h-screen bg-background lg:pl-60">
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0", mobileNavOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
          <TenantMark name={tenantName} logoUrl={business?.logo_url ?? null} size={36} />
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold text-sidebar-foreground">{tenantHeaderTitle(tenantName)}</p>
            <p className="text-[11px] font-medium text-primary">BookedSecure</p>
          </div>
          <button type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="ml-auto rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent lg:hidden"><X className="h-4 w-4" /></button>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarLabel>Workspace</SidebarLabel>
          {PRIMARY_NAV.map((item, index) => <SidebarLink key={item.to} to={item.to} label={item.label} active={isPrimaryNavActive(item, pathname)} icon={index === 0 ? MessageCircle : BarChart3} onClick={() => setMobileNavOpen(false)} />)}
          <SidebarLabel className="mt-6">Workflow</SidebarLabel>
          {quotePath ? <a href={quotePath} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><SquareArrowOutUpRight className="h-4 w-4" /> Quote page</a> : null}
          <SidebarLink to="/import" label="Import data" active={pathname.startsWith("/import")} icon={FileUp} onClick={() => setMobileNavOpen(false)} />
          <SidebarLabel className="mt-6">Account</SidebarLabel>
          <SidebarLink to="/settings/business" label="Business settings" active={pathname.startsWith("/settings/business")} icon={Settings} onClick={() => setMobileNavOpen(false)} />
          <SidebarLink to="/settings/messaging" label="Messaging" active={pathname.startsWith("/settings/messaging")} icon={MessageCircle} onClick={() => setMobileNavOpen(false)} />
          <SidebarLink to="/settings/automation" label="Automation" active={pathname.startsWith("/settings/automation")} icon={Zap} onClick={() => setMobileNavOpen(false)} />
          <SidebarLink to="/settings/team" label="Team access" active={pathname.startsWith("/settings/team")} icon={Users} onClick={() => setMobileNavOpen(false)} />
        </nav>
        <div className="border-t border-sidebar-border p-3"><div className="flex items-center gap-2 rounded-md bg-sidebar-accent/55 px-3 py-2 text-xs text-muted-foreground"><Sparkles className="h-4 w-4 text-primary" /><span>Lead operations</span></div></div>
      </aside>
      {mobileNavOpen ? <button type="button" aria-label="Close navigation overlay" className="fixed inset-0 z-30 bg-foreground/20 lg:hidden" onClick={() => setMobileNavOpen(false)} /> : null}
      <header className="sticky top-0 z-20 flex h-16 items-center border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
        <button type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} className="mr-3 rounded-md border border-input p-2 text-muted-foreground lg:hidden"><Menu className="h-4 w-4" /></button>
        <p className="min-w-0 truncate text-sm text-muted-foreground"><span className="hidden sm:inline">Workspace&nbsp; / &nbsp;</span><span className="font-medium text-foreground">{breadcrumb.at(-1) ?? title ?? "Leads"}</span></p>
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          {quotePath ? <QuotePageControl quotePath={quotePath} slug={business?.slug ?? null} /> : null}
          <AccountMenu onSignOut={() => navigate({ to: "/auth", replace: true })} />
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6">{children}</main>
    </div>
  );
}

function SidebarLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mb-1 px-3 text-[10px] font-semibold uppercase text-muted-foreground", className)}>{children}</p>;
}

function SidebarLink({ to, label, active, icon: Icon, onClick }: { to: "/leads" | "/analytics" | "/import" | "/settings/business" | "/settings/messaging" | "/settings/automation" | "/settings/team"; label: string; active: boolean; icon: typeof BarChart3; onClick: () => void }) {
  return <Link to={to} onClick={onClick} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground")}><Icon className={cn("h-4 w-4", active && "text-primary")} aria-hidden="true" />{label}</Link>;
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
