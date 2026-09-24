import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Check, Sparkles } from "lucide-react";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import { PricingBenefits } from "@/components/pricing/PricingBenefits";
import { Button } from "@/components/ui/button";
import { annualMonthsFree, formatMoney, type Plan } from "@/lib/plans";
import { getPublicPlans } from "@/lib/plans.functions";

/**
 * Public pricing page. Plans and prices come from the database so nothing is
 * hardcoded here. the page shows whatever is currently offered.
 */
export const Route = createFileRoute("/pricing")({
  loader: () => getPublicPlans(),
  errorComponent: () => (
    <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
      Pricing is unavailable right now. Please try again in a moment.
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-muted-foreground">
      Page not found.
    </main>
  ),
  head: () => ({
    meta: [
      { title: "Pricing | BookedSecure for service businesses" },
      {
        name: "description",
        content:
          "One simple plan at $100 a month. An assistant that answers every enquiry in seconds, automatic follow-ups, booking links and win-back campaigns. Your number and texts are bought separately.",
      },
      { property: "og:title", content: "Pricing | BookedSecure for service businesses" },
      {
        property: "og:description",
        content:
          "Answer every enquiry in seconds, follow up automatically and fill your week. One plan, monthly or a year upfront.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const plans = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-landing-bg text-landing-copy">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12" aria-label="Pricing navigation">
        <Link to="/" className="flex items-center gap-2" aria-label="BookedSecure home">
          <img src={brandMark.url} alt="" className="h-9 w-9 object-contain" />
          <span className="font-heading text-base font-semibold text-landing-accent">BookedSecure</span>
        </Link>
        <Button asChild variant="ghost" className="text-landing-muted hover:bg-landing-elevated hover:text-landing-copy">
          <Link to="/"><ArrowLeft aria-hidden="true" /> Home</Link>
        </Button>
      </nav>

      <div className="mx-auto max-w-3xl px-5 pb-20 pt-12 sm:px-8 sm:pb-28 sm:pt-20">
        <header className="text-center">
          <p className="text-sm font-semibold text-landing-accent">Simple, complete pricing</p>
          <h1 className="mt-3 font-heading text-4xl font-semibold leading-tight text-landing-copy sm:text-6xl">
            Every enquiry answered,<br className="hidden sm:block" /> every follow-up done
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-landing-muted sm:text-lg">
            An assistant that replies in seconds, quotes from your own price list, books the job and
            chases the ones who go quiet. Pay monthly or a year upfront. Your own Australian number
            and your texts come from our messaging provider and are paid to them directly.
          </p>
        </header>

        <div className="mx-auto mt-12 grid max-w-xl gap-6 sm:mt-16">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>

        <div className="mt-12 sm:mt-16"><PricingBenefits /></div>
      </div>
    </main>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const monthsFree = annualMonthsFree(plan);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl bg-card p-7 shadow-xl shadow-landing-shadow sm:p-10">
      <div className="flex items-center gap-2 text-sm font-semibold text-landing-accent">
        <Sparkles className="h-4 w-4" aria-hidden="true" /> Full access
      </div>
      <h2 className="mt-4 font-heading text-2xl font-semibold text-landing-copy">{plan.name}</h2>
      <p className="mt-2 text-sm leading-6 text-landing-muted">{plan.tagline}</p>
      <p className="mt-8 font-heading text-5xl font-semibold text-landing-copy sm:text-6xl">
        {formatMoney(plan.monthlyPriceMinorUnits)}
        <span className="ml-2 font-sans text-base font-normal text-landing-muted">/ month</span>
      </p>
      <p className="mt-2 text-sm font-medium text-landing-accent">
        or {formatMoney(plan.annualPriceMinorUnits)} for the year
        {monthsFree > 0 ? `. ${monthsFree} months free` : ""}
      </p>
      <ul className="mt-8 space-y-4 pt-7 text-sm text-landing-copy">
        {plan.includedSegments > 0 ? (
          <PlanPoint>{plan.includedSegments.toLocaleString()} texts included every month</PlanPoint>
        ) : (
          <PlanPoint>Your own Australian number, $15 a month plus GST from the provider</PlanPoint>
        )}
        <PlanPoint>Texts {plan.overageCents}c each, bought as credits</PlanPoint>
        <PlanPoint>
          {plan.reactivationEnabled
            ? "Win-back campaigns to past customers"
            : "Win-back campaigns not included"}
        </PlanPoint>
        <PlanPoint>
          {plan.teamMemberLimit === null
            ? "Unlimited team members"
            : `Up to ${plan.teamMemberLimit} team members`}
        </PlanPoint>
      </ul>
      <Button asChild size="lg" className="mt-10 min-h-12 w-full bg-landing-action text-landing-action-foreground hover:bg-landing-action-hover">
        <Link to="/auth">Get started with {plan.name}</Link>
      </Button>
    </article>
  );
}

function PlanPoint({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-landing-accent-soft text-landing-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      </span>
      <span>{children}</span>
    </li>
  );
}
