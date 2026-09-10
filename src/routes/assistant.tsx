import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/assistant")({
  component: () => <AppShell><AssistantWorkspace /></AppShell>,
});