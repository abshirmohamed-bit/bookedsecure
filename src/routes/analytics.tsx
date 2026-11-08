import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AnalyticsOverview } from "@/components/home/AnalyticsOverview";

/** Results: how enquiries turn into work, text delivery and Facebook ad returns. */
export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Results | BookedSecure" },
      { name: "description", content: "How your enquiries turn into bookings and completed work." },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  return (
    <AppShell title="Results">
      <div className="mx-auto w-full max-w-5xl space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Results</h1>
        <p className="pb-4 text-sm text-muted-foreground">All-time numbers for your business, from first enquiry to completed job.</p>
        <AnalyticsOverview />
      </div>
    </AppShell>
  );
}
