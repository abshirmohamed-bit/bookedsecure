import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/assistant/$threadId")({
  head: () => ({
    meta: [
      { title: "Co-Work | BookedSecure" },
      { name: "description", content: "Continue a private BookedSecure Co-Work conversation for your business." },
      { property: "og:title", content: "Co-Work conversation | BookedSecure" },
      { property: "og:description", content: "Continue a private tenant-scoped Co-Work conversation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AssistantThreadPage,
});

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  return <AppShell title="Co-Work"><AssistantWorkspace requestedThreadId={threadId} /></AppShell>;
}