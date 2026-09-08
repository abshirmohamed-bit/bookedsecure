import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { OwnerAssistant } from "@/components/home/OwnerAssistant";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Assistant — BookedSecure" },
      {
        name: "description",
        content:
          "Ask about your business or ask for a win-back campaign. Every action is proposed first and only runs once you approve it.",
      },
      { property: "og:title", content: "Assistant — BookedSecure" },
      {
        property: "og:description",
        content: "Ask about your business or ask for a campaign — nothing sends without approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell title="Assistant">
      <OwnerAssistant />
    </AppShell>
  );
}
