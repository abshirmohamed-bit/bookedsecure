// Resolves the signed-in user's business + role, and asserts tenant ownership.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Client = SupabaseClient<Database>;

export type AppContext = {
  userId: string;
  businessId: string;
  role: "owner" | "staff" | "platform_admin";
  /** True when this user runs BookedSecure itself: never blocked by billing. */
  isPlatformAdmin: boolean;
  name: string | null;
  email: string | null;
};


export async function requireAppContext(supabase: Client, userId: string): Promise<AppContext> {
  // Both reads are tenant-scoped by the caller's own id, so they are safe to
  // run together: one round trip instead of two on every authenticated call.
  const [{ data: profile, error }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, business_id, name, email, active")
      .eq("id", userId)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", userId),
  ]);

  if (error) throw new Error(error.message);
  if (!profile) throw new Error("No profile found for this user.");
  if (!profile.active) throw new Error("This account has been deactivated.");
  if (!profile.business_id) throw new Error("This account is not linked to a business yet.");

  const roleValues = (roles ?? []).map((row) => row.role);
  const role = roleValues.includes("owner")
    ? "owner"
    : roleValues.includes("platform_admin")
      ? "platform_admin"
      : "staff";

  return {
    userId,
    businessId: profile.business_id,
    role,
    name: profile.name,
    email: profile.email,
  };
}

/** Never trust an id from the browser: confirm it belongs to the caller's business. */
export async function assertLeadOwnership(businessId: string, leadId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!data) throw new Error("Lead not found for this business.");
}

/**
 * Like `requireAppContext`, but for anything that changes tenant data.
 * A business in preview (not paying) can look around and upload a CSV, and
 * nothing else; a plan feature can be required at the same time.
 */
export async function requireWriteContext(
  supabase: Client,
  userId: string,
  feature?: import("@/lib/subscription").PlanFeature,
): Promise<AppContext> {
  const ctx = await requireAppContext(supabase, userId);
  const { requireActiveSubscription, requirePlanFeature } = await import("@/lib/subscription.server");
  if (feature) await requirePlanFeature(ctx.businessId, feature);
  else await requireActiveSubscription(ctx.businessId);
  return ctx;
}

export function requireOwner(ctx: AppContext): void {
  if (ctx.role === "staff") throw new Error("Only the business owner can change these settings.");
}
