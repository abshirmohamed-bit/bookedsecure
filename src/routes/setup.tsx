import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, Clock, Globe, ListChecks, Sparkles } from "lucide-react";
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

const STEPS = [
  { label: "Account created", state: "done" as const },
  { label: "Your website", state: "current" as const },
  { label: "Check and go live", state: "todo" as const },
];

const PROMISES = [
  { icon: Globe, title: "Your details", body: "Name, area served, phone and opening hours." },
  { icon: ListChecks, title: "Your services", body: "Every service and extra, with the prices you list." },
  { icon: Clock, title: "Your bookable times", body: "Built from the hours shown on your site." },
];

function SetupPage() {
  const navigate = useNavigate();
  const fetchSetup = useServerFn(getSetupState);
  const setup = useQuery({ queryKey: ["setup-state"], queryFn: () => fetchSetup(), retry: false });
  const readOnly = (setup.data?.role ?? "owner") !== "owner";
  const businessName = setup.data?.businessName ?? null;

  return (
    <main className="min-h-screen bg-gradient-to-b from-primary/5 via-background to-background">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14">
        {/* Progress */}
        <ol className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          {STEPS.map((step, index) => (
            <li key={step.label} className="flex min-w-0 items-center gap-3 sm:gap-4">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={[
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                    step.state === "done"
                      ? "bg-primary text-primary-foreground"
                      : step.state === "current"
                        ? "border-2 border-primary text-primary"
                        : "border border-border text-muted-foreground",
                  ].join(" ")}
                >
                  {step.state === "done" ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <span
                  className={[
                    "truncate text-sm",
                    step.state === "current"
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  ].join(" ")}
                >
                  {step.label}
                </span>
              </span>
              {index < STEPS.length - 1 && (
                <span aria-hidden className="hidden h-px flex-1 bg-border sm:block" />
              )}
            </li>
          ))}
        </ol>

        {/* Hero */}
        <div className="mt-8">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Takes about a minute
          </span>
          <h1 className="mt-4 font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
            Let&apos;s fill {businessName ? businessName : "your account"} in for you
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Give us your website address once. We read it and set everything up for you — you check it
            over and nothing is saved until you say yes.
          </p>
        </div>

        {/* What we bring across */}
        <ul className="mt-7 grid gap-3 sm:grid-cols-3">
          {PROMISES.map(({ icon: Icon, title, body }) => (
            <li key={title} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <Icon className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ul>

        {/* The one thing to do */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-1 shadow-sm">
          <SiteOnboardingPanel
            readOnly={readOnly}
            onApplied={() => navigate({ to: "/dashboard", replace: true })}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            No website? You can add your services by hand at any time.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: "/dashboard", replace: true })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            I&apos;ll do this later <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </main>
  );
}
