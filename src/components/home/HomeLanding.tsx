import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  MessageSquare,
  ZoomIn,
  Repeat2,
  Sparkles,
} from "lucide-react";
import brandMark from "@/assets/bookedsecure-mark.png.asset.json";
import appShot from "@/assets/bookedsecure-app.jpg.asset.json";
import mobileDemo from "@/assets/bookedsecure-mobile-demo.mp4.asset.json";
import mobileDemoPoster from "@/assets/bookedsecure-mobile-demo-poster.jpg.asset.json";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

function SectionSpacer() {
  return <div className="h-[18vh] min-h-20 max-h-48" aria-hidden="true" />;
}

export function HomeLanding() {
  const { session } = useAuth();
  const isSignedIn = Boolean(session);

  return (
    <div className="min-h-screen bg-landing-bg text-landing-copy">
      <header className="bg-transparent backdrop-blur-xl">
        <div className="mx-auto grid min-h-20 max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 sm:px-8 lg:px-12">
          <a href="#top" className="flex min-w-0 items-center gap-2" aria-label="BookedSecure home">
            <img
              src={brandMark.url}
              alt=""
              className="h-9 w-9 shrink-0 object-contain object-center"
            />
            <span className="truncate font-heading text-base font-semibold text-landing-accent">BookedSecure</span>
          </a>
          <nav className="flex shrink-0 items-center gap-1" aria-label="Main navigation">
            <Button asChild className="min-h-10 bg-landing-action px-3 text-landing-action-foreground hover:bg-landing-action-hover sm:px-5">
              <Link to={isSignedIn ? "/dashboard" : "/auth"}>
                {isSignedIn ? "Dashboard" : "Sign in"}
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="top">
        <section>
          <div className="mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
            <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-16 xl:gap-24">
              <div className="lg:col-span-7 xl:col-span-7">
                <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-transparent px-3 py-1.5 text-xs font-medium text-landing-muted">
                  <span className="h-1.5 w-1.5 rounded-full bg-landing-accent" />
                  For Australian service businesses
                </div>
                <h1 className="max-w-4xl font-heading text-5xl font-semibold leading-[1.04] text-landing-accent sm:text-7xl lg:text-8xl">
                  It's really simple.
                </h1>
                <p className="mt-5 max-w-2xl text-lg leading-8 text-landing-copy sm:text-xl">
                  Capture new leads. Re-engage the ones you already paid for. Turn more enquiries into bookings.
                </p>
                <div className="mt-8 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
                  <Button asChild size="lg" className="min-h-12 w-full bg-landing-action px-6 text-landing-action-foreground hover:bg-landing-action-hover sm:w-auto">
                    {isSignedIn ? (
                      <Link to="/dashboard">Go to Dashboard <ArrowRight aria-hidden="true" /></Link>
                    ) : (
                      <a href="tel:+61466907824">
                        Call +61 466 907 824 <ArrowRight aria-hidden="true" />
                      </a>
                    )}
                  </Button>
                </div>
              </div>
              <div className="flex justify-center lg:col-span-5 lg:justify-end xl:col-span-5">
                <div className="relative w-full max-w-[18rem] rounded-[2.25rem] bg-landing-elevated p-2 shadow-2xl shadow-landing-shadow sm:max-w-[20rem] lg:max-w-[18rem] xl:max-w-[20rem]">
                  <div className="pointer-events-none absolute left-1/2 top-3 z-10 h-5 w-20 -translate-x-1/2 rounded-full bg-landing-elevated" aria-hidden="true" />
                  <div className="aspect-[384/832] overflow-hidden rounded-[1.8rem] bg-landing-surface">
                    <video
                      src={mobileDemo.url}
                      poster={mobileDemoPoster.url}
                      className="h-full w-full object-cover"
                      autoPlay
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      aria-label="BookedSecure mobile quote assistant demonstration"
                    />
                  </div>
                </div>
              </div>
            </div>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" className="group relative mt-12 block h-auto w-full p-0 sm:mt-16" aria-label="Open workspace preview full screen">
                  <figure aria-label="BookedSecure workspace preview">
                    <div className="rounded-2xl bg-landing-elevated p-1.5 shadow-2xl shadow-landing-shadow sm:rounded-3xl sm:p-2">
                      <div className="overflow-hidden rounded-xl bg-landing-surface sm:rounded-2xl">
                        <div className="flex items-center gap-1.5 px-4 py-2.5 sm:py-3">
                          <span className="h-2 w-2 rounded-full bg-landing-accent/70 sm:h-2.5 sm:w-2.5" />
                          <span className="h-2 w-2 rounded-full bg-landing-accent-alt/70 sm:h-2.5 sm:w-2.5" />
                          <span className="h-2 w-2 rounded-full bg-landing-muted/40 sm:h-2.5 sm:w-2.5" />
                        </div>
                        <img
                          src={appShot.url}
                          alt="The BookedSecure workspace with the Cowork assistant"
                          className="block w-full"
                          loading="lazy"
                        />
                      </div>
                  </div>
                    <div className="mx-auto h-2.5 w-[88%] rounded-b-2xl bg-landing-elevated shadow-lg shadow-landing-shadow sm:h-3 sm:rounded-b-3xl" aria-hidden="true" />
                    <span className="absolute bottom-5 right-5 grid h-11 w-11 place-items-center rounded-full bg-landing-copy text-landing-action-foreground opacity-90 shadow-lg transition-transform group-hover:scale-105">
                      <ZoomIn aria-hidden="true" />
                    </span>
                  </figure>
                </Button>
              </DialogTrigger>
              <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none gap-0 border-0 bg-landing-copy p-4 shadow-none sm:rounded-none sm:p-8 [&>button]:bg-landing-surface [&>button]:p-2 [&>button]:text-landing-copy [&>button]:opacity-100">
                <DialogTitle className="sr-only">BookedSecure workspace preview</DialogTitle>
                <div className="flex h-full min-h-0 items-center justify-center overflow-auto">
                  <img
                    src={appShot.url}
                    alt="The BookedSecure workspace with the Cowork assistant"
                    className="max-h-none min-w-[64rem] max-w-none rounded-lg shadow-2xl sm:min-w-[80rem]"
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </section>

        <section className="bg-transparent">
          <div className="mx-auto grid max-w-7xl px-5 sm:grid-cols-3 sm:px-8 lg:px-12">
            {["Capture new leads", "Follow up consistently", "Turn enquiries into bookings"].map((label) => (
              <div key={label} className="flex items-center gap-3 py-7 sm:px-7 first:sm:pl-0 last:sm:pr-0">
                <Check className="h-4 w-4 shrink-0 text-landing-accent-alt" />
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <SectionSpacer />

        <section>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12 lg:px-12 lg:py-28">
            <div className="lg:col-span-5">
              <p className="text-sm font-semibold text-landing-accent">What BookedSecure does</p>
              <h2 className="mt-3 max-w-md font-heading text-3xl font-semibold leading-tight text-landing-accent sm:text-4xl">Every enquiry you don't answer is a job that goes to someone else.</h2>
            </div>
            <div className="lg:col-span-6 lg:col-start-7 lg:flex lg:items-end">
              <p className="max-w-2xl text-lg leading-8 text-landing-muted">BookedSecure captures, acknowledges and follows up automatically, so you spend less time chasing and more time working.</p>
            </div>
          </div>
        </section>

        <SectionSpacer />

        <section id="how-it-works" className="bg-transparent">
          <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8 sm:py-24 lg:px-12 lg:py-28">
            <p className="text-sm font-semibold text-landing-accent">How it works</p>
            <h2 className="mt-3 font-heading text-3xl font-semibold text-landing-accent sm:text-4xl">From enquiry to next step.</h2>
            <div className="mt-14 grid sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <div key={step.title} className="py-6 sm:px-6 first:sm:pl-0 last:sm:pr-0">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm text-landing-accent">0{i + 1}</span>
                  <step.icon className="h-5 w-5 text-landing-muted" />
                </div>
                <h3 className="mt-10 text-lg font-semibold text-landing-accent">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-landing-muted">{step.body}</p>
              </div>
            ))}
            </div>
          </div>
        </section>

        <SectionSpacer />

        <section>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-12 lg:px-12 lg:py-28">
            <div className="lg:col-span-4">
              <p className="text-sm font-semibold text-landing-accent">Who it is for</p>
              <h2 className="mt-3 font-heading text-3xl font-semibold text-landing-accent sm:text-4xl">Built for service businesses.</h2>
              <p className="mt-5 leading-7 text-landing-muted">Australian service businesses that receive enquiries from websites, social media, Google, quote forms, phone calls and referrals.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:col-span-7 lg:col-start-6">
              {AUDIENCE.map((item) => (
                <div
                  key={item}
                  className="group grid min-h-24 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-transparent p-5 text-sm"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-landing-accent-alt" />
                  <span>{item}</span>
                  <ChevronRight className="h-4 w-4 text-landing-muted transition-transform group-hover:translate-x-0.5 group-hover:text-landing-accent" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <SectionSpacer />

        <section className="bg-transparent">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-20 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-landing-accent"><Sparkles className="h-4 w-4" /> BookedSecure</p>
              <h2 className="mt-2 font-heading text-2xl font-semibold text-landing-accent sm:text-3xl">Turn more enquiries into bookings.</h2>
            </div>
            <Button asChild size="lg" className="min-h-12 w-full shrink-0 bg-landing-action px-6 text-landing-action-foreground hover:bg-landing-action-hover md:w-auto">
              {isSignedIn ? (
                <Link to="/dashboard">Go to Dashboard <ArrowRight aria-hidden="true" /></Link>
              ) : (
                <a href="tel:+61466907824">
                  Call +61 466 907 824 <ArrowRight aria-hidden="true" />
                </a>
              )}
            </Button>
          </div>
        </section>

        <footer className="mx-auto max-w-7xl bg-transparent px-5 py-14 text-xs text-landing-muted sm:px-8 lg:px-12">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="flex items-center gap-2 text-landing-copy">
              <img src={brandMark.url} alt="" className="h-7 w-7 object-contain" />
              <span className="font-heading text-sm font-semibold text-landing-accent">BookedSecure</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
            <Link to="/privacy" className="transition-colors hover:text-landing-copy">
              Privacy &amp; SMS consent
            </Link>
            <Link to={isSignedIn ? "/dashboard" : "/auth"} className="transition-colors hover:text-landing-copy">
              {isSignedIn ? "Dashboard" : "Sign in"}
            </Link>
            </div>
          </div>
          <p className="mt-8 max-w-4xl pt-6 leading-5">
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
