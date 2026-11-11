import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CoworkWorkspace } from "@/components/cowork/CoworkWorkspace";

export const Route = createFileRoute("/assistant")({
  head: () => ({
    meta: [
      { title: "Co-Work | BookedSecure" },
      { name: "description", content: "Ask BookedSecure Co-Work to help run your tenant-scoped lead operations." },
      { property: "og:title", content: "Co-Work | BookedSecure" },
      { property: "og:description", content: "A focused workspace for BookedSecure Co-Work conversations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <AppShell title="Co-Work"><CoworkWorkspace routeThreads headline={<>What should we <span className="cowork-accent">work on</span> today?</>} /></AppShell>,
});