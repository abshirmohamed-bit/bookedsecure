import { createFileRoute } from "@tanstack/react-router";
import { HomeLanding } from "@/components/home/HomeLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookedSecure. stop paying for leads that go nowhere" },
      {
        name: "description",
        content:
          "Capture new leads, re-engage the ones you already paid for, and turn more enquiries into bookings. Built for Australian service businesses.",
      },
      {
        property: "og:title",
        content: "BookedSecure. stop paying for leads that go nowhere",
      },
      {
        property: "og:description",
        content:
          "Respond faster, follow up consistently, and turn more enquiries into booked jobs.",
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
