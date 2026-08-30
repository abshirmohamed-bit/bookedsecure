import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { SquareArrowOutUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { AccountMenu } from "@/components/AccountMenu";

import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { PRIMARY_NAV, isPrimaryNavActive, navBreadcrumb } from "@/lib/navigation";

export function AppShell({ children, title }: { children: ReactNode; title?: string }) {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

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

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-sidebar/95 backdrop-blur">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              G
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">Glocast Lead Response</p>
              <p className="truncate text-xs text-muted-foreground">
                {breadcrumb.length ? breadcrumb.join(" / ") : (title ?? "SMS lead recovery")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell />

            <a
              href="/quote"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground sm:inline-flex"
            >
              <SquareArrowOutUpRight className="h-3.5 w-3.5" aria-hidden="true" /> Quote page
            </a>
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
