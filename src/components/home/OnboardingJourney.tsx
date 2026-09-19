import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Lock } from "lucide-react";
import { getOnboardingProgress } from "@/lib/onboarding.functions";
import { onboardingProgressLabel } from "@/lib/onboarding";

/**
 * A compact, honest "what's left to do" strip. Every tick comes from real saved
 * state, so it is the same on any device and never claims progress the business
 * has not made. Hidden entirely once the journey is finished.
 */
export function OnboardingJourney() {
  const fetchProgress = useServerFn(getOnboardingProgress);
  const { data } = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => fetchProgress(),
    retry: false,
  });

  if (!data || data.complete || data.role === "staff") return null;

  return (
    <section className="mx-3 mb-2 shrink-0 rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Get set up</h2>
        <span className="text-xs text-muted-foreground">
          {onboardingProgressLabel(data.steps)}
        </span>
      </div>
      <ol className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.steps.map((step) => (
          <li key={step.id}>
            <Link
              to={step.path}
              className={`flex items-start gap-2 rounded-lg border p-2 transition-colors ${
                step.current
                  ? "border-primary bg-primary/5"
                  : "border-transparent hover:bg-secondary"
              }`}
            >
              <span
                className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[0.65rem] font-semibold ${
                  step.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="h-3 w-3" /> : null}
                {!step.done && step.blockedBy ? <Lock className="h-2.5 w-2.5" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{step.title}</span>
                <span className="block text-[0.7rem] leading-snug text-muted-foreground">
                  {step.blockedBy && !step.done
                    ? "Opens once your subscription starts."
                    : step.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
