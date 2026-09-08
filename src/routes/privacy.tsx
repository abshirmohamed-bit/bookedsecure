import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy & SMS consent — BookedSecure" },
      {
        name: "description",
        content:
          "How this business handles your mobile number, enquiry details and SMS follow-up, and how to opt out.",
      },
      { property: "og:title", content: "Privacy & SMS consent — BookedSecure" },
      {
        property: "og:description",
        content: "Privacy and SMS opt-out information for detailing enquiries.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl">
        <header className="brand-wash rounded-lg border border-border p-5 sm:p-7">
          <p className="text-sm font-semibold text-primary">BookedSecure</p>
          <h1 className="mt-2 page-heading">Privacy & SMS consent</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            A clear summary of how enquiry details and messages are handled.
          </p>
        </header>
        <div className="panel mt-4 space-y-4 p-5 text-sm text-muted-foreground sm:p-7">
          <p>
            When you submit a detailing enquiry, the business collects your name, mobile number,
            suburb and vehicle details so we can respond and recommend a suitable service.
          </p>
          <p>
            We send SMS messages about your enquiry, including a short follow-up if we don't hear
            back. Reply STOP, UNSUBSCRIBE, CANCEL or QUIT at any time and automated messages stop
            immediately; the opt-out is recorded with a timestamp.
          </p>
          <p>
            Message content, delivery status and consent records are stored securely and used only
            to service your enquiry and to measure our own response times. We use a third-party SMS
            provider to deliver messages.
          </p>
          <p>
            To request access to, correction of, or deletion of your information, contact the
            business directly and we'll action it promptly.
          </p>
          <p className="text-xs">
            This page is an operational summary. Confirm final wording with an Australian privacy
            and marketing professional before launch.
          </p>
        </div>
      </div>
    </main>
  );
}
