import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CheckCheck, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getNotifications, markNotificationsRead } from "@/lib/app.functions";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { NotificationFeed } from "@/components/NotificationFeed";
import { FeedFilterChips } from "@/components/FeedFilterChips";
import { groupKey, toastText, type FeedFilter, type FeedRow } from "@/lib/notification-feed";

export function NotificationBell({ rail = false, enableRealtime = true }: { rail?: boolean; enableRealtime?: boolean }) {
  const fetchNotifications = useServerFn(getNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FeedFilter>("all");
  const { session } = useAuth();
  const wrapper = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    // A stale/expired session has no usable token: calling the server then
    // fails with "no authorization header" and blanks the screen.
    enabled: Boolean(session?.access_token),
    queryKey: ["notifications", filter],
    queryFn: () => fetchNotifications({ data: { filter, limit: 80 } }),
    // Realtime pushes new alerts; polling is only a fallback.
    refetchInterval: 120_000,
    staleTime: 45_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
    retry: false,
    throwOnError: false,
  });

  const businessId = data?.businessId;

  // Instant alerts. Toasts use the conversation as their id, so a burst of
  // messages from one person updates one toast instead of stacking seven.
  useEffect(() => {
    if (!businessId || !enableRealtime) return;
    const channel = supabase
      .channel(`notifications:${businessId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `business_id=eq.${businessId}` },
        (payload) => {
          const row = payload.new as FeedRow;
          const { title, description } = toastText(row);
          toast(title, { id: groupKey(row), description });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, enableRealtime, queryClient]);

  // Close on outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const mutation = useMutation({
    mutationFn: (ids?: string[]) => markRead({ data: ids ? { ids: ids.slice(0, 300) } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  const rows = (data?.notifications ?? []) as FeedRow[];

  return (
    <div className="relative" ref={wrapper}>
      <button
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-white/60 hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className={
            (rail
              ? "fixed bottom-14 left-14 w-[24rem] max-w-[calc(100vw-4.5rem)]"
              : "fixed inset-x-2 top-14 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[24rem]") +
            " z-[70] flex max-h-[min(80dvh,40rem)] flex-col overflow-hidden rounded-2xl border border-white/70 bg-popover shadow-[inset_0_1px_0_white,0_24px_60px_-20px_oklch(0.25_0.1_258/0.45)]"
          }
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 pt-3">
            <p className="text-sm font-semibold">
              Notifications
              {unread > 0 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{unread} new</span>}
            </p>
            <div className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  onClick={() => mutation.mutate(undefined)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-white/80 hover:text-foreground"
                  title="Mark everything read"
                >
                  <CheckCheck className="size-3.5" /> Mark all read
                </button>
              )}
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-white/80 hover:text-foreground"
                aria-label="Notification settings"
                title="All notifications and settings"
              >
                <Settings2 className="size-4" />
              </Link>
            </div>
          </div>
          <FeedFilterChips value={filter} onChange={setFilter} className="shrink-0 px-3 pb-2" />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2">
            {isLoading ? (
              <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
            ) : (
              <NotificationFeed
                compact
                rows={rows}
                onMarkRead={(ids) => mutation.mutate(ids)}
                onNavigate={() => setOpen(false)}
                emptyText={filter === "unread" ? "No unread notifications." : "Nothing here yet."}
              />
            )}
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="block shrink-0 border-t border-white/70 px-3 py-2.5 text-center text-xs font-medium text-primary hover:bg-white/60"
          >
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
