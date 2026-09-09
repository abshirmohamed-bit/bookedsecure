import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { OwnerAssistant } from "@/components/home/OwnerAssistant";
import { AnalyticsOverview } from "@/components/home/AnalyticsOverview";
import { SiteOnboardingPanel } from "@/components/settings/SiteOnboardingPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getSession } from "@/lib/app.functions";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — BookedSecure" },
      {
        name: "description",
        content:
          "Ask about your business, set up from your website, and see how your enquiries turn into completed work.",
      },
      { property: "og:title", content: "Home — BookedSecure" },
      {
        property: "og:description",
        content: "Assistant, website setup and performance in one place — nothing sends without approval.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const fetchSession = useServerFn(getSession);
  const session = useQuery({ queryKey: ["session"], queryFn: () => fetchSession() });
  const readOnly = (session.data?.role ?? "staff") !== "owner";

  return (
    <AppShell title="Home">
      <Tabs defaultValue="assistant" className="space-y-5">
        <TabsList>
          <TabsTrigger value="assistant">Assistant</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="assistant" className="space-y-5">
          <OwnerAssistant />
          <SiteOnboardingPanel readOnly={readOnly} />
        </TabsContent>

        <TabsContent value="performance">
          <AnalyticsOverview />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
