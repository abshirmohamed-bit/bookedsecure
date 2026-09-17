import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MessagingOverviewCard } from "@/components/messaging/MessagingOverviewCard";
import { DedicatedNumberPanel } from "@/components/messaging/DedicatedNumberPanel";
import { BusinessIdentityPanel } from "@/components/messaging/BusinessIdentityPanel";
import { MessagingAdvanced } from "@/components/messaging/MessagingAdvanced";
import { BusinessSettingsForm, SettingsPageBody } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/messaging")({
  head: () => ({
    meta: [
      { title: "Messaging — BookedSecure" },
      {
        name: "description",
        content:
          "Sending number, SMS signature, quiet hours and the SMS provider used to reply to enquiries.",
      },
      { property: "og:title", content: "Messaging — BookedSecure" },
      {
        property: "og:description",
        content: "Control how and when SMS replies are sent to customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MessagingSettingsPage,
});

function MessagingSettingsPage() {
  return (
    <AppShell title="Messaging">
      <SettingsPageBody
        heading="Messaging"
        description="Your number, your texts and when they are allowed to go out."
      >
        {(data) => (
          <>
            <MessagingOverviewCard />
            <DedicatedNumberPanel readOnly={data.role !== "owner"} />
            <BusinessSettingsForm
              business={data.business}
              readOnly={data.role !== "owner"}
              title="How your texts look"
              textFields={["sms_signature"]}
              showQuietHours
              note="Your sign-off is added to the end of your texts. Quiet hours use your business timezone — nothing is sent to customers between these hours."
            />
            <MessagingAdvanced
              provider={data.provider}
              business={data.business}
              readOnly={data.role !== "owner"}
            />
          </>
        )}
      </SettingsPageBody>
    </AppShell>
  );
}
