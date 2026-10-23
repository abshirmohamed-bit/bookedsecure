/**
 * Plan reads for the UI.
 *
 * `getPublicPlans` is deliberately unauthenticated. the pricing page is a
 * public marketing page and plan rows carry no tenant data.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Plan } from "@/lib/plans";

export const getPublicPlans = createServerFn({ method: "GET" }).handler(
  async (): Promise<Plan[]> => {
    const { listOfferedPlans } = await import("@/lib/plans.server");
    return await listOfferedPlans();
  },
);

/** The signed-in tenant's own plan. */
export const getMyPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Plan> => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { getPlanForBusiness } = await import("@/lib/plans.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await getPlanForBusiness(app.businessId);
  });
