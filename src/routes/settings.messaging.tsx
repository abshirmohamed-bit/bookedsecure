import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { SmsSetupPanel } from "@/components/SmsSetupPanel";
import {
  BusinessSettingsForm,
  ProviderStatus,
  SettingsPageBody,
} from "@/components/settings/sections";

export const Route = createFileRoute("/settings/messaging")({
  head: () => ({
    meta: [
      { title: "Messaging — BookedSecure" },
      {
        name: "description",
        content:
          "Sending number, SMS signature, quiet hours and the SMS provider used to reply to detailing enquiries.",
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
        description="How messages are sent, how they are signed, and when they are allowed to go out."
      >
        {(data) => (
          <>
            <ProviderStatus provider={data.provider} />
            <BusinessSettingsForm
              business={data.business}
              readOnly={data.role !== "owner"}
              title="Sending setup"
              textFields={["phone_number", "sms_signature"]}
              showProvider
              showQuietHours
              note="Quiet hours use your business timezone. Nothing is sent to customers between these hours."
            />
            <SmsSetupPanel />
          </>
        )}
      </SettingsPageBody>
    </AppShell>
  );
}
