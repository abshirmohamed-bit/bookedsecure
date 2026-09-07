import { createFileRoute } from "@tanstack/react-router";
import { HomeHero } from "@/components/home/HomeHero";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookedSecure — ask about your business" },
      {
        name: "description",
        content:
          "Ask about leads, bookings, replies and win-back campaigns, answered from your own records. Read-only: nothing is sent or changed.",
      },
      { property: "og:title", content: "BookedSecure — ask about your business" },
      {
        property: "og:description",
        content: "Read-only answers about your leads, bookings, replies and win-back campaigns.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return <HomeHero />;
}
