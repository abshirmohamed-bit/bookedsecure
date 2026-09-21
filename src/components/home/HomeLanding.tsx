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
    <div className="min-h-screen bg-landing-canvas font-['Work_Sans'] text-landing-ink selection:bg-landing-depth">
      <header className="border-b border-landing-line/70 bg-landing-canvas/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="BookedSecure home">
            <img
              src={brandMark.url}
              alt=""
              className="h-9 w-10 shrink-0 object-contain object-center"
            />
            <span className="truncate text-base font-semibold">BookedSecure</span>
          </a>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" className="min-h-11 px-3 text-landing-ink/70 hover:bg-landing-paper/70 hover:text-landing-ink">
              <Link to="/pricing">Pricing</Link>
            </Button>
            <Button asChild variant="ghost" className="min-h-11 px-3 text-landing-ink/70 hover:bg-landing-paper/70 hover:text-landing-ink">
              <Link to={isSignedIn ? "/dashboard" : "/auth"}>
                {isSignedIn ? "Dashboard" : "Sign in"}
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="relative overflow-hidden px-5 pb-20 pt-16 sm:px-8 sm:pb-28 sm:pt-24 lg:pb-36">
          <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,.75fr)] lg:gap-20">
            <div className="relative z-10 max-w-3xl">
              <p className="mb-7 text-xs font-semibold uppercase tracking-[0.2em] text-landing-blue">
                For Australian service businesses
              </p>
              <h1 className="font-['Instrument_Serif'] text-6xl font-normal leading-[0.96] sm:text-7xl lg:text-8xl">
                Stop paying for leads
                <span className="block italic text-landing-blue">that go nowhere.</span>
              </h1>
              <p className="mt-7 font-['Instrument_Serif'] text-3xl leading-tight sm:text-4xl">
                It's really simple.
              </p>
              <p className="mt-6 max-w-xl text-base leading-7 text-landing-ink/70 sm:text-lg">
                Capture new leads. Re-engage the ones you already paid for. Turn more enquiries into bookings.
              </p>
              <p className="mt-3 max-w-xl text-base leading-7 text-landing-ink/70">
                BookedSecure helps Australian service businesses respond faster, follow up consistently, and turn more enquiries into booked jobs.
              </p>
              <div className="mt-9">
                <Button asChild size="lg" className="min-h-13 w-full rounded-lg bg-landing-ink px-6 text-landing-paper shadow-xl shadow-landing-ink/10 hover:bg-landing-blue sm:w-auto">
                  <Link to="/auth">
                    Get BookedSecure today <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
              </div>
              <p className="mt-4 text-xs text-landing-ink/55">
                Stop losing jobs to slow follow-up. Set up in a day, no lock-in.
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-md lg:mx-0 lg:justify-self-end">
              <div className="absolute inset-8 rounded-full bg-landing-depth blur-3xl" aria-hidden="true" />
              <div className="relative rotate-1 rounded-2xl border border-landing-paper/80 bg-landing-paper/75 p-3 shadow-2xl shadow-landing-ink/10 backdrop-blur-xl transition-transform duration-500 hover:rotate-0">
                <div className="overflow-hidden rounded-xl border border-landing-line bg-landing-paper">
                  <div className="grid grid-cols-[auto_1fr_auto] items-center border-b border-landing-line px-4 py-3">
                    <div className="flex gap-1.5" aria-hidden="true">
                      <span className="h-2 w-2 rounded-full bg-landing-depth" />
                      <span className="h-2 w-2 rounded-full bg-landing-line" />
                      <span className="h-2 w-2 rounded-full bg-landing-blue" />
                    </div>
                    <span className="text-center text-[10px] font-medium text-landing-ink/45">BookedSecure</span>
                    <CheckCircle2 className="h-4 w-4 text-landing-blue" aria-hidden="true" />
                  </div>
                  <div className="space-y-5 p-5 sm:p-7">
                    <div>
                      <p className="text-xs font-medium text-landing-ink/50">New enquiry</p>
                      <p className="mt-1 font-['Instrument_Serif'] text-2xl">Exterior detail enquiry</p>
                    </div>
                    <div className="rounded-lg border border-landing-line bg-landing-canvas/65 p-4">
                      <p className="text-sm leading-6">Hi, I’d like a quote for my SUV this Saturday.</p>
                    </div>
                    <div className="ml-8 rounded-lg bg-landing-ink p-4 text-landing-paper">
                      <div className="mb-2 flex items-center gap-2 text-xs text-landing-paper/60">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                        Reply sent instantly
                      </div>
                      <p className="text-sm leading-6">Thanks for getting in touch. Let’s find the right service and time for you.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg border border-landing-line p-3">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-landing-ink/45">Status</p>
                        <p className="mt-1 text-sm font-medium">Follow-up ready</p>
                      </div>
                      <div className="rounded-lg border border-landing-line p-3">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-landing-ink/45">Next step</p>
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium"><CalendarCheck2 className="h-4 w-4 text-landing-blue" /> Booking</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 sm:px-8">
          <div className="mx-auto grid max-w-5xl gap-6 border-y border-landing-line py-7 text-center sm:grid-cols-3 sm:divide-x sm:divide-landing-line">
            <p className="font-['Instrument_Serif'] text-xl sm:text-2xl">Capture new leads</p>
            <p className="font-['Instrument_Serif'] text-xl sm:text-2xl">Follow up consistently</p>
            <p className="font-['Instrument_Serif'] text-xl sm:text-2xl">Turn enquiries into bookings</p>
          </div>
        </section>

        <section className="px-5 py-28 text-center sm:px-8 sm:py-40">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-landing-blue">What BookedSecure does</p>
            <h2 className="mt-7 font-['Instrument_Serif'] text-4xl font-normal leading-tight sm:text-6xl">
              Every enquiry you don't answer is a job that goes to someone else.
            </h2>
            <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-landing-ink/65 sm:text-lg">
              Every enquiry you don't answer is a job that goes to someone else. BookedSecure
              captures, acknowledges and follows up automatically, so you spend less time chasing and
              more time working.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="bg-landing-paper/70 px-5 py-24 sm:px-8 sm:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-landing-blue">How it works</p>
              <h2 className="mt-5 font-['Instrument_Serif'] text-4xl font-normal sm:text-6xl">From enquiry to next step.</h2>
            </div>
            <div className="mt-14 grid gap-px overflow-hidden rounded-lg border border-landing-line bg-landing-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <article key={step.title} className="group min-h-64 bg-landing-paper p-6 transition-colors hover:bg-landing-canvas sm:p-8">
                <div className="flex items-center justify-between">
                  <span className="font-['Instrument_Serif'] text-4xl text-landing-blue/60">0{i + 1}</span>
                  <step.icon className="h-5 w-5 text-landing-blue transition-transform group-hover:scale-110" aria-hidden="true" />
                </div>
                <h3 className="mt-12 font-['Instrument_Serif'] text-2xl leading-tight">{step.title}</h3>
                <p className="mt-4 text-sm leading-6 text-landing-ink/65">{step.body}</p>
              </article>
            ))}
            </div>
          </div>
        </section>

        <section className="px-5 py-24 sm:px-8 sm:py-36">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-10 lg:grid-cols-[.7fr_1.3fr] lg:gap-20">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-landing-blue">Who it is for</p>
                <h2 className="mt-5 font-['Instrument_Serif'] text-4xl font-normal leading-tight sm:text-6xl">Built for service businesses.</h2>
                <p className="mt-6 max-w-md text-base leading-7 text-landing-ink/65">
              Australian service businesses that receive enquiries from websites, social media,
              Google, quote forms, phone calls and referrals.
                </p>
              </div>
              <div className="divide-y divide-landing-line border-y border-landing-line">
              {AUDIENCE.map((item) => (
                <div
                  key={item}
                  className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 py-5"
                >
                  <Check className="h-4 w-4 shrink-0 text-landing-blue" aria-hidden="true" />
                  <span className="min-w-0 font-['Instrument_Serif'] text-xl sm:text-2xl">{item}</span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-landing-ink/30 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </div>
              ))}
              </div>
            </div>
          </div>
        </section>

        <footer className="border-t border-landing-line px-5 py-12 text-xs text-landing-ink/60 sm:px-8">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-8 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex items-center gap-2 text-landing-ink">
                <img src={brandMark.url} alt="" className="h-8 w-9 object-contain" />
                <span className="font-semibold">BookedSecure</span>
              </div>
              <div className="flex flex-wrap items-center gap-5">
            <Link to="/pricing" className="transition-colors hover:text-landing-ink">
              Pricing
            </Link>
            <Link to="/privacy" className="transition-colors hover:text-landing-ink">
              Privacy &amp; SMS consent
            </Link>
            <Link to="/auth" className="transition-colors hover:text-landing-ink">
              Sign in
            </Link>
              </div>
            </div>
            <p className="mt-8 max-w-4xl border-t border-landing-line pt-8 leading-5">
              BookedSecure does not guarantee message delivery, customer responses, bookings, revenue outcomes or legal compliance for a particular business. Businesses remain responsible for obtaining appropriate customer consent and using communications in accordance with applicable requirements.
            </p>
          </div>
        </footer>
      </main>
    </div>
  );
}
