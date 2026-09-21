import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  MessageSquare,
  Repeat2,
  Sparkles,
} from "lucide-react";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const STEPS = [
  {
    icon: ClipboardList,
    title: "Capture every enquiry",
    body: "Leads flow in from your website, social pages, quote form, phone or manual entry. all in one place.",
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
    body: "You stay in control. review the lead, answer questions and move it towards a quote or booking.",
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
  const { session } = useAuth();
  const isSignedIn = Boolean(session);

  return (
    <div className="min-h-screen bg-landing-bg text-landing-copy">
      <header className="border-b border-landing-border bg-landing-bg/95 backdrop-blur">
        <div className="mx-auto grid min-h-16 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="BookedSecure home">
            <img
              src={brandMark.url}
              alt=""
              className="h-9 w-9 shrink-0 object-contain object-center"
            />
            <span className="truncate font-heading text-base font-semibold">BookedSecure</span>
          </a>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Main navigation">
            <Button asChild variant="ghost" className="min-h-10 px-2.5 text-landing-muted hover:bg-landing-elevated hover:text-landing-copy sm:px-4">
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button asChild className="min-h-10 bg-landing-blue px-3 text-landing-blue-foreground hover:bg-landing-blue-strong sm:px-5">
              <Link to={isSignedIn ? "/dashboard" : "/auth"}>
                {isSignedIn ? "Dashboard" : "Sign in"}
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="border-b border-landing-border">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-8 lg:py-28">
            <div className="lg:col-span-7">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-landing-border bg-landing-surface px-3 py-1.5 text-xs font-medium text-landing-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-landing-green" />
                For Australian service businesses
              </div>
              <h1 className="max-w-3xl font-heading text-5xl font-semibold leading-[1.02] sm:text-6xl lg:text-7xl">
                Stop paying for leads <span className="text-landing-blue">that go nowhere.</span>
              </h1>
              <p className="mt-6 font-heading text-2xl font-medium sm:text-3xl">It's really simple.</p>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-landing-copy">
                Capture new leads. Re-engage the ones you already paid for. Turn more enquiries into bookings.
              </p>
              <p className="mt-4 max-w-2xl leading-7 text-landing-muted">
                BookedSecure helps Australian service businesses respond faster, follow up consistently, and turn more enquiries into booked jobs.
              </p>
              <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="min-h-12 w-full bg-landing-blue px-6 text-landing-blue-foreground hover:bg-landing-blue-strong sm:w-auto">
                  <Link to={isSignedIn ? "/dashboard" : "/auth"}>
                    {isSignedIn ? "Go to Dashboard" : "Get BookedSecure today"}
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <p className="text-sm text-landing-muted">Stop losing jobs to slow follow-up. Set up in a day, no lock-in.</p>
              </div>
            </div>

            <div className="relative lg:col-span-5 lg:pl-6">
              <div className="overflow-hidden rounded-lg border border-landing-border bg-landing-surface shadow-2xl shadow-landing-shadow">
                <div className="flex items-center justify-between border-b border-landing-border px-4 py-3">
                  <div className="flex items-center gap-2">
                    <img src={brandMark.url} alt="" className="h-7 w-7 object-contain" />
                    <span className="text-sm font-semibold">BookedSecure</span>
                  </div>
                  <span className="flex items-center gap-1.5 text-xs text-landing-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-landing-green" /> Live
                  </span>
                </div>
                <div className="p-4 sm:p-5">
                  <p className="text-xs font-medium uppercase text-landing-muted">New enquiry</p>
                  <p className="mt-2 font-heading text-xl font-semibold">Exterior detail enquiry</p>
                  <div className="mt-4 rounded-md border border-landing-border bg-landing-elevated p-4 text-sm leading-6">
                    Hi, I’d like a quote for my SUV this Saturday.
                  </div>
                  <div className="mt-4 rounded-md border border-landing-blue/30 bg-landing-blue-soft p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-landing-blue-light">
                      <CheckCircle2 className="h-4 w-4" /> Reply sent instantly
                    </div>
                    <p className="mt-2 text-sm leading-6 text-landing-copy">Thanks for getting in touch. Let’s find the right service and time for you.</p>
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-md border border-landing-border bg-landing-elevated p-3">
                      <span className="text-xs text-landing-muted">Status</span>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><span className="h-1.5 w-1.5 rounded-full bg-landing-green" /> Follow-up ready</p>
                    </div>
                    <div className="rounded-md border border-landing-border bg-landing-elevated p-3">
                      <span className="text-xs text-landing-muted">Next step</span>
                      <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><CalendarCheck2 className="h-3.5 w-3.5 text-landing-blue-light" /> Booking</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-landing-border bg-landing-surface">
          <div className="mx-auto grid max-w-7xl divide-y divide-landing-border px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 lg:px-8">
            {["Capture new leads", "Follow up consistently", "Turn enquiries into bookings"].map((label) => (
              <div key={label} className="flex items-center gap-3 py-5 sm:px-6 first:sm:pl-0 last:sm:pr-0">
                <Check className="h-4 w-4 shrink-0 text-landing-green" />
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="border-b border-landing-border">
          <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-5">
              <p className="text-sm font-semibold text-landing-blue-light">What BookedSecure does</p>
              <h2 className="mt-3 max-w-md font-heading text-3xl font-semibold leading-tight sm:text-4xl">Every enquiry you don't answer is a job that goes to someone else.</h2>
            </div>
            <div className="lg:col-span-6 lg:col-start-7 lg:flex lg:items-end">
              <p className="max-w-2xl text-lg leading-8 text-landing-muted">BookedSecure captures, acknowledges and follows up automatically, so you spend less time chasing and more time working.</p>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-landing-border bg-landing-surface">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
            <p className="text-sm font-semibold text-landing-blue-light">How it works</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold sm:text-4xl">From enquiry to next step.</h2>
            <div className="mt-10 grid border-y border-landing-border sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="border-b border-landing-border py-6 sm:border-r sm:px-6 lg:border-b-0 first:sm:pl-0 last:border-r-0 last:sm:pr-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-landing-blue-light">0{i + 1}</span>
                  <step.icon className="h-5 w-5 text-landing-muted" />
                </div>
                <h3 className="mt-10 text-lg font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{step.body}</p>
              </div>
            ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-12 lg:px-8">
            <div className="lg:col-span-4">
              <p className="text-sm font-semibold text-landing-blue-light">Who it is for</p>
              <h2 className="mt-3 font-heading text-3xl font-semibold sm:text-4xl">Built for service businesses.</h2>
              <p className="mt-5 leading-7 text-landing-muted">Australian service businesses that receive enquiries from websites, social media, Google, quote forms, phone calls and referrals.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-7 lg:col-start-6">
              {AUDIENCE.map((item) => (
                <div
                  key={item}
                  className="group grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-landing-border bg-landing-surface p-4 text-sm transition-colors hover:border-landing-blue/50 hover:bg-landing-elevated"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-landing-green" />
                  <span>{item}</span>
                  <ChevronRight className="h-4 w-4 text-landing-muted transition-transform group-hover:translate-x-0.5 group-hover:text-landing-blue-light" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-landing-border bg-landing-surface">
          <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-landing-blue-light"><Sparkles className="h-4 w-4" /> BookedSecure</p>
              <h2 className="mt-2 font-heading text-2xl font-semibold sm:text-3xl">Turn more enquiries into bookings.</h2>
            </div>
            <Button asChild size="lg" className="min-h-12 w-full shrink-0 bg-landing-blue px-6 text-landing-blue-foreground hover:bg-landing-blue-strong md:w-auto">
              <Link to={isSignedIn ? "/dashboard" : "/auth"}>Get BookedSecure today <ArrowRight aria-hidden="true" /></Link>
            </Button>
          </div>
        </section>

        <footer className="mx-auto max-w-7xl px-4 py-10 text-xs text-landing-muted sm:px-6 lg:px-8">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="flex items-center gap-2 text-landing-copy">
              <img src={brandMark.url} alt="" className="h-7 w-7 object-contain" />
              <span className="font-heading text-sm font-semibold">BookedSecure</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
            <Link to="/pricing" className="transition-colors hover:text-landing-copy">
              Pricing
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-landing-copy">
              Privacy &amp; SMS consent
            </Link>
            <Link to={isSignedIn ? "/dashboard" : "/auth"} className="transition-colors hover:text-landing-copy">
              {isSignedIn ? "Dashboard" : "Sign in"}
            </Link>
            </div>
          </div>
          <p className="mt-8 max-w-4xl border-t border-landing-border pt-6 leading-5">
            BookedSecure does not guarantee message delivery, customer responses, bookings, revenue
            outcomes or legal compliance for a particular business. Businesses remain responsible
            for obtaining appropriate customer consent and using communications in accordance with
            applicable requirements.
          </p>
        </footer>
      </main>
    </div>
  );
}
