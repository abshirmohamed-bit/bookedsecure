import { useEffect, useState } from "react";

const DEFAULT_STEPS = ["Thinking…", "Checking the details…", "Writing a reply…", "Almost there…"];

/** Animated "assistant is replying" bubble whose label advances while a slow reply is on its way. */
export function ThinkingIndicator({ steps = DEFAULT_STEPS }: { steps?: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((i) => Math.min(i + 1, steps.length - 1)), 5000);
    return () => clearInterval(timer);
  }, [steps.length]);

  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2 rounded-2xl rounded-bl-md bg-secondary px-3.5 py-2.5 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground"
            style={{ animationDelay: `${dot * 120}ms` }}
          />
        ))}
      </span>
      <span>{steps[index]}</span>
    </span>
  );
}
