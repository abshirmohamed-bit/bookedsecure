import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MessagingOverviewCard } from "@/components/messaging/MessagingOverviewCard";
import { TextoNumberPanel } from "@/components/messaging/TextoNumberPanel";
import { CreditsPanel } from "@/components/billing/BillingPanel";
import { BusinessIdentityPanel } from "@/components/messaging/BusinessIdentityPanel";
import { MessagingAdvanced } from "@/components/messaging/MessagingAdvanced";
import { BusinessSettingsForm, SettingsPageBody } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/messaging")({
  head: () => ({
    meta: [
      { title: "Messaging | BookedSecure" },
      {
        name: "description",
        content:
          "Sending number, SMS signature, quiet hours and the SMS provider used to reply to enquiries.",
      },
      { property: "og:title", content: "Messaging | BookedSecure" },
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
            <BusinessIdentityPanel readOnly={data.role !== "owner"} />
            <TextoNumberPanel readOnly={data.role !== "owner"} />
            <CreditsPanel />
            <BusinessSettingsForm
              business={data.business}
              readOnly={data.role !== "owner"}
              title="How your texts look"
              textFields={["sms_signature"]}
              showQuietHours
              showSignaturePreview
              note="Your sign-off goes on the end of every text you send. Unless you turn quiet hours off below, nothing is sent to customers between 8pm and 8am your time."
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
