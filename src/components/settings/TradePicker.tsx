import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { getOnboardingProgress, saveBusinessTrade } from "@/lib/onboarding.functions";
import { PRIMARY_TRADE_IDS, TRADE_IDS, TRADE_PRESETS, type TradeId } from "@/lib/trades";

/**
 * What the business actually does. Only ever used to pick sensible starting
 * points; anything already saved is left exactly as it is.
 */
export function TradePicker({ readOnly = false }: { readOnly?: boolean }) {
  const queryClient = useQueryClient();
  const fetchProgress = useServerFn(getOnboardingProgress);
  const saveTrade = useServerFn(saveBusinessTrade);

  const progress = useQuery({
    queryKey: ["onboarding-progress"],
    queryFn: () => fetchProgress(),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (trade: TradeId) => saveTrade({ data: { trade } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["onboarding-progress"] });
      toast.success("Saved. Your services and follow-up timing start from here.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const selected = progress.data?.trade ?? null;
  const others = TRADE_IDS.filter((id) => !PRIMARY_TRADE_IDS.includes(id));
  const order: TradeId[] = [...PRIMARY_TRADE_IDS, ...others];

  return (
    <section className="panel space-y-3 p-4">
      <div>
        <h2 className="text-sm font-semibold">What do you do?</h2>
        <p className="text-xs text-muted-foreground">
          We use this to suggest your services and how often past customers are due back.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {order.map((id) => {
          const preset = TRADE_PRESETS[id];
          const active = selected === id;
          return (
            <button
              key={id}
              type="button"
              disabled={readOnly || save.isPending}
              onClick={() => save.mutate(id)}
              className={`flex items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-60 ${
                active ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
              }`}
            >
              <span
                className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${
                  active ? "border-primary bg-primary text-primary-foreground" : "border-border"
                }`}
              >
                {active ? <Check className="h-2.5 w-2.5" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium">{preset.label}</span>
                <span className="block text-[0.7rem] leading-snug text-muted-foreground">
                  {preset.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {readOnly ? (
        <p className="text-xs text-muted-foreground">Only the business owner can change this.</p>
      ) : null}
    </section>
  );
}
