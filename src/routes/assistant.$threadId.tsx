import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/assistant/$threadId")({ component: AssistantThreadPage });

function AssistantThreadPage() {
  const { threadId } = Route.useParams();
  return <AppShell title="Assistant"><AssistantWorkspace requestedThreadId={threadId} /></AppShell>;
}