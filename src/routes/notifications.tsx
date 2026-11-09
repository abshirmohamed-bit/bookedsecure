import { createFileRoute } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { NotificationFeed } from "@/components/NotificationFeed";
import { FeedFilterChips } from "@/components/FeedFilterChips";
import {
  getNotificationPreferences,
  getNotifications,
  markNotificationsRead,
  saveNotificationPreferences,
} from "@/lib/app.functions";
import { NOTIFICATION_KINDS } from "@/lib/notifications";
import { categoryOf, type FeedFilter, type FeedRow } from "@/lib/notification-feed";
import { useAuth } from "@/hooks/useAuth";
import { PushNotificationSettings } from "@/components/PushNotificationSettings";

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

const SETTING_GROUPS: { label: string; categories: string[] }[] = [
  { label: "Leads and bookings", categories: ["leads", "bookings"] },
  { label: "Messages and comments", categories: ["messages", "comments"] },
  { label: "Account", categories: ["account"] },
];

function NotificationsPage() {
  const { session } = useAuth();
  const fetchNotifications = useServerFn(getNotifications);
  const markRead = useServerFn(markNotificationsRead);
  const fetchPrefs = useServerFn(getNotificationPreferences);
  const savePrefs = useServerFn(saveNotificationPreferences);
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FeedFilter>("all");
  const enabled = Boolean(session?.access_token);

  const list = useInfiniteQuery({
    enabled,
    queryKey: ["notifications", "page", filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchNotifications({ data: { filter, limit: 100, before: pageParam } }),
    getNextPageParam: (last) => (last.hasMore ? last.notifications.at(-1)?.created_at : undefined),
  });

  const prefs = useQuery({ enabled, queryKey: ["notification-prefs"], queryFn: () => fetchPrefs() });
  const [muted, setMuted] = useState<string[]>([]);
  useEffect(() => {
    if (prefs.data) setMuted(prefs.data.mutedKinds);
  }, [prefs.data]);

  const mark = useMutation({
    mutationFn: (ids?: string[]) => markRead({ data: ids ? { ids: ids.slice(0, 300) } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
  // Each switch saves straight away; no separate Save button to forget.
  const save = useMutation({
    mutationFn: (next: string[]) => savePrefs({ data: { mutedKinds: next } }),
    onSuccess: () => {
      toast.success("Alert settings saved", { id: "alert-settings" });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Couldn't save settings");
      if (prefs.data) setMuted(prefs.data.mutedKinds);
    },
  });
  const toggle = (kind: string, on: boolean) => {
    const next = on ? muted.filter((x) => x !== kind) : [...muted, kind];
    setMuted(next);
    save.mutate(next);
  };

  const rows = (list.data?.pages.flatMap((p) => p.notifications) ?? []) as FeedRow[];
  const unread = list.data?.pages[0]?.unread ?? 0;
  const unreadLeads = list.data?.pages[0]?.unreadLeads ?? 0;

  return (
    <AppShell title="Notifications">
      <div className="mx-auto grid max-w-6xl gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="glass min-w-0 p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Notifications</h1>
              <p className="text-xs text-muted-foreground">
                {unreadLeads > 0
                  ? `${unreadLeads} new lead${unreadLeads === 1 ? "" : "s"} first, then everything else.`
                  : unread > 0
                    ? `${unread} new. Leads always show first.`
                    : "You're all caught up."}
              </p>
            </div>
            {unread > 0 && (
              <Button size="sm" variant="outline" onClick={() => mark.mutate(undefined)} disabled={mark.isPending}>
                <CheckCheck /> Mark all read
              </Button>
            )}
          </div>
          <FeedFilterChips value={filter} onChange={setFilter} className="mb-3" />
          {list.isLoading ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Loading…</p>
          ) : list.isError ? (
            <p className="py-8 text-center text-xs text-destructive">Couldn't load notifications. Try again shortly.</p>
          ) : (
            <NotificationFeed
              rows={rows}
              onMarkRead={(ids) => mark.mutate(ids)}
              emptyText={filter === "unread" ? "No unread notifications." : "Nothing here yet."}
            />
          )}
          {list.hasNextPage && (
            <div className="pt-3 text-center">
              <Button size="sm" variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
                {list.isFetchingNextPage ? "Loading…" : "Show older"}
              </Button>
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          {enabled && (
            <div className="glass p-4">
              <PushNotificationSettings />
            </div>
          )}
          <div className="glass p-4">
            <h2 className="text-[15px] font-semibold">Which alerts you get</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Changes save straight away. Turning off New enquiries also stops push and SMS alerts for them.
            </p>
            <div className="mt-3 space-y-4">
              {SETTING_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                  <div className="divide-y divide-white/60 rounded-xl border border-white/70 bg-white/40">
                    {NOTIFICATION_KINDS.filter((k) => group.categories.includes(categoryOf(k.kind))).map((k) => (
                      <label key={k.kind} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-xs">
                        <span>{k.label}</span>
                        <Switch
                          checked={!muted.includes(k.kind)}
                          disabled={!prefs.data}
                          onCheckedChange={(on) => toggle(k.kind, on)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
