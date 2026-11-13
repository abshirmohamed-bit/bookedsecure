import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CampaignsTabs } from "@/components/campaigns/CampaignsTabs";
import { RepliesInbox, type InboxSearch } from "@/components/campaigns/RepliesInbox";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;
const FOLDERS = ["inbox", "sent", "campaigns", "archived"] as const;

export const Route = createFileRoute("/campaigns/replies")({
  head: () => ({ meta: [{ title: "Inbox | BookedSecure" }] }),
  // ?thread=<recipient> opens a campaign reply; ?conversation=<thread> an email in the inbox;
  // ?campaign=<id> shows the replies to one campaign; ?compose=new|<lead id> opens the composer.
  validateSearch: (search: Record<string, unknown>): InboxSearch => {
    const s = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : null);
    const folder = s("folder");
    const compose = s("compose");
    return {
      ...(s("thread") && UUID.test(s("thread")!) ? { thread: s("thread")! } : {}),
      ...(s("conversation") && UUID.test(s("conversation")!) ? { conversation: s("conversation")! } : {}),
      ...(s("campaign") && UUID.test(s("campaign")!) ? { campaign: s("campaign")! } : {}),
      ...(folder && (FOLDERS as readonly string[]).includes(folder) && folder !== "inbox" ? { folder: folder as NonNullable<InboxSearch["folder"]> } : {}),
      ...(compose && (compose === "new" || UUID.test(compose)) ? { compose } : {}),
    };
  },
  component: InboxPage,
});

/** The business's email inbox (its own address plus campaign replies): its own page under Campaigns in the sidebar. */
function InboxPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const go = useCallback((next: InboxSearch, replace: boolean) => void navigate({ to: "/campaigns/replies", search: next, replace }), [navigate]);
  const open = Boolean(search.thread || search.conversation);
  return (
    <AppShell title="Inbox">
      {/* On a phone an open conversation takes the whole screen, like a mail app. */}
      <div className={cn("mx-auto max-w-7xl space-y-4 md:p-6", open && "max-md:-mx-4 max-md:-my-5 sm:max-md:-mx-6")}>
        <header className={cn("space-y-3 sm:flex sm:items-end sm:justify-between sm:gap-3 sm:space-y-0", open && "hidden md:flex")}>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Inbox</h1>
            <p className="text-sm text-muted-foreground">Your business email and replies to your campaigns. Read, reply and send without leaving BookedSecure.</p>
          </div>
          <CampaignsTabs active="replies" />
        </header>
        <section aria-label="Inbox" className={cn("glass overflow-clip", open && "max-md:rounded-none max-md:border-x-0")}>
          <RepliesInbox search={search} go={go} />
        </section>
      </div>
    </AppShell>
  );
}
