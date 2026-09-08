import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { submitPilotApplication } from "@/lib/pilot.functions";
import { readAttribution } from "@/lib/pilot-schema";
import { ArrowRight, CheckCircle2, MessageSquare, Repeat2, ClipboardList } from "lucide-react";
import heroImage from "@/assets/detail-hero.jpg";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "BookedSecure — Follow-up software for AU detailing businesses" },
      {
        name: "description",
        content:
          "BookedSecure helps Australian detailing businesses respond to enquiries, follow up consistently and turn more leads into bookings. Join the early-access pilot.",
      },
      { property: "og:title", content: "BookedSecure — Organised follow-up for detailers" },
      {
        property: "og:description",
        content:
          "Designed for Australian mobile and automotive detailing businesses that want faster, more consistent enquiry follow-up. Early-access pilot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

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
  "Mobile detailing businesses",
  "Automotive detailing studios",
  "Paint correction specialists",
  "Ceramic coating businesses",
  "Interior detailing operators",
  "Owner-operators and small teams",
];

function LandingPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitApplication = useServerFn(submitPilotApplication);

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
          <a
            href="#pilot"
            className="inline-flex min-h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Join the pilot
          </a>
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
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
                Early-access pilot for Australian detailers
              </span>
              <h1 className="mt-5 font-heading text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
                BookedSecure
              </h1>
              <p className="mt-3 font-heading text-2xl font-medium leading-tight sm:text-3xl">
                Stop losing detailing enquiries you already paid for.
              </p>
              <p className="mt-4 max-w-xl text-base text-muted-foreground">
                BookedSecure helps Australian detailing businesses respond faster, follow up
                consistently, and turn more enquiries into booked jobs.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <a
                  href="#pilot"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Join the BookedSecure pilot <ArrowRight className="h-4 w-4" />
                </a>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Limited pilot spots available for Australian detailing businesses.
              </p>
            </div>
          </div>
        </section>

        {/* What it is */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14 text-center">
            <h2 className="text-2xl font-semibold sm:text-3xl">What BookedSecure does</h2>
            <p className="mt-4 text-base text-muted-foreground">
              It is follow-up software built for detailers. Enquiries are captured, acknowledged and
              tracked automatically, so you spend less time chasing and more time detailing.
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
              Australian detailing businesses that receive enquiries from websites, social media,
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

        {/* Final CTA + form */}
        <section id="pilot" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-2xl px-4 py-14">
            <h2 className="text-center text-2xl font-semibold sm:text-3xl">
              Join the early-access pilot
            </h2>
            <p className="mt-3 text-center text-sm text-muted-foreground">
              Register your interest below. We'll review your details and contact you about next
              steps.
            </p>

            {submitted ? (
              <div className="panel mt-8 p-5 text-sm">
                <p className="font-medium">Thanks.</p>
                <p className="mt-2 text-muted-foreground">
                  We've received your BookedSecure pilot application. We'll review the details and
                  follow up with the next steps.
                </p>
              </div>
            ) : (
              <form
                className="panel mt-8 space-y-4 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (submitting) return;
                  const form = event.currentTarget;
                  const values = new FormData(form);
                  const attribution = readAttribution(
                    window.location.search,
                    document.referrer,
                    window.location.pathname,
                  );
                  const volume = String(values.get("volume") ?? "").trim();
                  const payload = {
                    contact_name: String(values.get("name") ?? ""),
                    business_name: String(values.get("business") ?? ""),
                    email: String(values.get("email") ?? ""),
                    phone: String(values.get("mobile") ?? ""),
                    location: String(values.get("location") ?? ""),
                    weekly_enquiry_volume: volume === "" ? null : volume,
                    services: String(values.get("services") ?? ""),
                    challenge: String(values.get("challenge") ?? ""),
                    company: String(values.get("company") ?? ""),
                    ...attribution,
                  };

                  setSubmitting(true);
                  setError(null);
                  submitApplication({ data: payload })
                    .then((result) => {
                      if (result.ok) {
                        form.reset();
                        setSubmitted(true);
                      } else {
                        setError(
                          result.error ?? "We couldn't save your application. Please try again.",
                        );
                      }
                    })
                    .catch(() => {
                      setError("We couldn't save your application. Please try again shortly.");
                    })
                    .finally(() => setSubmitting(false));
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" name="name" required />
                  <Field label="Business name" name="business" required />
                  <Field label="Email address" name="email" type="email" required />
                  <Field label="Mobile number" name="mobile" type="tel" required />
                  <Field label="Business location" name="location" required />
                  <Field label="Approx. enquiries each week" name="volume" type="number" required />
                </div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">
                    What type of detailing work do you provide?
                  </span>
                  <textarea
                    name="services"
                    rows={2}
                    className="form-control mt-1.5 min-h-20 py-2"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">
                    What is your biggest follow-up challenge?
                  </span>
                  <select name="challenge" className="form-control mt-1.5" defaultValue="">
                    <option value="">Select an option</option>
                    <option>I cannot respond quickly enough</option>
                    <option>I forget to follow up</option>
                    <option>Leads come from too many places</option>
                    <option>I lose track of conversations</option>
                    <option>I am not sure which enquiries are still active</option>
                    <option>Other</option>
                  </select>
                </label>
                <input
                  type="text"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  className="hidden"
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
                >
                  {submitting ? "Sending…" : "Request early access"}
                </button>
              </form>
            )}
          </div>
        </section>

        <footer className="mx-auto max-w-4xl px-4 py-10 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">BookedSecure</p>
          <p className="mt-3">
            BookedSecure does not guarantee message delivery, customer responses, bookings, revenue
            outcomes or legal compliance for a particular business. Businesses remain responsible
            for obtaining appropriate customer consent and using communications in accordance with
            applicable requirements.
          </p>
        </footer>
      </main>

      {/* Sticky mobile CTA */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden">
        <a
          href="#pilot"
          className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
        >
          Join the BookedSecure pilot
        </a>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input name={name} type={type} required={required} className="form-control mt-1.5" />
    </label>
  );
}
