import { createFileRoute } from "@tanstack/react-router";
import { HomeHero } from "@/components/home/HomeHero";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookedSecure — turn every enquiry into a booked job" },
      {
        name: "description",
        content:
          "Catch every ad enquiry, reply instantly, and rebook past customers. One quote page, one inbox, zero leads slipping through the cracks.",
      },
      { property: "og:title", content: "BookedSecure — turn every enquiry into a booked job" },
      {
        property: "og:description",
        content: "Catch every ad enquiry, reply instantly, and rebook past customers — all from one place.",
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
