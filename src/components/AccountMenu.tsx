import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useReducer, useRef } from "react";
import { LogOut, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSettings } from "@/lib/app.functions";
import { useAuth } from "@/hooks/useAuth";
import { removePushDevice } from '@/lib/browser-push.functions';
import { toast } from 'sonner';
import {
  ACCOUNT_MENU_ITEMS,
  ROLE_LABELS,
  accountInitials,
  accountMenuReducer,
  signOutWithPushCleanup,
} from "@/lib/navigation";

/**
 * Top-right account menu: who am I, which business am I operating, and the
 * occasional configuration destinations. Reuses the existing getSettings read
 * (fetched only once the menu is opened). no new queries are introduced.
 */
export function AccountMenu({
  onSignOut,
  rail = false,
  sidebar = false,
  compact = false,
}: {
  onSignOut: () => void;
  rail?: boolean;
  /** Full-width row at the bottom of the sidebar; the menu opens upwards. */
  sidebar?: boolean;
  /** Icon-only sidebar: just the initials, menu opens to the right. */
  compact?: boolean;
}) {
  const [open, dispatch] = useReducer(accountMenuReducer, false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { session } = useAuth();
  const fetchSettings = useServerFn(getSettings);
  const removeDevice = useServerFn(removePushDevice);

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings(),
    enabled: open || sidebar,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch({ type: "escape" });
        buttonRef.current?.focus();
      }
    };
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        dispatch({ type: "click_outside" });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const profile = data?.team?.find((member) => member.id === session?.user.id) ?? null;
  const email = profile?.email ?? session?.user.email ?? null;
  const name = profile?.name ?? null;
  const roleLabel = data?.role ? (ROLE_LABELS[data.role] ?? data.role) : null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => dispatch({ type: "toggle" })}
        className={sidebar
          ? `flex w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${compact ? "lg:w-auto lg:justify-center" : ""}`
          : "flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"}
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-secondary text-[11px] font-semibold text-foreground"
        >
          {accountInitials(name, email)}
        </span>
        {sidebar ? (
          <span className={`min-w-0 flex-1 ${compact ? "lg:hidden" : ""}`}>
            <span className="block truncate text-sm font-medium text-sidebar-foreground">{name ?? "Your account"}</span>
            {email ? <span className="block truncate text-[11px]">{email}</span> : null}
          </span>
        ) : !rail ? <span className="hidden sm:inline">Account</span> : null}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className={sidebar ? (compact ? "absolute bottom-0 left-full z-[70] ml-2 w-64 overflow-hidden rounded-xl border border-white/70 bg-popover shadow-[inset_0_1px_0_rgb(255_255_255),0_16px_40px_-16px_oklch(0.25_0.1_258/0.4)]" : "absolute bottom-full left-0 z-[70] mb-2 w-64 overflow-hidden rounded-xl border border-white/70 bg-popover shadow-[inset_0_1px_0_rgb(255_255_255),0_16px_40px_-16px_oklch(0.25_0.1_258/0.4)]") : rail ? "fixed bottom-3 left-14 z-[70] w-64 overflow-hidden rounded-xl border border-white/70 bg-popover shadow-[inset_0_1px_0_rgb(255_255_255),0_16px_40px_-16px_oklch(0.25_0.1_258/0.4)]" : "absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-white/70 bg-popover shadow-[inset_0_1px_0_rgb(255_255_255),0_16px_40px_-16px_oklch(0.25_0.1_258/0.4)]"}
        >
          <div className="border-b border-border px-3 py-3">
            <p className="truncate text-sm font-medium text-foreground">
              {name ?? email ?? "Signed in"}
            </p>
            {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              {roleLabel ?? "Loading role…"}
              {data?.business?.name ? ` · ${data.business.name}` : ""}
            </p>
          </div>
          <ul className="py-1">
            {data?.role === "platform_admin" ? (
              <li>
                <Link
                  to="/admin/overview"
                  role="menuitem"
                  onClick={() => dispatch({ type: "select_item" })}
                  className="block px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary focus-visible:bg-secondary focus-visible:outline-none"
                >
                  Control room
                </Link>
              </li>
            ) : null}
            {ACCOUNT_MENU_ITEMS.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  role="menuitem"
                  onClick={() => dispatch({ type: "select_item" })}
                  className="block px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
                  activeProps={{ className: "block px-3 py-2 text-sm font-medium text-foreground bg-secondary" }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            {data?.role && data.role !== "platform_admin" ? (
              <li>
                <a
                  href="tel:+61466907824"
                  role="menuitem"
                  onClick={() => dispatch({ type: "select_item" })}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Call +61 466 907 824
                </a>
              </li>
            ) : null}
            <li className="border-t border-border">
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  dispatch({ type: "select_item" });
                  let pushCleanupFailed = false;
                  await signOutWithPushCleanup({
                    token: localStorage.getItem('bookedsecure:push-token'),
                    removeDevice: (token) => removeDevice({ data: { token } }),
                    clearToken: () => localStorage.removeItem('bookedsecure:push-token'),
                    signOut: () => supabase.auth.signOut(),
                    onSignedOut: onSignOut,
                    onPushError: () => { pushCleanupFailed = true; },
                  });
                  if (pushCleanupFailed) toast.error('Signed out, but this device could not be disconnected from alerts.');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
