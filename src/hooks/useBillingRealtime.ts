import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Keep the money-facing numbers live.
 *
 * Plan status (businesses) and credit balance (texto_accounts) change from the
 * outside: a Stripe webhook settling a payment, a credit pack landing, a text
 * being sent. Both rows are watched for this business only, and every change
 * refreshes the billing / messaging / settings reads so the screen never shows
 * a stale balance or an out-of-date plan.
 */
let nextChannelId = 0;

export function useBillingRealtime(businessId: string | null | undefined) {
  const queryClient = useQueryClient();
  // Two panels on one page (overview card + credits panel) both watch the same
  // business. Reusing one channel topic throws "cannot add postgres_changes
  // callbacks after subscribe()" on the second mount, so every consumer gets
  // its own channel and cleans up only its own.
  const channelKeyRef = useRef(`billing-${++nextChannelId}`);

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["my-billing"] });
      void queryClient.invalidateQueries({ queryKey: ["messaging-account"] });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    };

    // Safety net: coming back from Stripe in another tab, or waking a laptop.
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);

    if (!businessId) {
      return () => window.removeEventListener("focus", onFocus);
    }

    const channel = supabase
      .channel(`${channelKeyRef.current}-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "businesses", filter: `id=eq.${businessId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "texto_accounts", filter: `business_id=eq.${businessId}` },
        refresh,
      )
      .subscribe();

    return () => {
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [businessId, queryClient]);
}
