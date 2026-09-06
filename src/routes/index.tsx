import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LeadsWorkspace } from "@/components/LeadsWorkspace";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lead inbox — BookedSecure" },
      {
        name: "description",
        content:
          "Today's detailing enquiries, SMS follow-up status and completed-job revenue by source channel.",
      },
      { property: "og:title", content: "Lead inbox — BookedSecure" },
      {
        property: "og:description",
        content: "Respond faster to detailing enquiries and track completed jobs by source.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell title="Leads">
      <LeadsWorkspace />
    </AppShell>
  );
}
