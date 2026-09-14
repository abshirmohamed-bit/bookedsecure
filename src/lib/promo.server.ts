/**
 * Promo code authority (server only).
 *
 * One place answers "what pricing is this business entitled to", so the plan
 * list, the subscription checkout, the credit packs and the automatic top-up
 * all agree — and a browser can never ask for a price it hasn't earned.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { canRedeem, NO_PROMO, normalisePromoCode, type PromoEntitlement } from "@/lib/promo";
import { isCreditPackSetId } from "@/lib/sms/credit-packs";

type PromoRow = {
  code: string;
  plan_id: string | null;
  credit_price_cents: number | null;
  credit_pack_set: string;
  max_redemptions: number | null;
  reserved_business_id: string | null;
  active: boolean;
};

function toEntitlement(row: PromoRow): PromoEntitlement {
  return {
    code: row.code,
    planId: row.plan_id,
    creditPackSet: isCreditPackSetId(row.credit_pack_set) ? row.credit_pack_set : "standard",
    creditPriceCents: row.credit_price_cents,
  };
}

async function getCode(code: string): Promise<PromoRow | null> {
  const { data } = await supabaseAdmin
    .from("promo_codes")
    .select("code, plan_id, credit_price_cents, credit_pack_set, max_redemptions, reserved_business_id, active")
    .eq("code", code)
    .maybeSingle();
  return (data as PromoRow | null) ?? null;
}

/** The pricing this business has redeemed, or the public pricing. */
export async function resolvePromoEntitlement(businessId: string): Promise<PromoEntitlement> {
  const { data: applied } = await supabaseAdmin
    .from("business_promo_codes")
    .select("code")
    .eq("business_id", businessId)
    .maybeSingle();
  if (!applied?.code) return NO_PROMO;
  const row = await getCode(applied.code);
  if (!row || !row.active) return NO_PROMO;
  return toEntitlement(row);
}

export type RedeemResult = { ok: true; entitlement: PromoEntitlement } | { ok: false; error: string };

/** Apply a code to one business, for life. Refuses anything the rules don't allow. */
export async function redeemPromoCode(input: {
  businessId: string;
  userId: string;
  code: string;
}): Promise<RedeemResult> {
  const code = normalisePromoCode(input.code);
  if (!code) return { ok: false, error: "Enter a code first." };

  const [row, existing, countResult] = await Promise.all([
    getCode(code),
    supabaseAdmin
      .from("business_promo_codes")
      .select("code")
      .eq("business_id", input.businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_promo_codes")
      .select("id", { count: "exact", head: true })
      .eq("code", code),
  ]);

  const check = canRedeem({
    rules: row
      ? {
          code: row.code,
          active: row.active,
          maxRedemptions: row.max_redemptions,
          reservedBusinessId: row.reserved_business_id,
        }
      : null,
    businessId: input.businessId,
    redemptionCount: countResult.count ?? 0,
    businessAlreadyHasCode: existing.data?.code ?? null,
  });
  if (!check.ok) return { ok: false, error: check.error };
  if (!row) return { ok: false, error: "That code isn't valid." };

  const { error } = await supabaseAdmin
    .from("business_promo_codes")
    .insert({ business_id: input.businessId, code: row.code, applied_by: input.userId });
  if (error) return { ok: false, error: "That code could not be applied." };

  await supabaseAdmin.from("audit_events").insert({
    business_id: input.businessId,
    user_id: input.userId,
    event_type: "promo_code_applied",
    entity_type: "business",
    entity_id: input.businessId,
    metadata: { code: row.code, plan_id: row.plan_id, credit_pack_set: row.credit_pack_set } as never,
  });

  return { ok: true, entitlement: toEntitlement(row) };
}
