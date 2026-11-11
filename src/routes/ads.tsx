import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { GoogleAdsPerformance } from "@/components/ads/GoogleAdsPerformance";
import { AppShell } from "@/components/AppShell";
import { FacebookAdsPerformance } from "@/components/home/FacebookAdsPerformance";

/** Ad results: Facebook and Google Ads side by side, from spend to bookings and revenue. */
export const Route = createFileRoute("/ads")({
  validateSearch: (search: Record<string, unknown>) => z.object({ google: z.string().max(20).optional() }).parse(search),
  head: () => ({
    meta: [
      { title: "Ad results | BookedSecure" },
      { name: "description", content: "Facebook and Google Ads spend, clicks, leads, bookings and revenue in one place." },
    ],
  }),
  component: AdsPage,
});

function AdsPage() {
  const { google } = Route.useSearch();
  return (
    <AppShell title="Ad results">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Ad results</h1>
          <p className="text-sm text-muted-foreground">What each ad campaign cost, and the leads, bookings and revenue it brought in. Spend comes from Facebook and Google; everything after the click is your own BookedSecure records.</p>
        </div>
        <FacebookAdsPerformance />
        <GoogleAdsPerformance outcome={google} />
      </div>
    </AppShell>
  );
}
