import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { getPublicQuoteForm, submitQuoteRequest } from "@/lib/public.functions";
import { VEHICLE_TYPES, normaliseAuMobile } from "@/lib/domain";
import { TenantMark } from "@/components/TenantMark";
import { AiQuoteChat } from "@/components/AiQuoteChat";
import {
  DUPLICATE_LEAD_CLIENT_MESSAGE,
  classifyQuoteResult,
  quoteErrorMessage,
} from "@/lib/quote-duplicate";
import {
  FLEXIBLE_SERVICE_VALUE,
  REQUEST_TYPES,
  REQUEST_TYPE_HELP,
  REQUEST_TYPE_LABELS,
  createSubmissionNonce,
  type RequestType,
} from "@/lib/quote-form";

export const Route = createFileRoute("/quote/$slug")({
  loader: async ({ params }) => {
    const tenant = await getPublicQuoteForm({ data: { slug: params.slug } });
    if (!tenant) throw notFound();
    return tenant;
  },
  head: ({ loaderData }) => {
    const business = loaderData?.name;
    if (!business) {
      return {
        meta: [{ title: "Enquiry form unavailable" }, { name: "robots", content: "noindex" }],
      };
    }
    const title = `Get a mobile detailing quote — ${business}`;
    const description = `Tell ${business} about your vehicle and get a fast SMS response with the right detailing option.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  errorComponent: () => (
    <FormShell>
      <h1 className="text-lg font-semibold">We couldn't load this enquiry form</h1>
      <p className="mt-2 text-sm text-muted-foreground">Please refresh the page and try again.</p>
    </FormShell>
  ),
  notFoundComponent: () => (
    <FormShell>
      <h1 className="text-lg font-semibold">Enquiry form not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This link doesn't match an active business. Please check the link you were given.
      </p>
    </FormShell>
  ),
  component: TenantQuotePage,
});

const STEPS = ["Request", "Vehicle", "Condition", "Contact"] as const;

function TenantQuotePage() {
  const tenant = Route.useLoaderData();
  // Mode is resolved server-side; anything other than ai_chat renders the
  // unchanged manual quote form.
  if (tenant.quoteMode === "ai_chat") {
    return (
      <AiQuoteChat
        tenant={{
          slug: tenant.slug,
          name: tenant.name,
          logoUrl: tenant.logoUrl,
          serviceArea: tenant.serviceArea,
          privacyPolicyUrl: tenant.privacyPolicyUrl,
        }}
      />
    );
  }
  return <ManualQuoteForm />;
}

function ManualQuoteForm() {
  const tenant = Route.useLoaderData();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  // One nonce per form session: retries of this submission reuse the same lead.
  const [nonce, setNonce] = useState(() => createSubmissionNonce());
  const [form, setForm] = useState({
    request_type: "" as RequestType | "",
    service_choice: "",
    flexible_request_text: "",
    vehicle_type: "",
    suburb: "",
    service_address: "",
    last_cleaned_at: "",
    main_concerns: "",
    name: "",
    mobile_number: "",
    email: "",
    consent: false,
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const isFlexible =
    form.request_type === "recommendation" || form.service_choice === FLEXIBLE_SERVICE_VALUE;
  const selectedService = tenant.services.find((service) => service.id === form.service_choice);

  const stepValid = useMemo(() => {
    if (step === 0) {
      if (!form.request_type) return false;
      if (form.request_type === "recommendation")
        return form.flexible_request_text.trim().length > 1;
      if (!form.service_choice) return false;
      if (form.service_choice === FLEXIBLE_SERVICE_VALUE)
        return tenant.flexibleRequestsEnabled && form.flexible_request_text.trim().length > 1;
      return true;
    }
    if (step === 1)
      return (
        form.vehicle_type.length > 1 &&
        form.suburb.length > 1 &&
        form.service_address.trim().length > 3
      );
    if (step === 2) return form.main_concerns.trim().length > 1;
    return form.name.length > 1 && normaliseAuMobile(form.mobile_number) !== null && form.consent;
  }, [step, form, tenant.flexibleRequestsEnabled]);

  async function submit() {
    setBusy(true);
    setError(null);
    setDuplicate(false);
    try {
      const search = new URLSearchParams(window.location.search);
      const params: Record<string, string> = {};
      search.forEach((value, key) => {
        params[key] = value;
      });
      const result = await submitQuoteRequest({
        data: {
          slug: tenant.slug,
          company: honeypot,
          submission_nonce: nonce,
          form_url: `${window.location.origin}${window.location.pathname}`,
          referrer: document.referrer || null,
          params,
          name: form.name,
          mobile_number: form.mobile_number,
          email: form.email || null,
          suburb: form.suburb,
          service_address: form.service_address.trim() || null,
          vehicle_type: form.vehicle_type,
          last_cleaned_at: form.last_cleaned_at || null,
          main_concerns: form.main_concerns,
          request_type: form.request_type as RequestType,
          approved_service_id: isFlexible ? null : form.service_choice || null,
          flexible_request_text: isFlexible ? form.flexible_request_text : null,
          consent: true,
        },
      });
      const outcome = classifyQuoteResult(result);
      if (outcome !== "success") {
        // Duplicate and ordinary failures are both non-success, but they are
        // reported differently and neither is retried automatically.
        setDuplicate(outcome === "duplicate");
        setError(quoteErrorMessage(result));
        // A failed submission keeps the same nonce so a retry cannot create a second lead.
        return;
      }
      setNonce(createSubmissionNonce());
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again or call us.");
    } finally {
      setBusy(false);
    }
  }

  if (duplicate) {
    return (
      <FormShell>
        <div className="text-center" role="alert">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold">We already have this enquiry</h1>
          <p className="mt-2 text-sm text-muted-foreground">{DUPLICATE_LEAD_CLIENT_MESSAGE}</p>
          <div className="mt-6 flex flex-col gap-2">
            <button
              onClick={() => {
                setDuplicate(false);
                setError(null);
                setStep(0);
              }}
              className="rounded-md border border-input px-3 py-2 text-sm font-medium"
            >
              Back to the form
            </button>
          </div>
        </div>
      </FormShell>
    );
  }

  if (done) {
    return (
      <FormShell>
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-4 text-xl font-semibold">
            Thanks {form.name.split(" ")[0]} — we've got it
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isFlexible
              ? `${tenant.name} will review your request personally and get back to you.`
              : `You'll hear from ${tenant.name} shortly. Reply to that message and we'll sort out the right detail for your vehicle.`}
          </p>
        </div>
      </FormShell>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:py-10">
      <div className="mx-auto max-w-lg">
        <header className="brand-wash mb-4 rounded-lg border border-border p-4">
          <div className="flex items-center gap-3">
            <TenantMark name={tenant.name} logoUrl={tenant.logoUrl} />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{tenant.name}</h1>
              <p className="text-xs text-muted-foreground">
                {tenant.serviceArea ?? "Mobile detailing"} — fast SMS response
              </p>
            </div>
          </div>
        </header>

        <div className="panel overflow-hidden p-4 sm:p-6">
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
              <Field label="What can we help with?">
                <select
                  value={form.request_type}
                  onChange={(event) => {
                    set("request_type", event.target.value as RequestType);
                    set("service_choice", "");
                  }}
                  className="form-control"
                >
                  <option value="">Select an option</option>
                  {REQUEST_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {REQUEST_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
                {form.request_type && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {REQUEST_TYPE_HELP[form.request_type]}
                  </p>
                )}
              </Field>

              {form.request_type && form.request_type !== "recommendation" && (
                <Field label="Which service are you after?">
                  <select
                    value={form.service_choice}
                    onChange={(event) => set("service_choice", event.target.value)}
                    className="form-control"
                  >
                    <option value="">Select a service</option>
                    {tenant.services.map((service) => (
                      <option key={service.id} value={service.id}>
                        {service.name}
                      </option>
                    ))}
                    {tenant.flexibleRequestsEnabled && (
                      <option value={FLEXIBLE_SERVICE_VALUE}>Something else or not sure</option>
                    )}
                  </select>
                  {selectedService?.description && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedService.description}
                    </p>
                  )}
                  {selectedService?.qualification_note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Note: {selectedService.qualification_note}
                    </p>
                  )}
                </Field>
              )}

              {isFlexible && form.request_type && (
                <Field label="Tell us what you're after">
                  <textarea
                    value={form.flexible_request_text}
                    onChange={(event) => set("flexible_request_text", event.target.value)}
                    rows={3}
                    placeholder="Describe what you need and we'll come back to you personally."
                    className="form-control min-h-24 py-2"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    A person reviews these requests before any reply is sent.
                  </p>
                </Field>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <Field label="What type of vehicle is it?">
                <select
                  value={form.vehicle_type}
                  onChange={(event) => set("vehicle_type", event.target.value)}
                  className="form-control"
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
                  className="form-control"
                />
              </Field>
              <Field label="What's the street address we should come to?">
                <input
                  value={form.service_address}
                  onChange={(event) => set("service_address", event.target.value)}
                  placeholder="e.g. 12 Smith St"
                  className="form-control"
                />
              </Field>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="When was it last professionally or thoroughly cleaned?">
                <select
                  value={form.last_cleaned_at}
                  onChange={(event) => set("last_cleaned_at", event.target.value)}
                  className="form-control"
                >
                  <option value="">Select</option>
                  {[
                    "Within the last month",
                    "1-3 months ago",
                    "3-12 months ago",
                    "Over a year ago",
                    "Never / not sure",
                  ].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="What are your main concerns?">
                <textarea
                  value={form.main_concerns}
                  onChange={(event) => set("main_concerns", event.target.value)}
                  rows={3}
                  placeholder="Interior, exterior, stains, odour, paint, pet hair, something else…"
                  className="form-control min-h-24 py-2"
                />
              </Field>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <Field label="Your name">
                <input
                  value={form.name}
                  onChange={(event) => set("name", event.target.value)}
                  className="form-control"
                />
              </Field>
              <Field label="Mobile number">
                <input
                  value={form.mobile_number}
                  onChange={(event) => set("mobile_number", event.target.value)}
                  placeholder="04XX XXX XXX"
                  inputMode="tel"
                  className="form-control"
                />
                {form.mobile_number.length > 5 &&
                  normaliseAuMobile(form.mobile_number) === null && (
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
                  className="form-control"
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
                  I agree to {tenant.name} contacting me by SMS about this enquiry. Reply STOP at
                  any time to opt out. See our{" "}
                  <a
                    href={tenant.privacyPolicyUrl ?? "/privacy"}
                    className="text-primary underline"
                  >
                    privacy policy
                  </a>
                  .
                </span>
              </label>
            </div>
          )}

          <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
            <label>
              Company
              <input
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(event) => setHoneypot(event.target.value)}
              />
            </label>
          </div>

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
              onClick={() => (step === STEPS.length - 1 ? submit() : setStep(step + 1))}
              className="flex-1 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {step === STEPS.length - 1 ? (busy ? "Sending…" : "Send my enquiry") : "Continue"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Tenant logo with a safe fallback: no configured logo, or an image that fails
 * to load at runtime, degrades to the tenant's initial badge.
 */
function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md panel p-8">{children}</div>
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
