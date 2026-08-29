import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  MessageSquare,
  MessagesSquare,
  Repeat2,
  ShieldCheck,
} from "lucide-react";

import heroImage from "@/assets/detail-hero.jpg";
import enquiryImage from "@/assets/detail-enquiry.jpg";
import exteriorImage from "@/assets/detail-exterior.jpg";
import coatingImage from "@/assets/detail-coating.jpg";
import interiorImage from "@/assets/detail-interior.jpg";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const Route = createFileRoute("/landing")({
  head: () => ({
    meta: [
      { title: "BookedSecure — Follow-up software for AU detailing businesses" },
      {
        name: "description",
        content:
          "BookedSecure is an early-stage platform designed to help Australian detailing businesses acknowledge enquiries, follow up consistently and keep leads moving. Join the pilot.",
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
    title: "Capture the enquiry",
    body: "A new lead enters the BookedSecure workflow from your existing enquiry process — website form, social message, quote page or manual entry.",
  },
  {
    icon: MessageSquare,
    title: "Acknowledge and follow up",
    body: "The workflow is designed to prepare or send an acknowledgement, then schedule sensible follow-up actions so the enquiry isn't forgotten.",
  },
  {
    icon: MessagesSquare,
    title: "Continue the conversation",
    body: "Inbound replies are kept with the lead, so you can see what the potential customer asked and where the conversation stopped.",
  },
  {
    icon: CheckCircle2,
    title: "Review and confirm the next step",
    body: "You stay in control — review the lead, answer vehicle-specific questions and move the enquiry towards a quote, appointment or booked job.",
  },
];

const WORKFLOW = [
  {
    label: "New enquiry received",
    body: "“Hi, I'm looking for a full interior and exterior detail for my 2019 Mazda CX-5. Are you available next Saturday?”",
    side: "in" as const,
  },
  {
    label: "Acknowledgement prepared",
    body: "“Thanks for getting in touch. We've received your enquiry and will help with the next steps shortly.”",
    side: "out" as const,
  },
  {
    label: "Follow-up scheduled",
    body: "“Just checking whether you still need a quote for your Mazda CX-5. We can help with availability and package options.”",
    side: "out" as const,
  },
  {
    label: "Customer replies",
    body: "“Yes, I'm still interested. Do you have anything available in the afternoon?”",
    side: "in" as const,
  },
  {
    label: "Next action",
    body: "Review the conversation, answer the question and progress the enquiry towards a booking.",
    side: "note" as const,
  },
];

const BENEFITS = [
  {
    title: "Respond more consistently",
    body: "Give new enquiries a clear acknowledgement process, even when you're mid-polish or driving between jobs.",
  },
  {
    title: "Reduce forgotten follow-ups",
    body: "Create a visible next step for every enquiry that still needs a quote, answer or nudge.",
  },
  {
    title: "Keep conversations organised",
    body: "See which potential customers are waiting, replying or ready for the next step.",
  },
  {
    title: "Make the next action clear",
    body: "Less guessing about which enquiries are still alive and what you promised.",
  },
  {
    title: "Spend less time repeating basic replies",
    body: "Structured messaging for common enquiry stages, with you still in the conversation.",
  },
  {
    title: "A more professional first impression",
    body: "Potential customers know their enquiry landed and that someone will follow up.",
  },
];

const FEATURES = [
  { icon: MessageSquare, title: "Automated acknowledgement workflows" },
  { icon: Repeat2, title: "Follow-up sequences" },
  { icon: MessagesSquare, title: "Inbound customer conversations" },
  { icon: ClipboardList, title: "Lead status and management" },
  { icon: BellRing, title: "Reminder support" },
  { icon: CalendarClock, title: "Enquiry history and next actions" },
];

const SERVICE_IMAGES = [
  {
    src: exteriorImage,
    label: "Exterior detailing",
    alt: "Professional detailer applying wash foam to a sedan on a clean driveway with detailing tools nearby",
  },
  {
    src: coatingImage,
    label: "Paint correction & ceramic coating",
    alt: "Close-up of a gloved detailer applying ceramic coating to a glossy dark car panel",
  },
  {
    src: interiorImage,
    label: "Interior detailing",
    alt: "Detailer steam-cleaning and brushing the dashboard and console of a premium car interior",
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

const FAQS = [
  {
    q: "What is BookedSecure?",
    a: "BookedSecure helps detailing businesses respond to new enquiries and follow up consistently, so fewer potential jobs are forgotten.",
  },
  {
    q: "Who is it for?",
    a: "It's built for Australian mobile detailers, detailing studios, ceramic coating businesses, paint correction specialists and small teams managing customer enquiries.",
  },
  {
    q: "How does it help?",
    a: "It helps you acknowledge new enquiries, organise follow-ups, keep conversations visible and identify the next action.",
  },
  {
    q: "Does it replace personal replies?",
    a: "No. BookedSecure supports the follow-up process while the business remains in control of the conversation, quote and booking.",
  },
  {
    q: "Where do enquiries come from?",
    a: "BookedSecure is designed for enquiries from websites, quote forms, social media, Google, phone calls and referrals.",
  },
  {
    q: "Can it guarantee more bookings?",
    a: "No. It is designed to improve follow-up consistency, but outcomes depend on enquiries, offer, pricing, availability and customer demand.",
  },
  {
    q: "Who can join the pilot?",
    a: "Australian detailing businesses that receive regular customer enquiries and want to improve how they manage follow-up.",
  },
  {
    q: "How do I request early access?",
    a: "Submit the short form and we'll contact you about pilot availability.",
  },
];

function LandingPage() {
  const [submitted, setSubmitted] = useState(false);

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
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
            <a href="#benefits" className="hover:text-foreground">
              Benefits
            </a>
            <a href="#faqs" className="hover:text-foreground">
              FAQs
            </a>
          </nav>
          <a
            href="#pilot"
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Join the pilot
          </a>
        </div>
      </header>

      <main id="top" className="pb-28 sm:pb-0">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" /> Early-stage Australian detailing software
            </span>
            <h1 className="mt-5 text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">
              Turn more detailing enquiries into organised follow-up.
            </h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">
              BookedSecure is being built for Australian detailing businesses that want to respond
              faster, keep conversations moving and avoid losing potential jobs when follow-up gets
              missed. Join the early-access pilot.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a
                href="#pilot"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Join the BookedSecure pilot <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href="#workflow"
                className="inline-flex min-h-12 items-center justify-center rounded-md border border-input bg-background px-5 text-sm font-medium transition-colors hover:bg-secondary"
              >
                See how it works
              </a>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Early-stage platform. The live messaging provider setup is still being finalised, and
              examples shown here are simulated.
            </p>
          </div>
          <div className="-mx-4 lg:mx-0">
            <img
              src={heroImage}
              alt="Mobile detailer machine-polishing the paintwork of a dark SUV on a residential driveway"
              width={1600}
              height={1200}
              fetchPriority="high"
              decoding="async"
              className="aspect-[4/3] w-full object-cover object-[62%_center] sm:aspect-[16/10] sm:object-center lg:rounded-xl"
            />
            <ul className="mt-5 grid gap-y-2 px-4 text-sm text-muted-foreground sm:grid-cols-2 lg:px-0">
              {[
                "New enquiry received",
                "Acknowledgement prepared",
                "Follow-up scheduled",
                "Customer replies",
                "Lead moves towards booking",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Problem */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14">
            <h2 className="text-2xl font-semibold sm:text-3xl">
              The enquiry is valuable — but only if you keep the conversation moving.
            </h2>
            <p className="mt-4 text-sm text-muted-foreground sm:text-base">
              A potential customer might ask for a quote while you're polishing a vehicle, driving
              between jobs, working at a customer's home or closing up for the day. A quick response
              is hard. A second follow-up is even easier to forget.
            </p>
            <img
              src={enquiryImage}
              alt="Detailer in gloves checking a new customer enquiry on a smartphone beside a car between jobs"
              width={1600}
              height={1008}
              loading="lazy"
              decoding="async"
              className="-mx-4 mt-8 aspect-[4/3] w-[calc(100%+2rem)] object-cover object-[70%_center] sm:mx-0 sm:aspect-[16/9] sm:w-full sm:rounded-xl sm:object-center"
            />
            <ul className="mt-6 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              {[
                "They contact another detailer",
                "They forget they enquired at all",
                "They assume you're unavailable",
                "They stop replying before the quote lands",
              ].map((item) => (
                <li key={item} className="rounded-md border border-border bg-card px-3 py-2">
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm font-medium sm:text-base">
              BookedSecure is designed to help detailers build a more consistent response and
              follow-up process — without relying on memory alone.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold sm:text-3xl">A clearer path from enquiry to booking</h2>
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

        {/* Workflow */}
        <section id="workflow" className="border-y border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-14">
            <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
              Sample workflow · simulated example
            </span>
            <h2 className="mt-4 text-2xl font-semibold sm:text-3xl">From new enquiry to next action</h2>
            {/* Workflow illustration (not a product screenshot) */}
            <div
              className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-stretch"
              aria-hidden="true"
            >
              {[
                { icon: ClipboardList, label: "New enquiry" },
                { icon: Repeat2, label: "Follow-up" },
                { icon: CheckCircle2, label: "Next step" },
              ].map((node, i) => (
                <div key={node.label} className="flex items-center gap-3 sm:flex-1 sm:flex-col">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                    <node.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium">{node.label}</span>
                  {i < 2 ? (
                    <span className="ml-auto h-px w-10 bg-border sm:ml-0 sm:hidden" />
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-8 space-y-4">
              {WORKFLOW.map((item) => (
                <div key={item.label} className="panel p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <p
                    className={
                      item.side === "note"
                        ? "mt-2 text-sm text-muted-foreground"
                        : "mt-2 text-sm"
                    }
                  >
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Illustrative example only. Message content, timing and delivery depend on provider
              configuration and testing.
            </p>
          </div>
        </section>

        {/* Benefits */}
        <section id="benefits" className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="text-2xl font-semibold sm:text-3xl">Less chasing. More consistency.</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {BENEFITS.map((b) => (
              <div key={b.title} className="panel p-5">
                <p className="text-sm font-medium">{b.title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{b.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold sm:text-3xl">What's in the workflow</h2>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                  <f.icon className="h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm">{f.title}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Behind the scenes: a provider-agnostic messaging layer, a simulated messaging mode for
              early testing, and configurable workflow steps.
            </p>
          </div>
        </section>

        {/* Trust / pilot stage */}
        <section className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-semibold sm:text-3xl">Built carefully, with detailing businesses</h2>
          <div className="mt-5 space-y-4 text-sm text-muted-foreground sm:text-base">
            <p>
              BookedSecure is an early-stage platform being shaped with input from Australian
              detailing businesses. Glocast is the initial Sydney design partner, and the current
              environment is being used to test the workflow and product experience. Production SMS
              has not yet been sent through the pilot.
            </p>
            <p>
              The messaging provider partnership and live delivery setup are still being finalised.
              Early-access businesses will help validate the workflow before broader availability.
            </p>
          </div>
          <ul className="mt-6 grid gap-2 text-sm sm:grid-cols-2">
            {[
              "Designed specifically for detailing businesses",
              "Initial Sydney design partner: Glocast",
              "Simulated messaging environment currently active",
              "Provider-agnostic messaging layer",
            ].map((item) => (
              <li key={item} className="rounded-md border border-border bg-card px-3 py-2">
                {item}
              </li>
            ))}
          </ul>
        </section>

        {/* Who it's for */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-14">
            <h2 className="text-2xl font-semibold sm:text-3xl">Who BookedSecure is for</h2>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Australian detailing businesses receiving enquiries from websites, Facebook and
              Instagram, Google Business Profile, phone calls, quote forms and referrals.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {AUDIENCE.map((item) => (
                <div key={item} className="rounded-lg border border-border bg-card p-4 text-sm">
                  {item}
                </div>
              ))}
            </div>
            <div className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
              {SERVICE_IMAGES.map((img) => (
                <figure key={img.src} className="relative overflow-hidden rounded-lg">
                  <img
                    src={img.src}
                    alt={img.alt}
                    width={1200}
                    height={1200}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[16/9] w-full object-cover sm:aspect-[4/5]"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 to-transparent px-3 pb-3 pt-10 text-xs font-medium text-foreground">
                    {img.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </section>


        {/* FAQs */}
        <section id="faqs" className="mx-auto max-w-3xl px-4 py-14">
          <h2 className="text-2xl font-semibold sm:text-3xl">Questions detailers ask</h2>
          <Accordion type="single" collapsible className="mt-6">
            {FAQS.map((faq) => (
              <AccordionItem key={faq.q} value={faq.q}>
                <AccordionTrigger className="text-left text-sm">{faq.q}</AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground">{faq.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Final CTA + form */}
        <section id="pilot" className="border-t border-border bg-surface">
          <div className="mx-auto max-w-2xl px-4 py-14">
            <h2 className="text-2xl font-semibold sm:text-3xl">
              Want to help shape a better follow-up process for detailing businesses?
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Join the BookedSecure pilot to register your interest in early access. Joining the
              waitlist doesn't automatically grant live access.
            </p>

            {submitted ? (
              <div className="panel mt-8 p-5 text-sm">
                <p className="font-medium">Thanks for your interest.</p>
                <p className="mt-2 text-muted-foreground">
                  We'll review your details and be in touch about early access and the pilot process.
                </p>
              </div>
            ) : (
              <form
                className="panel mt-8 space-y-4 p-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSubmitted(true);
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Name" name="name" required />
                  <Field label="Business name" name="business" required />
                  <Field label="Email address" name="email" type="email" required />
                  <Field label="Mobile number" name="mobile" type="tel" required />
                  <Field label="Business location" name="location" required />
                  <Field
                    label="Approx. enquiries each week"
                    name="volume"
                    type="number"
                    required
                  />
                </div>
                <label className="block text-sm">
                  <span className="text-muted-foreground">What type of detailing work do you provide?</span>
                  <textarea
                    name="services"
                    rows={2}
                    className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-muted-foreground">What is your biggest follow-up challenge?</span>
                  <select
                    name="challenge"
                    className="mt-1.5 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                    defaultValue=""
                  >
                    <option value="">Select an option</option>
                    <option>I cannot respond quickly enough</option>
                    <option>I forget to follow up</option>
                    <option>Leads come from too many places</option>
                    <option>I lose track of conversations</option>
                    <option>I am not sure which enquiries are still active</option>
                    <option>Other</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Request early access
                </button>
              </form>
            )}
          </div>
        </section>

        <footer className="mx-auto max-w-4xl px-4 py-10 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">BookedSecure</p>
          <p className="mt-3">
            BookedSecure is currently in an early pilot stage. Messaging features, provider
            connectivity and availability may change during testing. Examples shown on this page are
            illustrative or simulated. BookedSecure does not guarantee message delivery, customer
            responses, bookings, revenue outcomes or legal compliance for a particular business.
            Businesses remain responsible for obtaining appropriate customer consent and using
            communications in accordance with applicable requirements.
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
      <input
        name={name}
        type={type}
        required={required}
        className="mt-1.5 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
