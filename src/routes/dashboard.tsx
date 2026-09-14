import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — BookedSecure" },
      {
        name: "description",
        content:
          "Ask about your business, set up from your website, and see how your enquiries turn into completed work.",
      },
      { property: "og:title", content: "Home — BookedSecure" },
      {
        property: "og:description",
        content: "Assistant, website setup and performance in one place — nothing sends without approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    // Product discovery hidden until affiliate partnerships are in place.
    <AppShell title="Home"><AssistantWorkspace showDiscovery={false} /></AppShell>
  );
}
