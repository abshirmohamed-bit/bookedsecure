import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useReducer, useRef } from "react";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSettings } from "@/lib/app.functions";
import { useAuth } from "@/hooks/useAuth";
import {
  ACCOUNT_MENU_ITEMS,
  ROLE_LABELS,
  accountInitials,
  accountMenuReducer,
} from "@/lib/navigation";

/**
 * Top-right account menu: who am I, which business am I operating, and the
 * occasional configuration destinations. Reuses the existing getSettings read
 * (fetched only once the menu is opened) — no new queries are introduced.
 */
export function AccountMenu({ onSignOut, rail = false }: { onSignOut: () => void; rail?: boolean }) {
  const [open, dispatch] = useReducer(accountMenuReducer, false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { session } = useAuth();
  const fetchSettings = useServerFn(getSettings);

  const { data } = useQuery({
    queryKey: ["settings"],
    queryFn: () => fetchSettings(),
    enabled: open,
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
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span
          aria-hidden="true"
          className="grid h-8 w-8 place-items-center rounded-full border border-border bg-secondary text-[11px] font-semibold text-foreground"
        >
          {accountInitials(name, email)}
        </span>
        {!rail ? <span className="hidden sm:inline">Account</span> : null}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account"
          className={rail ? "fixed bottom-3 left-14 z-[70] w-64 overflow-hidden rounded-md border border-border bg-sidebar shadow-lg" : "absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-md border border-border bg-sidebar shadow-lg"}
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
            <li className="border-t border-border">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  dispatch({ type: "select_item" });
                  void supabase.auth.signOut().then(onSignOut);
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
