import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { nicheKitFor } from "@/lib/niche";
import { cn } from "@/lib/utils";

/**
 * Landing-page preview of the quote page. Every business's quote page is worded
 * for its own trade (lib/niche), so instead of one tenant's screenshot this shows
 * the same first questions the real page asks, rotating through a few trades.
 */
const EXAMPLES = [
  { label: "Detailing", kit: nicheKitFor({ trade: "auto_marine_detailing" }) },
  { label: "Pool care", kit: nicheKitFor({ trade: "pool_servicing" }) },
  { label: "Pet grooming", kit: nicheKitFor({ trade: "mobile_pet_grooming" }) },
  { label: "Lawn and garden", kit: nicheKitFor({ trade: "lawn_garden" }) },
  { label: "Cleaning", kit: nicheKitFor({ trade: "commercial_cleaning" }) },
  { label: "Plans", kit: nicheKitFor({ model: "subscription" }) },
];

const ROTATE_MS = 4500;

export function QuotePagePreview({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % EXAMPLES.length), ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const { label, kit } = EXAMPLES[index] ?? EXAMPLES[0]!;
  const options = kit.subjectOptions.slice(0, 4);

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Example businesses">
        {EXAMPLES.map((example, i) => (
          <button
            key={example.label}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => {
              setIndex(i);
              setPaused(true);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              i === index ? "border-primary bg-primary text-primary-foreground" : "border-white/80 bg-white/65 text-foreground hover:bg-white/90",
            )}
          >
            {example.label}
          </button>
        ))}
      </div>

      <div className="mx-auto w-full max-w-[250px]">
        <div className="relative flex h-[24rem] flex-col overflow-hidden rounded-[1.75rem] border border-white/70 bg-gradient-to-b from-white to-[oklch(0.97_0.02_250)] shadow-[0_30px_60px_-28px_oklch(0.25_0.11_258/0.55)]" aria-live="polite">
          <div className="flex items-center gap-2 border-b border-foreground/5 px-3.5 py-3">
            <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-[var(--primary-bright)] to-[var(--primary)] text-white">
              <Sparkles className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">Your {label.toLowerCase()} business</p>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Quote assistant, online
              </p>
            </div>
          </div>

          <div key={index} className="flex flex-1 flex-col gap-2 px-3 py-3 text-[11px] leading-[1.45] animate-in fade-in slide-in-from-bottom-2 duration-500">
            <p className="w-fit max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">
              Tell me what you need in your own words. For example "{kit.serviceExample}".
            </p>
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-primary-foreground">{kit.serviceExample}</p>
            <p className="w-fit max-w-[92%] rounded-2xl rounded-tl-sm bg-white px-3 py-2 shadow-sm">{kit.subjectQuestion}</p>
            <div className="flex flex-wrap gap-1.5">
              {options.map((option) => (
                <span key={option} className="rounded-full border border-primary/25 bg-white px-2.5 py-1 text-[10px] font-medium text-primary">
                  {option}
                </span>
              ))}
            </div>
            <p className="mt-auto w-fit max-w-[92%] rounded-2xl rounded-tl-sm bg-white/80 px-3 py-2 text-muted-foreground shadow-sm">{kit.locationQuestion}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
