import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HomeOverview } from "@/components/home/HomeOverview";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Home | BookedSecure" },
      {
        name: "description",
        content: "What needs you today, this week's numbers, your latest leads and what's coming up.",
      },
      { property: "og:title", content: "Home | BookedSecure" },
      { property: "og:description", content: "Today's to-dos, latest leads and bookings in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell title="Home">
      <HomeOverview />
    </AppShell>
  );
}
