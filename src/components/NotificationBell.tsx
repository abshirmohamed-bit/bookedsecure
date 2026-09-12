import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { useState } from "react";
import { getNotifications, markNotificationsRead } from "@/lib/app.functions";
import { useAuth } from "@/hooks/useAuth";

export function NotificationBell({ rail = false }: { rail?: boolean }) {
  const fetchNotifications = useServerFn(getNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { session } = useAuth();

  const { data } = useQuery({
    enabled: Boolean(session),
    queryKey: ["notifications"],
    queryFn: () => fetchNotifications(),
    refetchInterval: 60_000,
    // Cached across route changes: moving between pages must not re-request
    // the same unread count on every mount.
    staleTime: 45_000,
    gcTime: 5 * 60_000,
    // New bookings should surface as soon as the owner comes back to the tab.
    refetchOnWindowFocus: true,
    refetchOnMount: false,
  });

  const mutation = useMutation({
    mutationFn: () => markRead({ data: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = data?.unread ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <div className="relative">
      <button
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen((value) => !value)}
        className="relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className={rail ? "fixed bottom-14 left-14 z-[70] w-80 max-w-[calc(100vw-4rem)] rounded-md border border-border bg-popover p-2 shadow-lg" : "absolute right-0 z-30 mt-2 w-80 rounded-md border border-border bg-popover p-2 shadow-lg"}>
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-xs font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                onClick={() => mutation.mutate()}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-1 py-3 text-xs text-muted-foreground">No notifications yet.</p>
            )}
            {notifications.map((item) => {
              const inner = (
                <div
                  className={`rounded-md px-2 py-2 text-xs hover:bg-secondary ${
                    item.read_at ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-0.5 whitespace-pre-line text-muted-foreground">{item.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(item.created_at).toLocaleString("en-AU")}
                  </p>
                </div>
              );
              // Booking alerts open the calendar; lead alerts open the conversation.
              if (item.kind === "booking_confirmed" || item.kind === "booking_change_request") {
                return (
                  <Link key={item.id} to="/bookings" onClick={() => setOpen(false)} className="block">
                    {inner}
                  </Link>
                );
              }
              return item.lead_id ? (
                <Link
                  key={item.id}
                  to="/leads/$leadId"
                  params={{ leadId: item.lead_id }}
                  onClick={() => setOpen(false)}
                  className="block"
                >
                  {inner}
                </Link>
              ) : (
                <div key={item.id}>{inner}</div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
