import { createFileRoute } from "@tanstack/react-router";
import { HomeLanding } from "@/components/home/HomeLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookedSecure — turn every detailing enquiry into a booked job" },
      {
        name: "description",
        content:
          "BookedSecure helps Australian detailing businesses reply instantly, follow up consistently and rebook past customers. Join the early-access pilot.",
      },
      {
        property: "og:title",
        content: "BookedSecure — turn every detailing enquiry into a booked job",
      },
      {
        property: "og:description",
        content:
          "Catch every ad enquiry, reply instantly, and rebook past customers — all from one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  return <HomeLanding />;
}
