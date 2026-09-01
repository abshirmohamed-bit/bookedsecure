import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, SquareArrowOutUpRight } from "lucide-react";
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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <TenantMark name={tenantName} logoUrl={business?.logo_url ?? null} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{tenantHeaderTitle(tenantName)}</p>
              <p className="truncate text-xs text-muted-foreground">
                {breadcrumb.length ? breadcrumb.join(" / ") : (title ?? "SMS lead recovery")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />

            {quotePath ? <QuotePageControl quotePath={quotePath} slug={business?.slug ?? null} /> : null}
            <AccountMenu onSignOut={() => navigate({ to: "/auth", replace: true })} />
          </div>
        </div>
        <nav aria-label="Primary" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3 pb-2">
          {PRIMARY_NAV.map((item) => {
            const active = isPrimaryNavActive(item, pathname);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "bg-secondary font-medium text-foreground"
                    : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
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
