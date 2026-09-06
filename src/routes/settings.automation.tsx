import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { BusinessSettingsForm, RulesEditor, SettingsPageBody } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/automation")({
  head: () => ({
    meta: [
      { title: "Automation — BookedSecure" },
      {
        name: "description",
        content:
          "Turn automated acknowledgements on or off and edit the timing and wording of each SMS follow-up step.",
      },
      { property: "og:title", content: "Automation — BookedSecure" },
      {
        property: "og:description",
        content: "Control the acknowledgement and follow-up SMS sequence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AutomationSettingsPage,
});

function AutomationSettingsPage() {
  return (
    <AppShell title="Automation">
      <SettingsPageBody
        heading="Automation"
        description="What happens automatically after an enquiry arrives, and when follow-ups go out."
      >
        {(data) => (
          <>
            <BusinessSettingsForm
              business={data.business}
              readOnly={data.role !== "owner"}
              title="Automated messaging"
              showAutomationSwitch
              note="Follow-ups always stop when a customer replies, opts out, or you pause a conversation."
            />
            <RulesEditor rules={data.rules} readOnly={data.role !== "owner"} />
          </>
        )}
      </SettingsPageBody>
    </AppShell>
  );
}
