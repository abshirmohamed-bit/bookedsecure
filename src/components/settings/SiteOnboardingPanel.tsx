import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { applyTenantSite, readTenantSite } from "@/lib/site-onboarding.functions";
import { WEEKDAY_LABELS } from "@/lib/availability";
import { formatMinutes, groupItems } from "@/lib/service-groups";
import type { OnboardingProposal } from "@/lib/site-onboarding";

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

  const newServices = proposal?.services.filter((service) => !service.alreadyHave) ?? [];
  const newAddons = proposal?.addons.filter((addon) => !addon.alreadyHave) ?? [];
  const serviceGroups = groupItems(newServices, (service) => service.category);

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

      {readOnly && (
        <p className="mt-2 text-xs text-muted-foreground">Only the business owner can set this up.</p>
      )}

      {proposal && (
        <div className="mt-5 rounded-xl border border-border bg-background p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">{proposal.business.name ?? "Your website"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {newServices.length} service{newServices.length === 1 ? "" : "s"} to add
                {proposal.addons.length > 0
                  ? ` · ${proposal.addons.filter((a) => !a.alreadyHave).length} extra${proposal.addons.filter((a) => !a.alreadyHave).length === 1 ? "" : "s"}`
                  : ""}
                {proposal.weeklyWindows.length > 0 ? ` · ${proposal.weeklyWindows.length} time windows` : ""}
              </p>
            </div>
            {proposal.logoUrl && (
              <img
                src={proposal.logoUrl}
                alt=""
                className="h-10 w-10 rounded-md bg-secondary object-contain"
              />
            )}
          </div>

          {newServices.length > 0 && (
            <div className="mt-4 space-y-3">
              {serviceGroups.map((group) => (
                <details
                  key={group.label}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs font-semibold">
                    <span className="min-w-0 truncate">{group.label}</span>
                    <span className="shrink-0 text-[0.7rem] font-normal text-muted-foreground">
                      {group.items.length}
                    </span>
                  </summary>
                  <div className="grid gap-2 border-t border-border p-2 sm:grid-cols-2">
                    {group.items.map((service) => (
                      <div
                        key={service.name}
                        className="min-w-0 rounded-lg border border-border bg-background p-2.5"
                      >
                        {service.image_url && (
                          <img
                            src={service.image_url}
                            alt=""
                            loading="lazy"
                            className="mb-1.5 h-14 w-full rounded-md bg-secondary object-cover"
                          />
                        )}
                        <p className="truncate text-xs font-semibold">{service.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.7rem]">
                          {service.price_guidance && (
                            <span className="font-semibold text-primary">
                              {service.price_guidance}
                            </span>
                          )}
                          {formatMinutes(service.duration_minutes) && (
                            <span className="text-muted-foreground">
                              {formatMinutes(service.duration_minutes)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ))}


              {newAddons.length > 0 && (
                <div>
                  <h4 className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    Optional extras · {newAddons.length}
                  </h4>
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {newAddons.map((addon) => (
                      <li
                        key={addon.name}
                        className="rounded-full bg-secondary px-2.5 py-1 text-[0.7rem] text-secondary-foreground"
                      >
                        {addon.name}
                        {addon.price_guidance ? ` · ${addon.price_guidance}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {proposal.warnings.length > 0 && (
            <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {proposal.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => apply.mutate()}
              disabled={readOnly || apply.isPending}
            >
              {apply.isPending ? "Saving…" : "Looks good. save it"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setProposal(null);
                setUrl("");
              }}
              disabled={apply.isPending}
            >
              Try another site
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
