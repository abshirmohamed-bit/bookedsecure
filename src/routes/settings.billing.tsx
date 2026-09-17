import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BillingPanel } from "@/components/billing/BillingPanel";

export const Route = createFileRoute("/settings/billing")({
  head: () => ({
    meta: [
      { title: "Plan & billing — BookedSecure" },
      { name: "description", content: "Your BookedSecure plan, text credits and billing." },
      { property: "og:title", content: "Plan & billing — BookedSecure" },
      { property: "og:description", content: "Choose a plan, see included texts and manage billing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <AppShell title="Plan & billing">
      <div className="mx-auto max-w-4xl space-y-4">
        <header>
          <h1 className="text-xl font-semibold">Plan & billing</h1>
          <p className="text-sm text-muted-foreground">Your plan, text credits and payment details.</p>
        </header>
        <BillingPanel />
      </div>
    </AppShell>
  );
}
