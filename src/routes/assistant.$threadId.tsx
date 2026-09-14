import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/assistant/$threadId")({
  head: () => ({
    meta: [
      { title: "Cowork conversation — BookedSecure" },
      { name: "description", content: "Continue a private BookedSecure Cowork conversation for your business." },
      { property: "og:title", content: "Cowork conversation — BookedSecure" },
      { property: "og:description", content: "Continue a private tenant-scoped Cowork conversation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantThreadPage,
});

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  return <AppShell title="Assistant"><AssistantWorkspace requestedThreadId={threadId} /></AppShell>;
}