import { createFileRoute } from "@tanstack/react-router";
import { HomeHero } from "@/components/home/HomeHero";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BookedSecure — turn ads into enquiries" },
      {
        name: "description",
        content:
          "Funnel new leads from ads with a shareable quote page, or upload existing contacts to re-engage them. One place to capture, answer and win back every enquiry.",
      },
      { property: "og:title", content: "BookedSecure — turn ads into enquiries" },
      {
        property: "og:description",
        content:
          "Funnel new leads from ads with a shareable quote page, or upload existing contacts to re-engage them.",
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
