import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/settings/billing")({
  head: () => ({
    meta: [
      { title: "Account access | BookedSecure" },
      { name: "description", content: "Contact BookedSecure about your account access." },
      { property: "og:title", content: "Account access | BookedSecure" },
      { property: "og:description", content: "Contact BookedSecure for help with access to your workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <AppShell title="Account access">
      <div className="mx-auto max-w-xl py-8 text-center sm:py-14">
        <Mail className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
        <h1 className="mt-4 text-2xl font-semibold">Contact BookedSecure</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          Account access is arranged directly with each business for now. Contact us if you would
          like to activate your workspace or need help with your account.
        </p>
        <Button asChild className="mt-6">
          <a href="mailto:bookedsecure@gmail.com?subject=BookedSecure%20account%20access">
            <Mail aria-hidden="true" /> Email BookedSecure
          </a>
        </Button>
      </div>
    </AppShell>
  );
}
