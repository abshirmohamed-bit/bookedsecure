import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getNotifications, markNotificationsRead } from "@/lib/app.functions";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { NotificationList, type NotificationItem } from "@/components/NotificationList";
import type { NotificationFilter } from "@/lib/notifications";

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "bookings", label: "Bookings" },
  { id: "messages", label: "Messages" },
];

export function NotificationBell({ rail = false }: { rail?: boolean }) {
  const fetchNotifications = useServerFn(getNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const { session } = useAuth();
  const wrapper = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    // A stale/expired session has no usable token: calling the server then
    // fails with "no authorization header" and blanks the screen.
    enabled: Boolean(session?.access_token),
    queryKey: ["notifications", filter],
    queryFn: () => fetchNotifications({ data: { filter, limit: 30 } }),
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

  // Instant alerts: subscribe to this business's new notifications.
  useEffect(() => {
    if (!businessId) return;
    const channel = supabase
      .channel(`notifications:${businessId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `business_id=eq.${businessId}` },
        (payload) => {
          const row = payload.new as NotificationItem;
          toast(row.title, { description: row.body?.slice(0, 120) });
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [businessId, queryClient]);

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
    mutationFn: (ids?: string[]) => markRead({ data: ids ? { ids } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  const notifications = (data?.notifications ?? []) as NotificationItem[];

  const openItem = (item: NotificationItem) => {
    if (!item.read_at) mutation.mutate([item.id]);
    if (item.lead_id || item.kind.startsWith("booking") || item.kind === "low_credits" || item.kind === "trial_ending") setOpen(false);
  };

  return (
    <div className="relative" ref={wrapper}>
      <button
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
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
            rail
              ? "fixed bottom-14 left-14 z-[70] w-[22rem] max-w-[calc(100vw-4.5rem)] rounded-md border border-border bg-popover p-2 shadow-lg"
              : "fixed inset-x-2 top-14 z-[70] rounded-md border border-border bg-popover p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[22rem]"
          }
        >
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs font-semibold">Notifications</p>
            {unread > 0 && (
              <button onClick={() => mutation.mutate(undefined)} className="text-xs text-muted-foreground hover:text-foreground">
                Mark all read
              </button>
            )}
          </div>
          <div className="mb-2 flex gap-1 px-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  filter === f.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            <NotificationList items={notifications} onOpen={openItem} />
          </div>
          <Link
            to="/notifications"
            onClick={() => setOpen(false)}
            className="mt-2 block border-t border-border px-1 pt-2 text-center text-xs font-medium text-primary hover:underline"
          >
            See all notifications and settings
          </Link>
        </div>
      )}
    </div>
  );
}
