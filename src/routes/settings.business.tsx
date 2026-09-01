import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AvailabilityEditor } from "@/components/settings/availability";
import {
  BusinessSettingsForm,
  ServicesEditor,
  SettingsPageBody,
} from "@/components/settings/sections";

export const Route = createFileRoute("/settings/business")({
  head: () => ({
    meta: [
      { title: "Business settings — Glocast SMS Lead Response" },
      {
        name: "description",
        content:
          "Business name, service area, opening hours and the approved detailing service catalogue used in quotes.",
      },
      { property: "og:title", content: "Business settings — Glocast SMS Lead Response" },
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
                "logo_url",
                "privacy_policy_url",
                "timezone",
              ]}
            />
            <AvailabilityEditor
              availability={data.availability}
              timezone={data.business.timezone}
              readOnly={data.role !== "owner"}
            />
            <ServicesEditor services={data.services} readOnly={data.role !== "owner"} />
          </>
        )}
      </SettingsPageBody>
    </AppShell>
  );
}
