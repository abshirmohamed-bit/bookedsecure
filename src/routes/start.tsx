import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import { readSignupSource, rememberSignupSource } from "@/lib/signup-source";

/**
 * Public start page. the landing spot for ads, partner links and emails.
 * It remembers the campaign tags it was opened with, then hands the visitor to
 * the ordinary sign-up form and the six-step setup journey.
 */
export const Route = createFileRoute("/start")({
  validateSearch: (search: Record<string, unknown>) => ({
    ref: typeof search["ref"] === "string" ? search["ref"] : undefined,
    source: typeof search["source"] === "string" ? search["source"] : undefined,
    utm_source: typeof search["utm_source"] === "string" ? search["utm_source"] : undefined,
    utm_campaign: typeof search["utm_campaign"] === "string" ? search["utm_campaign"] : undefined,
    c: typeof search["c"] === "string" ? search["c"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Start your free setup | BookedSecure" },
      {
        name: "description",
        content:
          "Set up BookedSecure for your service business in six steps: your trade, your website, your details, then start turning old customers into bookings.",
      },
      { property: "og:title", content: "Start your free setup | BookedSecure" },
      {
        property: "og:description",
        content: "Six guided steps from sign-up to your first text campaign. Setup is free.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StartPage,
});

const STEPS = [
  "Tell us your trade",
  "Add your website and we read your services",
  "Check your services and prices",
  "Confirm your business details",
  "Contact BookedSecure to activate your workspace",
  "Upload your old customers and send your first campaign",
];

function StartPage() {
  const search = Route.useSearch();

  useEffect(() => {
    rememberSignupSource(readSignupSource(search as Record<string, unknown>));
  }, [search]);

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-8">
        <Link to="/" className="flex items-center gap-2">
          <img src={brandMark.url} alt="" className="h-9 w-10 object-contain object-center" />
          <span className="font-heading text-base font-semibold">BookedSecure</span>
        </Link>
        <Link to="/auth" className="text-sm text-muted-foreground hover:text-foreground">
          Sign in
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
        <p className="text-sm font-medium text-primary">Free to set up</p>
        <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight sm:text-5xl">
          Turn the customers you already paid for into bookings.
        </h1>
        <p className="mt-4 text-muted-foreground">
          BookedSecure answers your enquiries, follows them up by text, and books the job. with
          your prices, your wording and your approval.
        </p>

        <ol className="mt-8 space-y-2">
          {STEPS.map((step, index) => (
            <li key={step} className="flex items-start gap-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                <span className="text-muted-foreground">Step {index + 1}. </span>
                {step}
              </span>
            </li>
          ))}
        </ol>

        <Button asChild size="lg" className="mt-8 w-full sm:w-auto">
          <Link to="/auth" search={{ new: true }}>
            Create my account <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          Setting up costs nothing. Contact BookedSecure when you are ready to activate your workspace.
        </p>
      </main>
    </div>
  );
}
