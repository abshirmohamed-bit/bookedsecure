import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Sparkles } from "lucide-react";
import { SiteOnboardingPanel } from "@/components/settings/SiteOnboardingPanel";
import { TradePicker } from "@/components/settings/TradePicker";
import { getSetupState } from "@/lib/site-onboarding.functions";

export const Route = createFileRoute("/setup")({
  validateSearch: (search: Record<string, unknown>) => ({
    step:
      search["step"] === "trade" || search["step"] === "website"
        ? search["step"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Set up your business — BookedSecure" },
      {
        name: "description",
        content:
          "Paste your website address and BookedSecure fills in your business details, services, prices and hours for you.",
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
  const { step } = Route.useSearch();
  const fetchSetup = useServerFn(getSetupState);
  const setup = useQuery({ queryKey: ["setup-state"], queryFn: () => fetchSetup(), retry: false });
  const readOnly = (setup.data?.role ?? "owner") !== "owner";

  // Nobody who is already set up should land here: staff never need it, and an
  // owner with services saved goes straight to Home.
  useEffect(() => {
    if (setup.data && !setup.data.needsSetup && !step) navigate({ to: "/dashboard", replace: true });
  }, [setup.data, navigate, step]);

  if (setup.isLoading || (setup.data && !setup.data.needsSetup && !step)) {
    return <main className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <div className="mx-auto w-full max-w-xl px-4 py-16 sm:py-24">
        <div className="text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Takes about a minute
          </span>
          <h1 className="mt-5 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Let&apos;s get you set up quickly
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
            Paste your website address and we&apos;ll pull in your business details, services, prices and hours.
            You can review before anything is saved.
          </p>
        </div>

        <div id="trade" className="mt-8 scroll-mt-6">
          <TradePicker readOnly={readOnly} />
        </div>

        <div id="website" className="mt-4 scroll-mt-6">
          <SiteOnboardingPanel
            readOnly={readOnly}
            onApplied={() => navigate({ to: "/dashboard", replace: true })}
          />
        </div>

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard", replace: true })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            I&apos;ll do this later <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </main>
  );
}
