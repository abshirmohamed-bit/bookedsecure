import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AvailabilityEditor } from "@/components/settings/availability";
import { TenantAccountPanel } from "@/components/settings/TenantAccountPanel";

import {
  AddonsEditor,
  BusinessSettingsForm,
  QuotePageModeCard,
  ServicesEditor,
  SettingsPageBody,
} from "@/components/settings/sections";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";


export const Route = createFileRoute("/settings/business")({
  head: () => ({
    meta: [
      { title: "Business settings — BookedSecure" },
      {
        name: "description",
        content:
          "Business name, service area, opening hours and the approved service catalogue used in quotes.",
      },
      { property: "og:title", content: "Business settings — BookedSecure" },
      {
        property: "og:description",
        content: "Manage business details and the approved service catalogue.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessSettingsPage,
});

function BusinessSettingsPage() {
  return (
    <AppShell title="Business settings">
      <SettingsPageBody
        heading="Business settings"
        description="How your business is described to customers, and the services you offer."
        actions={(data) => (
          <>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                  Bookable availability
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Bookable availability</DialogTitle>
                  <DialogDescription>
                    Working windows used to work out appointment times for customers.
                  </DialogDescription>
                </DialogHeader>
                <AvailabilityEditor
                  availability={data.availability}
                  timezone={data.business.timezone}
                  readOnly={data.role !== "owner"}
                />
              </DialogContent>
            </Dialog>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="w-full sm:w-auto">
                  Approved services
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[85vh] w-[95vw] overflow-y-auto sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle>Approved services</DialogTitle>
                  <DialogDescription>
                    The only services the assistant is allowed to mention or quote from, plus any
                    extras customers can add to them.
                  </DialogDescription>
                </DialogHeader>
                <ServicesEditor services={data.services} readOnly={data.role !== "owner"} />
                <AddonsEditor
                  addons={data.addons}
                  services={data.services.map((service) => ({
                    id: service.id,
                    name: service.name,
                  }))}
                  readOnly={data.role !== "owner"}
                />
              </DialogContent>
            </Dialog>
          </>
        )}
      >
        {(data) => (
          <>
            
            <BusinessSettingsForm
              business={data.business}
              readOnly={data.role !== "owner"}
              title="Business details"
              textFields={[
                "name",
                "service_area",
                "opening_hours",
                "privacy_policy_url",
                "timezone",
              ]}
            />
            <TenantAccountPanel />
            <QuotePageModeCard
              quoteMode={data.business.quote_mode}
              slug={data.business.slug}
              readOnly={data.role !== "owner"}
            />
          </>
        )}
      </SettingsPageBody>

    </AppShell>
  );
}
