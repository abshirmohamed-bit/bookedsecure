import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/lib/navigation";
import { SettingsPageBody } from "@/components/settings/sections";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — BookedSecure" },
      {
        name: "description",
        content:
          "Your sign-in email, role and the business workspace you are currently operating in BookedSecure.",
      },
      { property: "og:title", content: "Your profile — BookedSecure" },
      {
        property: "og:description",
        content: "Your account details and current business workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { session } = useAuth();

  return (
    <AppShell title="Profile">
      <SettingsPageBody heading="Your profile" description="Who you are signed in as.">
        {(data) => (
          <section className="panel p-4">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Row label="Email" value={session?.user.email ?? "—"} />
              <Row label="Role" value={ROLE_LABELS[data.role] ?? data.role} />
              <Row label="Business" value={data.business.name} />
              <Row label="Timezone" value={data.business.timezone} />
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Need a different email or password? Sign out and use the “forgot password” link on the
              sign-in screen.
            </p>
          </section>
        )}
      </SettingsPageBody>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}
