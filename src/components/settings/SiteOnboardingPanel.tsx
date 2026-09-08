import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyTenantSite, readTenantSite } from "@/lib/site-onboarding.functions";
import { WEEKDAY_LABELS } from "@/lib/availability";
import type { OnboardingProposal } from "@/lib/site-onboarding";

/**
 * Website-led setup. Reading the site only ever produces a proposal on screen;
 * nothing is saved until the owner presses the confirm button.
 */
export function SiteOnboardingPanel({ readOnly }: { readOnly: boolean }) {
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
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Set up from your website</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Enter your website address and we'll read your business name, area, phone, hours, services and
        prices from it. You'll see everything first and nothing is saved until you confirm.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
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
          className="sm:w-44"
        >
          {preview.isPending ? "Reading website…" : "Read my website"}
        </Button>
      </div>

      {readOnly && (
        <p className="mt-2 text-xs text-muted-foreground">Only the business owner can use this.</p>
      )}

      {proposal && (
        <div className="mt-4 space-y-3 rounded-md border border-border p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What we found
          </h3>

          <dl className="grid gap-2 sm:grid-cols-2">
            <Fact label="Business name" value={proposal.business.name} />
            <Fact label="Area served" value={proposal.business.service_area} />
            <Fact label="Phone" value={proposal.business.phone_number} />
            <Fact label="Opening hours" value={proposal.business.opening_hours} />
          </dl>

          <div>
            <p className="text-xs font-medium">Services ({proposal.services.length})</p>
            {proposal.services.length === 0 ? (
              <p className="text-xs text-muted-foreground">None found.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {proposal.services.map((service) => (
                  <li key={service.name} className="text-xs">
                    <span className="font-medium">{service.name}</span>
                    {service.price_guidance ? ` — ${service.price_guidance}` : " — no price listed"}
                    <span className="text-muted-foreground"> · {service.duration_minutes} min</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="text-xs font-medium">Bookable times ({proposal.weeklyWindows.length})</p>
            {proposal.weeklyWindows.length === 0 ? (
              <p className="text-xs text-muted-foreground">None could be read from your hours.</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                {proposal.weeklyWindows
                  .map((window) => `${WEEKDAY_LABELS[window.weekday]} ${window.start}–${window.end}`)
                  .join(" · ")}
              </p>
            )}
          </div>

          {proposal.logoUrl && (
            <div className="flex items-center gap-2">
              <img
                src={proposal.logoUrl}
                alt="Logo found on your website"
                className="h-10 w-10 rounded-md bg-secondary object-contain"
              />
              <span className="text-xs text-muted-foreground">Logo found on your site</span>
            </div>
          )}

          {proposal.warnings.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
              {proposal.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => apply.mutate()}
              disabled={readOnly || apply.isPending}
            >
              {apply.isPending ? "Saving…" : "Use these details"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setProposal(null)}
              disabled={apply.isPending}
            >
              Discard
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Existing services are kept as they are, and your owner alert number is never changed here.
          </p>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-border p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{value ?? "Not found"}</dd>
    </div>
  );
}
