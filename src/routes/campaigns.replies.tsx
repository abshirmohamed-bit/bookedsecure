import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { RepliesInbox } from "@/components/campaigns/RepliesInbox";

export const Route = createFileRoute("/campaigns/replies")({
  head: () => ({ meta: [{ title: "Replies | BookedSecure" }] }),
  validateSearch: (search: Record<string, unknown>): { thread?: string } =>
    typeof search["thread"] === "string" && /^[0-9a-f-]{36}$/i.test(search["thread"]) ? { thread: search["thread"] } : {},
  component: RepliesPage,
});

/** Customer replies to campaign emails: its own page under Campaigns in the sidebar. */
function RepliesPage() {
  const { thread } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AppShell title="Replies">
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <header>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">Replies</h1>
          <p className="text-sm text-muted-foreground">What customers wrote back to your campaign emails. Answer them here by email.</p>
        </header>
        <section aria-label="Replies" className="glass overflow-hidden">
          <RepliesInbox
            thread={thread ?? null}
            onOpen={(next) => void navigate({ to: "/campaigns/replies", search: next ? { thread: next } : {}, replace: true })}
          />
        </section>
      </div>
    </AppShell>
  );
}
