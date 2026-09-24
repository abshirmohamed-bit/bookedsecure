import { Check } from "lucide-react";

export const INCLUDED_EVERY_PLAN: readonly string[] = [
  "A branded quote page customers fill in on their phone",
  "An assistant that answers enquiries in seconds, using your services and prices",
  "Instant text confirmation on every new enquiry",
  "Booking links with your real availability",
  "Automatic follow-ups. straight away, a few hours later, and next day",
  "Win-back campaigns to past customers, and bulk campaigns to your list",
  "Every message waits for your approval before it goes out",
  "One inbox for every lead, reply and booking",
  "Opt-out, STOP handling and quiet hours looked after for you",
  "Bring your existing customer list in from a spreadsheet",
  "Reporting on enquiries, replies, bookings and texts used",
  "Unlimited team members and daily sending limits so nothing can run away",
];

export const PRICING_DETAIL =
  "Prices are in Australian dollars. Your dedicated Australian number is $15 a month plus GST from our messaging provider, paid with your own card. Texts are bought as credits - from us or straight from the provider. and sending stops when you run out, so you can never get a surprise bill.";

type PricingBenefitsProps = {
  landing?: boolean;
};

export function PricingBenefits({ landing = false }: PricingBenefitsProps) {
  return (
    <section
      aria-labelledby={landing ? "landing-included-heading" : "pricing-included-heading"}
      className={landing ? "bg-transparent" : undefined}
    >
      <div className={landing ? "mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28" : undefined}>
        <div className={landing ? "mx-auto max-w-5xl" : "rounded-2xl bg-card p-6 shadow-xl shadow-landing-shadow sm:p-10"}>
          <p className="text-sm font-semibold text-primary">Everything you need to follow through</p>
          <h2
            id={landing ? "landing-included-heading" : "pricing-included-heading"}
            className="mt-2 font-heading text-3xl font-semibold text-landing-accent sm:text-4xl"
          >
            In every plan
          </h2>
          <div className="mt-8 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {INCLUDED_EVERY_PLAN.map((item) => (
              <div key={item} className="flex items-start gap-3 text-sm leading-6 text-landing-copy">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-landing-accent-soft text-landing-accent">
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <p className="mt-9 text-xs leading-5 text-landing-muted">{PRICING_DETAIL}</p>
        </div>
      </div>
    </section>
  );
}