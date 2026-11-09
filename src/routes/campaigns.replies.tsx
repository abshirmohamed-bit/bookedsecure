import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CampaignsTabs } from "@/components/campaigns/CampaignsTabs";
import { RepliesInbox } from "@/components/campaigns/RepliesInbox";
import { cn } from "@/lib/utils";

const UUID = /^[0-9a-f-]{36}$/i;
type RepliesSearch = { thread?: string; campaign?: string };

export const Route = createFileRoute("/campaigns/replies")({
  head: () => ({ meta: [{ title: "Replies | BookedSecure" }] }),
  // ?thread=<recipient> opens one conversation; ?campaign=<id> shows the replies to one campaign.
  validateSearch: (search: Record<string, unknown>): RepliesSearch => ({
    ...(typeof search["thread"] === "string" && UUID.test(search["thread"]) ? { thread: search["thread"] } : {}),
    ...(typeof search["campaign"] === "string" && UUID.test(search["campaign"]) ? { campaign: search["campaign"] } : {}),
  }),
  component: RepliesPage,
});

/** Customer replies to campaign emails: its own page under Campaigns in the sidebar. */
function RepliesPage() {
  const { thread, campaign } = Route.useSearch();
  const navigate = useNavigate();
  const go = (next: RepliesSearch, replace: boolean) => void navigate({ to: "/campaigns/replies", search: next, replace });
  return (
    <AppShell title="Replies">
      {/* On a phone an open conversation takes the whole screen, like a messaging app. */}
      <div className={cn("mx-auto max-w-6xl space-y-4 md:p-6", thread && "max-md:-mx-4 max-md:-my-5 sm:max-md:-mx-6")}>
        <header className={cn("space-y-3 sm:flex sm:items-end sm:justify-between sm:gap-3 sm:space-y-0", thread && "hidden md:flex")}>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] sm:text-[28px]">Replies</h1>
            <p className="text-sm text-muted-foreground">What customers wrote back to your campaign emails. Answer them here by email.</p>
          </div>
          <CampaignsTabs active="replies" />
        </header>
        <section aria-label="Replies" className={cn("glass overflow-clip", thread && "max-md:rounded-none max-md:border-x-0")}>
          <RepliesInbox
            thread={thread ?? null}
            campaign={campaign ?? null}
            // Opening adds a history entry so the phone's back button returns to the list.
            onOpen={(next) => go({ ...(campaign ? { campaign } : {}), ...(next ? { thread: next } : {}) }, next === null)}
            onClearCampaign={() => go(thread ? { thread } : {}, true)}
          />
        </section>
      </div>
    </AppShell>
  );
}
