import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, Clapperboard } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { StudioChannels } from "@/components/studio/StudioChannels";
import { StudioClips } from "@/components/studio/StudioClips";

type StudioSearch = { tab?: "clips" | "channels"; clip?: string; video?: string };
const UUID = /^[0-9a-f-]{36}$/i;

/** Studio: every clip Co-Work has made (open, edit, post) and how the channels are doing. */
export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Studio | BookedSecure" },
      { name: "description", content: "Your clipped videos and channel analytics in one place." },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): StudioSearch => ({
    ...(search["tab"] === "clips" || search["tab"] === "channels" ? { tab: search["tab"] } : {}),
    ...(typeof search["clip"] === "string" && UUID.test(search["clip"]) ? { clip: search["clip"] } : {}),
    ...(typeof search["video"] === "string" && UUID.test(search["video"]) ? { video: search["video"] } : {}),
  }),
  component: StudioPage,
});

const TABS = [
  { id: "clips", label: "Clips", icon: Clapperboard },
  { id: "channels", label: "Channels", icon: BarChart3 },
] as const;

function StudioPage() {
  const search = Route.useSearch();
  const tab = search.tab ?? "clips";
  return (
    <AppShell title="Studio">
      <div className="mx-auto w-full max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-3 pb-4">
          <div>
            <h1 className="font-heading text-2xl font-semibold tracking-tight">Studio</h1>
            <p className="text-sm text-muted-foreground">Every clip Co-Work has made, and how your channels are doing.</p>
          </div>
          <nav aria-label="Studio sections" className="glass inline-flex rounded-full p-1">
            {TABS.map((t) => (
              <Link
                key={t.id}
                to="/studio"
                search={{ tab: t.id }}
                aria-current={tab === t.id ? "page" : undefined}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors ${tab === t.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <t.icon className="size-4" aria-hidden="true" />{t.label}
              </Link>
            ))}
          </nav>
        </header>
        {tab === "clips" ? <StudioClips clipId={search.clip} videoId={search.video} /> : <StudioChannels />}
      </div>
    </AppShell>
  );
}
