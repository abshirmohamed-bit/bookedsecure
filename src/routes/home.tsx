import { createFileRoute } from "@tanstack/react-router";
import { HomeLanding } from "@/components/home/HomeLanding";

export const Route = createFileRoute("/home")({
  head: () => ({
    meta: [
      { title: "Home — BookedSecure for Australian detailers" },
      {
        name: "description",
        content:
          "How BookedSecure captures every detailing enquiry, replies instantly and keeps follow-up consistent. Join the early-access pilot.",
      },
      { property: "og:title", content: "Home — BookedSecure for Australian detailers" },
      {
        property: "og:description",
        content:
          "Follow-up software for Australian detailing businesses: capture, reply, follow up, rebook.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HomeRoutePage,
});

function HomeRoutePage() {
  return <HomeLanding />;
}
