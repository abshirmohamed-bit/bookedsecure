import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { SiteOnboardingPanel } from "@/components/settings/SiteOnboardingPanel";
import { getSetupState } from "@/lib/site-onboarding.functions";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Set up your business — BookedSecure" },
      {
        name: "description",
        content:
          "Add your website address and BookedSecure fills in your business details, services, prices and hours for you.",
      },
      { property: "og:title", content: "Set up your business — BookedSecure" },
      {
        property: "og:description",
        content: "One step: paste your website and we do the rest of your setup.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const fetchSetup = useServerFn(getSetupState);
  const setup = useQuery({ queryKey: ["setup-state"], queryFn: () => fetchSetup() });
  const readOnly = (setup.data?.role ?? "owner") !== "owner";

  // Already set up (or staff): this step has nothing to do, so go straight in.
  useEffect(() => {
    if (setup.data && !setup.data.needsSetup) navigate({ to: "/dashboard", replace: true });
  }, [setup.data, navigate]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <ol className="mb-6 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5 text-success-foreground">
          <Check className="h-4 w-4" /> Account created
        </li>
        <li aria-hidden>·</li>
        <li className="font-semibold text-foreground">Step 2 — Your website</li>
        <li aria-hidden>·</li>
        <li>Step 3 — Check and go live</li>
      </ol>

      <h1 className="font-heading text-3xl font-semibold">Let's fill your account in for you</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Give us your website address once. We read your business name, area, phone, hours, services,
        add-ons and prices from it, show you everything, and save it only when you say so — so you
        skip typing all of it in.
      </p>

      <div className="mt-6">
        <SiteOnboardingPanel
          readOnly={readOnly}
          onApplied={() => navigate({ to: "/dashboard", replace: true })}
        />
      </div>

      <button
        type="button"
        onClick={() => navigate({ to: "/dashboard", replace: true })}
        className="mt-5 text-xs text-muted-foreground underline hover:text-foreground"
      >
        I'll do this later — take me to my dashboard
      </button>
    </main>
  );
}
