import { createFileRoute } from "@tanstack/react-router";
import { annualMonthsFree, formatMoney, type Plan } from "@/lib/plans";
import { getPublicPlans } from "@/lib/plans.functions";

/**
 * Public pricing page. Plans and prices come from the database so nothing is
 * hardcoded here — the page shows whatever is currently offered.
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
      { title: "Pricing — BookedSecure for mobile detailers" },
      {
        name: "description",
        content:
          "Two simple plans. Your own Australian number, an assistant that answers every enquiry in seconds, automatic follow-ups and a booking link. From $200 a month.",
      },
      { property: "og:title", content: "Pricing — BookedSecure for mobile detailers" },
      {
        property: "og:description",
        content:
          "Answer every enquiry in seconds, follow up automatically and fill your week. Two plans, monthly or a year upfront.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

/** What every plan gets, in the words an owner would use. */
const INCLUDED_EVERY_PLAN: readonly string[] = [
  "Your own dedicated Australian mobile number",
  "A branded quote page customers fill in on their phone",
  "An assistant that answers enquiries in seconds, using your services and prices",
  "Instant text confirmation on every new enquiry",
  "Booking links with your real availability",
  "Automatic follow-ups — straight away, a few hours later, and next day",
  "Every message waits for your approval before it goes out",
  "One inbox for every lead, reply and booking",
  "Opt-out, STOP handling and quiet hours looked after for you",
  "Bring your existing customer list in from a spreadsheet",
  "Reporting on enquiries, replies, bookings and texts used",
  "Daily sending limits so nothing can run away",
];

function PricingPage() {
  const plans = Route.useLoaderData();

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl">
        <header className="brand-wash rounded-lg border border-border p-5 text-center sm:p-8">
          <p className="text-sm font-semibold text-primary">BookedSecure</p>
          <h1 className="mt-2 page-heading">Every enquiry answered, every follow-up done</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            You get your own Australian number and an assistant that replies in seconds, quotes
            from your own price list, books the job and chases the ones who go quiet. Pay monthly
            or a year upfront.
          </p>
        </header>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>

        <section className="panel mt-6 p-5 sm:p-7">
          <h2 className="text-sm font-semibold">In every plan</h2>
          <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            {INCLUDED_EVERY_PLAN.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden="true">·</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Prices are in Australian dollars. Extra texts beyond your monthly allowance are bought
            in credit packs from your Messaging page, and sending stops until you top up — you can
            never get a surprise bill.
          </p>
        </section>
      </div>
    </main>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const monthsFree = annualMonthsFree(plan);
  return (
    <article className="panel flex h-full flex-col p-5 sm:p-6">
      <h2 className="text-base font-semibold">{plan.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>
      <p className="mt-4 text-3xl font-semibold">
        {formatMoney(plan.monthlyPriceMinorUnits)}
        <span className="text-sm font-normal text-muted-foreground"> / month</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        or {formatMoney(plan.annualPriceMinorUnits)} for the year
        {monthsFree > 0 ? ` — ${monthsFree} months free` : ""}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <li>{plan.includedSegments.toLocaleString()} texts included every month</li>
        <li>Extra texts {plan.overageCents}c each, bought as credits</li>
        <li>
          {plan.reactivationEnabled
            ? "Win-back campaigns to past customers"
            : "Win-back campaigns not included"}
        </li>
        <li>
          {plan.teamMemberLimit === null
            ? "Unlimited team members"
            : `Up to ${plan.teamMemberLimit} team members`}
        </li>
      </ul>
      <a
        href="/auth"
        className="mt-auto inline-block rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground"
      >
        Get started with {plan.name}
      </a>
    </article>
  );
}
