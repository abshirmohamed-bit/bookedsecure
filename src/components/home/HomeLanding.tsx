import { Link } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, MessageSquare, Repeat2, ClipboardList } from "lucide-react";
import heroImage from "@/assets/service-hero.jpg";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Capture every enquiry",
    body: "Leads flow in from your website, social pages, quote form, phone or manual entry — all in one place.",
  },
  {
    icon: MessageSquare,
    title: "Reply instantly and follow up",
    body: "Each enquiry gets an immediate acknowledgement and scheduled follow-up so nothing is forgotten.",
  },
  {
    icon: Repeat2,
    title: "Keep the conversation moving",
    body: "Customer replies are tracked with the lead, so you always know where the conversation stands.",
  },
  {
    icon: CheckCircle2,
    title: "Confirm the next step",
    body: "You stay in control — review the lead, answer questions and move it towards a quote or booking.",
  },
];

const AUDIENCE = [
  "Mobile service businesses",
  "Cleaning, lawn and garden operators",
  "Trades and sole traders",
  "Automotive detailing studios",
  "Owner-operators and small teams",
  "Anyone who books jobs from enquiries",
];

export function HomeLanding() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <a href="#top" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              B
            </span>
            <span className="text-sm font-semibold tracking-tight">BookedSecure</span>
          </a>
          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/pricing"
              className="inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Pricing
            </Link>
            <Link
              to="/auth"
              className="inline-flex min-h-10 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Get BookedSecure
            </Link>
          </div>
        </div>
      </header>

      <main id="top" className="pb-24 sm:pb-0">
        {/* Hero */}
        <section className="relative isolate min-h-[78vh] overflow-hidden">
          <img
            src={heroImage}
            alt=""
            className="absolute inset-0 -z-20 h-full w-full object-cover object-[62%_center]"
            aria-hidden="true"
          />
          <div className="absolute inset-0 -z-10 bg-background/85" />
          <div className="mx-auto flex min-h-[78vh] max-w-6xl items-center px-4 py-14">
            <div className="max-w-2xl">
              <h1 className="font-heading text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
                Stop paying for leads that go nowhere
              </h1>
              <p className="mt-4 font-heading text-2xl font-medium leading-tight sm:text-3xl">
                It's really simple.
              </p>
              <p className="mt-4 max-w-xl text-base text-muted-foreground">
                Capture new leads. Re-engage the ones you already paid for. Turn more enquiries into
                bookings.
              </p>
              <p className="mt-3 max-w-xl text-base text-muted-foreground">
                BookedSecure helps Australian service businesses respond faster, follow up
                consistently, and turn more enquiries into booked jobs.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/auth"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Get BookedSecure today <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Stop losing jobs to slow follow-up — set up in a day, no lock-in.
              </p>
            </div>
          </div>
        </section>

        {/* What it is */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 text-center">
            <h2 className="text-2xl font-semibold sm:text-3xl">What BookedSecure does</h2>
            <p className="mt-4 text-base text-muted-foreground">
              Every enquiry you don't answer is a job that goes to someone else. BookedSecure
              captures, acknowledges and follows up automatically, so you spend less time chasing and
              more time working.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-center text-2xl font-semibold sm:text-3xl">How it works</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {STEPS.map((step, i) => (
              <div key={step.title} className="panel p-5">
                <div className="flex items-center gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-secondary-foreground">
                    <step.icon className="h-4 w-4" />
                  </span>
                  <p className="text-sm font-medium">
                    {i + 1}. {step.title}
                  </p>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Who it's for */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-center text-2xl font-semibold sm:text-3xl">Who it is for</h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-muted-foreground">
              Australian service businesses that receive enquiries from websites, social media,
              Google, quote forms, phone calls and referrals.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AUDIENCE.map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <footer className="mx-auto max-w-4xl px-4 py-10 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/pricing" className="transition-colors hover:text-foreground">
              Pricing
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-foreground">
              Privacy &amp; SMS consent
            </Link>
            <Link to="/auth" className="transition-colors hover:text-foreground">
              Sign in
            </Link>
          </div>
          <p className="mt-4">
            BookedSecure does not guarantee message delivery, customer responses, bookings, revenue
            outcomes or legal compliance for a particular business. Businesses remain responsible
            for obtaining appropriate customer consent and using communications in accordance with
            applicable requirements.
          </p>
        </footer>
      </main>

      {/* Sticky mobile CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden">
        <Link
          to="/auth"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
        >
          Get BookedSecure
        </Link>
      </div>
    </div>
  );
}
