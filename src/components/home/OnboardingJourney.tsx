import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, ListChecks, Lock } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { onboardingProgressLabel } from "@/lib/onboarding";
import { getOnboardingProgress } from "@/lib/onboarding.functions";
import { cn } from "@/lib/utils";

/**
 * A compact, honest "what's left to do" strip. Every tick comes from real saved
 * state, so it is the same on any device and never claims progress the business
 * has not made. Hidden entirely once the journey is finished.
 */
export function OnboardingJourney() {
  const [open, setOpen] = useState(false);
  const fetchProgress = useServerFn(getOnboardingProgress);
  const { data } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => fetchProgress(),
    retry: false,
  });

  if (!data || data.complete || data.role === "staff") return null;

  return (
    <section className="mx-3 mb-2 shrink-0 overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls="onboarding-checklist"
        onClick={() => setOpen((current) => !current)}
        className="grid h-auto w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-none px-3 py-2.5 text-left hover:bg-secondary"
      >
        <ListChecks className="size-4 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">Get set up!</span>
          <span className="block text-[0.7rem] font-normal text-muted-foreground">
            {onboardingProgressLabel(data.steps)}
          </span>
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </Button>
      {open ? (
        <ol id="onboarding-checklist" className="border-t border-border p-1.5">
          {data.steps.map((step) => (
            <li key={step.id}>
              <Link
                to={step.path}
                {...(step.search ? { search: step.search } : {})}
                {...(step.hash ? { hash: step.hash } : {})}
                className={cn(
                  "grid min-h-12 grid-cols-[auto_minmax(0,1fr)] items-start gap-2 rounded-md border border-transparent px-2.5 py-2 transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  step.current && "border-primary bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[0.65rem] font-semibold",
                    step.done
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {step.done ? <Check className="size-3" /> : null}
                  {!step.done && step.blockedBy ? <Lock className="size-2.5" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium leading-5">{step.title}</span>
                  <span className="block text-[0.7rem] font-normal leading-snug text-muted-foreground">
                    {step.blockedBy && !step.done
                      ? "Opens once your subscription starts."
                      : step.detail}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
