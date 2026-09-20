import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SettingsPageBody, TeamList } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/team")({
  head: () => ({
    meta: [
      { title: "Team access | BookedSecure" },
      {
        name: "description",
        content: "See who can view and respond to enquiries in this workspace.",
      },
      { property: "og:title", content: "Team access | BookedSecure" },
      {
        property: "og:description",
        content: "People with access to the lead workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeamSettingsPage,
});

function TeamSettingsPage() {
  return (
    <AppShell title="Team access">
      <SettingsPageBody heading="Team access" description="Who can see and reply to your leads.">
        {(data) => <TeamList team={data.team} role={data.role} />}
      </SettingsPageBody>
    </AppShell>
  );
}
