import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AssistantWorkspace } from "@/components/home/AssistantWorkspace";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Cowork — BookedSecure" },
      { name: "description", content: "Ask BookedSecure Cowork to help run your tenant-scoped lead operations." },
      { property: "og:title", content: "Cowork — BookedSecure" },
      { property: "og:description", content: "A focused workspace for BookedSecure Cowork conversations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <AppShell title="Assistant"><AssistantWorkspace /></AppShell>,
});