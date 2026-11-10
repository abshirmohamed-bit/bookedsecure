import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, Building2, ChevronDown, Clock, Globe, HelpCircle, Mail, MapPin, MessageSquareText, Phone, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { applyTenantSite, readTenantSite } from "@/lib/site-onboarding.functions";
import { formatMinutes, groupItems } from "@/lib/service-groups";
import type { OnboardingProposal, ProposedService } from "@/lib/site-onboarding";
import { BUSINESS_MODEL_LABELS, EMPTY_PROFILE, previewSections } from "@/lib/business-profile";

/** "A$700/mo" → { amount: "A$700", period: "/mo" }, so plan prices read like a pricing table. */
function splitPrice(price: string): { amount: string; period: string | null } {
  const match = /^(.*?\d[\d,.]*)\s*((?:\/|per\s).*)$/i.exec(price.trim());
  return match ? { amount: match[1]!.trim(), period: match[2]!.trim() } : { amount: price, period: null };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Website-led setup. Reading the site only ever produces a proposal on screen;
 * nothing is saved until the owner presses the confirm button.
 */
export function SiteOnboardingPanel({
  readOnly,
  onApplied,
}: {
  readOnly: boolean;
  onApplied?: () => void;
}) {
  const readSite = useServerFn(readTenantSite);
  const applySite = useServerFn(applyTenantSite);
  const queryClient = useQueryClient();

  const [url, setUrl] = useState("");
  const [proposal, setProposal] = useState<OnboardingProposal | null>(null);

  const preview = useMutation({
    mutationFn: () => readSite({ data: { url: url.trim() } }),
    onSuccess: (result) => setProposal(result as OnboardingProposal),
    onError: (error: Error) => toast.error(error.message),
  });

  const apply = useMutation({
    mutationFn: () => applySite({ data: proposal! }),
    onSuccess: (result) => {
      setProposal(null);
      setUrl("");
      toast.success(
        `Saved. ${result.servicesAdded} service(s) added${result.logoSaved ? ", logo copied across" : ""}.`,
      );
      for (const note of result.notes) toast.message(note);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant-account"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["setup-state"] });
      onApplied?.();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <label htmlFor="website-url" className="text-sm font-semibold">
        Your website
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        We read your site, then show you what we found before saving anything.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          id="website-url"
          value={url}
          disabled={readOnly || preview.isPending}
          placeholder="yourbusiness.com.au"
          onChange={(event) => setUrl(event.target.value)}
          aria-label="Your website address"
        />
        <Button
          type="button"
          onClick={() => preview.mutate()}
          disabled={readOnly || preview.isPending || url.trim().length < 4}
          className="sm:w-40"
        >
          {preview.isPending ? "Reading…" : "Read my site"}
        </Button>
      </div>
      {preview.isPending && (
        <p className="mt-2 text-xs text-muted-foreground">Reading every page of your site. This can take up to a minute.</p>
      )}

      {readOnly && (
        <p className="mt-2 text-xs text-muted-foreground">Only the business owner can set this up.</p>
      )}

      {proposal && (
        <ProposalPreview
          proposal={proposal}
          saving={apply.isPending}
          readOnly={readOnly}
          onSave={() => apply.mutate()}
          onReset={() => {
            setProposal(null);
            setUrl("");
          }}
        />
      )}
    </section>
  );
}

/**
 * What saving will do, laid out side by side: the business details and the
 * save button on the left, what the business sells on the right (plans as a
 * pricing row, services as compact cards, extras as chips).
 */
export function ProposalPreview({
  proposal,
  saving,
  readOnly,
  onSave,
  onReset,
}: {
  proposal: OnboardingProposal;
  saving: boolean;
  readOnly: boolean;
  onSave: () => void;
  onReset: () => void;
}) {
  const newServices = proposal.services.filter((service) => !service.alreadyHave);
  const already = proposal.services.length - newServices.length;
  const newAddons = proposal.addons.filter((addon) => !addon.alreadyHave);
  const plans = newServices.filter((service) => service.billing === "recurring");
  const others = newServices.filter((service) => service.billing !== "recurring");
  const groups = useMemo(() => groupItems(others, (service) => service.category), [others]);
  const [active, setActive] = useState<string>("all");
  const visibleGroups = active === "all" ? groups : groups.filter((group) => group.label === active);
  const othersLabel = groups.length === 1 && groups[0]!.label === "Other" ? "Services" : null;
  const profile = proposal.profile ?? EMPTY_PROFILE;
  const sections = previewSections(profile, { addons: newAddons.length, plans: plans.length });
  const [allFaqs, setAllFaqs] = useState(false);
  const faqs = allFaqs ? profile.faqs : profile.faqs.slice(0, 4);

  const counts = [
    plans.length ? `${plans.length} plan${plans.length === 1 ? "" : "s"}` : null,
    others.length ? `${others.length} service${others.length === 1 ? "" : "s"}` : null,
    sections.extras && newAddons.length ? `${newAddons.length} extra${newAddons.length === 1 ? "" : "s"}` : null,
    profile.faqs.length ? `${profile.faqs.length} FAQ${profile.faqs.length === 1 ? "" : "s"}` : null,
    sections.hours && proposal.weeklyWindows.length ? `${proposal.weeklyWindows.length} time windows` : null,
  ].filter(Boolean);

  return (
    <div data-proposal className="@container mt-5 rounded-2xl border border-border bg-background/60 p-3 sm:p-4">
    <div className="grid gap-4 @3xl:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Left: who the business is, what's missing, and the save button. */}
      <aside className="space-y-3 @3xl:sticky @3xl:top-6 @3xl:self-start">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          {proposal.logoUrl ? (
            <img src={proposal.logoUrl} alt="" className="size-11 shrink-0 rounded-lg bg-secondary object-contain" />
          ) : (
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
              <Building2 className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{proposal.business.name ?? "Your business"}</p>
            <p className="flex items-center gap-1 truncate text-[0.7rem] text-muted-foreground">
              <Globe className="size-3 shrink-0" /> {hostOf(proposal.sourceUrl)}
            </p>
          </div>
        </div>
        {(profile.industry || profile.model) && (
          <div className="flex flex-wrap gap-1.5">
            {profile.industry && <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[0.7rem] font-medium text-primary">{profile.industry}</span>}
            <span className="rounded-full border border-border bg-card px-2.5 py-1 text-[0.7rem] text-muted-foreground">{BUSINESS_MODEL_LABELS[profile.model]}</span>
          </div>
        )}

        <dl className="space-y-1.5 rounded-xl border border-border bg-card p-3 text-xs">
          <Detail icon={<MapPin className="size-3.5" />} label="Area" value={proposal.business.service_area} />
          <Detail icon={<Phone className="size-3.5" />} label="Phone" value={proposal.business.phone_number} />
          {sections.hours && <Detail icon={<Clock className="size-3.5" />} label="Hours" value={proposal.business.opening_hours} />}
          {(profile.contactEmail || !sections.hours) && <Detail icon={<Mail className="size-3.5" />} label="Email" value={profile.contactEmail} />}
        </dl>

        {profile.enquirySubject && (
          <div className="rounded-xl border border-border bg-card p-3 text-xs">
            <p className="flex items-center gap-1.5 font-medium"><MessageSquareText className="size-3.5 text-primary" /> Your quote page will ask about</p>
            <p className="mt-1 font-semibold">{profile.enquirySubject.label}</p>
            {profile.enquirySubject.options.length > 0 && (
              <p className="mt-0.5 text-[0.7rem] leading-snug text-muted-foreground">{profile.enquirySubject.options.join(" · ")}</p>
            )}
            <p className="mt-1 text-[0.65rem] text-muted-foreground">Only used if you haven't set this yourself. You can change it any time.</p>
          </div>
        )}

        {proposal.warnings.length > 0 && (
          <ul className="space-y-1.5 rounded-xl border border-warning/30 bg-warning/10 p-3 text-[0.7rem] text-foreground/80">
            {proposal.warnings.map((warning) => (
              <li key={warning} className="flex gap-1.5">
                <AlertTriangle className="mt-px size-3 shrink-0 text-warning" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 max-@3xl:sticky max-@3xl:bottom-2 max-@3xl:z-10 max-@3xl:rounded-xl max-@3xl:border max-@3xl:border-border max-@3xl:bg-card/90 max-@3xl:p-2 max-@3xl:backdrop-blur-xl">
          <Button type="button" onClick={onSave} disabled={readOnly || saving}>
            {saving ? "Saving…" : "Looks good. save it"}
          </Button>
          <Button type="button" variant="outline" onClick={onReset} disabled={saving}>
            Try another site
          </Button>
          <p className="text-center text-[0.7rem] text-muted-foreground">
            {counts.length ? counts.join(" · ") : "Nothing new to add"}
            {already > 0 ? ` · ${already} you already have` : ""}
          </p>
        </div>
      </aside>

      {/* Right: about the business, then what it sells, then what customers ask. */}
      <div className="@container/items min-w-0 space-y-4">
        {(profile.summary || profile.audience) && (
          <section aria-label="About" className="rounded-xl border border-border bg-card p-3">
            <h4 className="mb-1 text-xs font-semibold">About</h4>
            {profile.summary && <p className="text-xs leading-relaxed text-foreground/85">{profile.summary}</p>}
            {profile.audience && <p className="mt-1.5 text-[0.7rem] text-muted-foreground"><span className="font-medium text-foreground/70">Who it's for:</span> {profile.audience}</p>}
          </section>
        )}

        {newServices.length === 0 && (!sections.extras || newAddons.length === 0) && (
          <div className="grid h-full min-h-40 place-items-center rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No new services or prices were found. You can add them yourself after saving.
          </div>
        )}

        {plans.length > 0 && (
          <section aria-label="Plans">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Sparkles className="size-3.5 text-primary" /> {sections.offeringsTitle === "Plans and pricing" ? "Plans and pricing" : "Plans"}
            </h4>
            <div className="grid gap-2 @md/items:grid-cols-2 @2xl/items:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard key={plan.name} plan={plan} />
              ))}
            </div>
          </section>
        )}

        {others.length > 0 && (
          <section aria-label="Services">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <h4 className="mr-1 text-xs font-semibold">{othersLabel ?? "Services"}</h4>
              {groups.length > 1 && (
                <>
                  <Chip on={active === "all"} onClick={() => setActive("all")}>
                    All · {others.length}
                  </Chip>
                  {groups.map((group) => (
                    <Chip key={group.label} on={active === group.label} onClick={() => setActive(group.label)}>
                      {group.label} · {group.items.length}
                    </Chip>
                  ))}
                </>
              )}
            </div>
            <div className="space-y-3">
              {visibleGroups.map((group) => (
                <div key={group.label}>
                  {groups.length > 1 && active === "all" && (
                    <p className="mb-1.5 text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground">{group.label}</p>
                  )}
                  <div className="grid gap-2 @md/items:grid-cols-2 @2xl/items:grid-cols-3">
                    {group.items.map((service) => (
                      <ServiceCard key={service.name} service={service} showLength={sections.durations} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {(profile.highlights.length > 0 || profile.policies.length > 0) && (
          <div className="grid gap-3 @2xl/items:grid-cols-2">
            {profile.highlights.length > 0 && (
              <section aria-label="Key features" className="rounded-xl border border-border bg-card p-3">
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><BadgeCheck className="size-3.5 text-primary" /> Key features</h4>
                <ul className="space-y-1 text-[0.7rem] leading-snug text-foreground/85">
                  {profile.highlights.map((item) => (
                    <li key={item} className="flex gap-1.5"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />{item}</li>
                  ))}
                </ul>
              </section>
            )}
            {profile.policies.length > 0 && (
              <section aria-label="Terms" className="rounded-xl border border-border bg-card p-3">
                <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold"><ShieldCheck className="size-3.5 text-primary" /> Trial and terms</h4>
                <ul className="space-y-1 text-[0.7rem] leading-snug text-foreground/85">
                  {profile.policies.map((item) => (
                    <li key={item} className="flex gap-1.5"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-primary" />{item}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {profile.faqs.length > 0 && (
          <section aria-label="Questions customers ask" className="rounded-xl border border-border bg-card p-3">
            <h4 className="mb-1 flex items-center gap-1.5 text-xs font-semibold"><HelpCircle className="size-3.5 text-primary" /> Questions customers ask</h4>
            <p className="mb-2 text-[0.65rem] text-muted-foreground">Your AI chat answers from these.</p>
            <div className="divide-y divide-border">
              {faqs.map((faq) => (
                <details key={faq.question} className="group py-1.5">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-2 text-[0.75rem] font-medium [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">{faq.answer}</p>
                </details>
              ))}
            </div>
            {profile.faqs.length > 4 && (
              <button type="button" onClick={() => setAllFaqs((v) => !v)} className="mt-1 text-[0.7rem] font-medium text-primary hover:underline">
                {allFaqs ? "Show fewer" : `Show all ${profile.faqs.length}`}
              </button>
            )}
          </section>
        )}

        {sections.extras && newAddons.length > 0 && (
          <section aria-label="Optional extras">
            <h4 className="mb-2 text-xs font-semibold">Optional extras</h4>
            <ul className="flex flex-wrap gap-1.5">
              {newAddons.map((addon) => (
                <li key={addon.name} className="rounded-full border border-border bg-card px-2.5 py-1 text-[0.7rem]">
                  {addon.name}
                  {addon.price_guidance ? <span className="ml-1 font-semibold text-primary">{addon.price_guidance}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
    </div>
  );
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <dt className="w-11 shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 break-words", !value && "text-muted-foreground/70")}>{value ?? "Not on the site"}</dd>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[0.7rem] transition-colors",
        on ? "border-primary/40 bg-primary/10 font-medium text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function PlanCard({ plan }: { plan: ProposedService }) {
  const price = plan.price_guidance ? splitPrice(plan.price_guidance) : null;
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-3">
      <p className="truncate text-sm font-semibold">{plan.name}</p>
      {price ? (
        <p className="mt-1 flex items-baseline gap-1">
          <span className="text-xl font-semibold tracking-tight text-primary">{price.amount}</span>
          {price.period && <span className="text-xs text-muted-foreground">{price.period}</span>}
        </p>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">No price on the site</p>
      )}
      {plan.description && <p className="mt-1.5 line-clamp-3 text-[0.7rem] leading-snug text-muted-foreground">{plan.description}</p>}
    </div>
  );
}

function ServiceCard({ service, showLength }: { service: ProposedService; showLength: boolean }) {
  const length = showLength && service.duration_stated !== false ? formatMinutes(service.duration_minutes) : null;
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-card p-2.5">
      {service.image_url && (
        <img
          src={service.image_url}
          alt=""
          loading="lazy"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          className="size-14 shrink-0 rounded-lg bg-secondary object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-xs font-semibold leading-snug">{service.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.7rem]">
          {service.price_guidance ? (
            <span className="font-semibold text-primary">{service.price_guidance}</span>
          ) : (
            <span className="text-muted-foreground">No price listed</span>
          )}
          {length && <span className="text-muted-foreground">{length}</span>}
        </div>
        {service.description && <p className="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-muted-foreground">{service.description}</p>}
      </div>
    </div>
  );
}
