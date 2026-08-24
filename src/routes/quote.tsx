import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { submitQuoteRequest } from "@/lib/public.functions";
import { VEHICLE_TYPES, normaliseAuMobile } from "@/lib/domain";

export const Route = createFileRoute("/quote")({
  head: () => ({
    meta: [
      { title: "Get a mobile detailing quote — Glocast Sydney" },
      {
        name: "description",
        content:
          "Tell Glocast about your vehicle and we'll text you back fast with the right mobile detailing option for Sydney.",
      },
      { property: "og:title", content: "Get a mobile detailing quote — Glocast Sydney" },
      {
        property: "og:description",
        content: "Answer five quick questions and the Glocast team will text you back.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: QuotePage,
});

const STEPS = ["Vehicle", "Condition", "Contact"] as const;

function QuotePage() {
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    vehicle_type: "",
    suburb: "",
    last_cleaned_at: "",
    main_concerns: "",
    service_intent: "",
    name: "",
    mobile_number: "",
    email: "",
    consent: false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const stepValid =
    step === 0
      ? form.vehicle_type.length > 1 && form.suburb.length > 1
      : step === 1
        ? form.main_concerns.length > 1 && form.service_intent.length > 1
        : form.name.length > 1 && normaliseAuMobile(form.mobile_number) !== null && form.consent;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const params = new URLSearchParams(window.location.search);
      await submitQuoteRequest({
        data: {
          name: form.name,
          mobile_number: form.mobile_number,
          email: form.email || null,
          suburb: form.suburb,
          vehicle_type: form.vehicle_type,
          last_cleaned_at: form.last_cleaned_at || null,
          main_concerns: form.main_concerns,
          service_intent: form.service_intent,
          consent: true,
          source_channel: params.get("source") === "meta" ? "meta" : "hosted_page",
          source_form: params.get("form") ?? "hosted_quote_page",
          utm_source: params.get("utm_source"),
          utm_campaign: params.get("utm_campaign"),
        },
      });
      setDone(true);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Something went wrong. Please try again or call us.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-md panel p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">Thanks {form.name.split(" ")[0]} — we've got it</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You'll get a text from Glocast shortly. Reply to that message and we'll sort out the right
            detail for your vehicle.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10">
      <div className="mx-auto max-w-md">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              G
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">Glocast mobile detailing</h1>
              <p className="text-xs text-muted-foreground">Sydney metro — fast SMS response</p>
            </div>
          </div>
        </header>

        <div className="panel p-6">
          <div className="mb-5 flex items-center gap-2">
            {STEPS.map((label, index) => (
              <div key={label} className="flex-1">
                <div
                  className={`h-1 rounded-full ${index <= step ? "bg-primary" : "bg-secondary"}`}
                  aria-hidden
                />
                <p
                  className={`mt-1.5 text-[11px] ${index === step ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {label}
                </p>
              </div>
            ))}
          </div>

          {step === 0 && (
            <div className="space-y-4">
              <Field label="What type of vehicle is it?">
                <select
                  value={form.vehicle_type}
                  onChange={(event) => set("vehicle_type", event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select vehicle type</option>
                  {VEHICLE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Which suburb is the vehicle in?">
                <input
                  value={form.suburb}
                  onChange={(event) => set("suburb", event.target.value)}
                  placeholder="e.g. Marrickville"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Field label="When was it last professionally or thoroughly cleaned?">
                <select
                  value={form.last_cleaned_at}
                  onChange={(event) => set("last_cleaned_at", event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  {["Within the last month", "1-3 months ago", "3-12 months ago", "Over a year ago", "Never / not sure"].map(
                    (option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <Field label="What are your main concerns?">
                <textarea
                  value={form.main_concerns}
                  onChange={(event) => set("main_concerns", event.target.value)}
                  rows={3}
                  placeholder="Interior, exterior, stains, odour, paint, pet hair, something else…"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="What are you after?">
                <select
                  value={form.service_intent}
                  onChange={(event) => set("service_intent", event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select</option>
                  {["A quote", "A recommendation", "Arrange a service"].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="Your name">
                <input
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
              <Field label="Mobile number">
                <input
                  value={form.mobile_number}
                  onChange={(event) => set("mobile_number", event.target.value)}
                  placeholder="04XX XXX XXX"
                  inputMode="tel"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {form.mobile_number.length > 5 && normaliseAuMobile(form.mobile_number) === null && (
                  <p className="mt-1 text-xs text-destructive">
                    Please enter a valid Australian mobile number.
                  </p>
                )}
              </Field>
              <Field label="Email (optional)">
                <input
                  type="email"
                  value={form.email}
                  onChange={(event) => set("email", event.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
              <label className="flex gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={form.consent}
                  onChange={(event) => set("consent", event.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                />
                <span>
                  I agree to Glocast contacting me by SMS about this enquiry. Reply STOP at any time to
                  opt out. See our{" "}
                  <a href="/privacy" className="text-primary underline">
                    privacy policy
                  </a>
                  .
                </span>
              </label>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

          <div className="mt-6 flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="rounded-md border border-input px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                Back
              </button>
            )}
            <button
              disabled={!stepValid || busy}
              onClick={() => (step === 2 ? submit() : setStep(step + 1))}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {step === 2 ? (busy ? "Sending…" : "Send my enquiry") : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block text-foreground">{label}</span>
      {children}
    </label>
  );
}
