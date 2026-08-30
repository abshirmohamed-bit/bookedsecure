import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { LeadsWorkspace } from "@/components/LeadsWorkspace";

export const Route = createFileRoute("/leads/")({
  head: () => ({
    meta: [
      { title: "Leads — Glocast SMS Lead Response" },
      {
        name: "description",
        content:
          "The Glocast lead workspace: enquiries needing a reply, follow-up status and completed-job revenue.",
      },
      { property: "og:title", content: "Leads — Glocast SMS Lead Response" },
      {
        property: "og:description",
        content: "See which detailing enquiries need attention and how they are converting.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LeadsPage,
});

function LeadsPage() {
  return (
    <AppShell title="Leads">
      <LeadsWorkspace />
    </AppShell>
  );
}
