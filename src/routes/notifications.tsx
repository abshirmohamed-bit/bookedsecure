import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NotificationList, type NotificationItem } from "@/components/NotificationList";
import {
  getNotificationPreferences,
  getNotifications,
  markNotificationsRead,
  saveNotificationPreferences,
} from "@/lib/app.functions";
import { NOTIFICATION_KINDS, type NotificationFilter } from "@/lib/notifications";
import { useAuth } from "@/hooks/useAuth";
import { PushNotificationSettings } from '@/components/PushNotificationSettings';

export const Route = createFileRoute("/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications | BookedSecure" },
      { name: "description", content: "All your booking, customer and account alerts in one place, with settings for which alerts you get." },
      { property: "og:title", content: "Notifications | BookedSecure" },
      { property: "og:description", content: "Booking, customer and account alerts with history and settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NotificationsPage,
});

const FILTERS: { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
  { id: "bookings", label: "Bookings" },
  { id: "messages", label: "Messages" },
];

function NotificationsPage() {
  const { session } = useAuth();
  const fetchNotifications = useServerFn(getNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const fetchPrefs = useServerFn(getNotificationPreferences);
  const savePrefs = useServerFn(saveNotificationPreferences);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const enabled = Boolean(session?.access_token);

  const list = useInfiniteQuery({
    enabled,
    queryKey: ["notifications", "page", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchNotifications({ data: { filter, limit: 30, before: pageParam } }),
    getNextPageParam: (last) => (last.hasMore ? last.notifications.at(-1)?.created_at : undefined),
  });

  const prefs = useQuery({ enabled, queryKey: ["notification-prefs"], queryFn: () => fetchPrefs() });
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    if (prefs.data) setMuted(prefs.data.mutedKinds);
  }, [prefs.data]);

  const mark = useMutation({
    mutationFn: (ids?: string[]) => markRead({ data: ids ? { ids } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const save = useMutation({
    mutationFn: (next: string[]) => savePrefs({ data: { mutedKinds: next } }),
    onSuccess: () => {
      toast.success("Alert settings saved");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save settings"),
  });

  const items = (list.data?.pages.flatMap((p) => p.notifications) ?? []) as NotificationItem[];
  const unread = list.data?.pages[0]?.unread ?? 0;

  return (
    <AppShell title="Notifications">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_18rem]">
        <section className="rounded-lg border border-border bg-card p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    filter === f.id ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {unread > 0 && (
              <Button size="sm" variant="ghost" onClick={() => mark.mutate(undefined)}>
                Mark all read ({unread})
              </Button>
            )}
          </div>
          {list.isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : list.isError ? (
            <p className="py-6 text-center text-xs text-destructive">Couldn't load notifications. Try again shortly.</p>
          ) : (
            <NotificationList items={items} onOpen={(item) => !item.read_at && mark.mutate([item.id])} />
          )}
          {list.hasNextPage && (
            <div className="pt-3 text-center">
              <Button size="sm" variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </section>

        <aside className="order-first rounded-lg border border-border bg-card p-4 lg:order-none">
          {enabled && <PushNotificationSettings />}
          <h2 className="text-sm font-semibold">Which alerts you get</h2>
          <p className="mt-1 text-xs text-muted-foreground">Switched-off alerts stop appearing here and on the bell. Turning off New enquiries also stops push and optional SMS alerts.</p>
          <div className="mt-4 space-y-3">
            {NOTIFICATION_KINDS.map((k) => (
              <label key={k.kind} className="flex items-center justify-between gap-3 text-xs">
                <span>{k.label}</span>
                <Switch
                  checked={!muted.includes(k.kind)}
                  onCheckedChange={(on) =>
                    setMuted((cur) => (on ? cur.filter((x) => x !== k.kind) : [...cur, k.kind]))
                  }
                />
              </label>
            ))}
          </div>
          <Button className="mt-4 w-full" size="sm" disabled={save.isPending || !prefs.data} onClick={() => save.mutate(muted)}>
            {save.isPending ? "Saving…" : "Save alert settings"}
          </Button>
        </aside>
      </div>
    </AppShell>
  );
}
