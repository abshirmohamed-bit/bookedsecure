import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BusinessIdSchema = z.object({ businessId: z.string().uuid() });
const ProvisionSchema = BusinessIdSchema.extend({
  businessName: z.string().min(1),
  ownerEmail: z.string().email(),
  startingCredits: z.number().int().min(0).default(0),
  dailySendCap: z.number().int().min(1).default(100),
});
const CreditsSchema = BusinessIdSchema.extend({
  credits: z.number().int(),
});
const PoolNumberSchema = z.object({
  number: z.string().min(1),
  monthlyCostCents: z.number().int().min(0).default(1500),
});
const ReportWindowSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

async function requirePlatformAdmin(context: { supabase: any; userId: string }) {
  const { requirePlatformAdmin: check } = await import("@/lib/pilot.server");
  return check(context.supabase, context.userId);
}

async function loadAccountModule() {
  return import("@/lib/sms/texto-accounts.server");
}

/** Tenant-scoped read: returns the current Texto account, assigned number, and primary sender. */
export const getTextoAccountState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BusinessIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    if (app.businessId !== data.businessId) {
      throw new Error("Forbidden");
    }

    const { getTextoAccount, listAssignedNumbers } = await loadAccountModule();
    const [account, numbers] = await Promise.all([
      getTextoAccount(data.businessId),
      listAssignedNumbers(data.businessId),
    ]);

    return { account, numbers };
  });

/** Tenant-scoped read: message and delivery summary for the business. */
export const getTextoAccountReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BusinessIdSchema.extend({ window: ReportWindowSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const app = await requireAppContext(context.supabase, context.userId);
    if (app.businessId !== data.businessId) {
      throw new Error("Forbidden");
    }

    const { getTextoAccountReport } = await loadAccountModule();
    return getTextoAccountReport(data.businessId, data.window);
  });

/** Platform admin only: idempotently provision a Texto sub-account and assign a number. */
export const provisionTextoAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProvisionSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { provisionTextoAccount } = await loadAccountModule();
    return provisionTextoAccount({
      businessId: data.businessId,
      businessName: data.businessName,
      ownerEmail: data.ownerEmail,
      startingCredits: data.startingCredits,
      dailySendCap: data.dailySendCap,
    });
  });

/** Platform admin only: allocate or deduct credits for a tenant. */
export const allocateTextoCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreditsSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { allocateCredits } = await loadAccountModule();
    return allocateCredits(data.businessId, data.credits);
  });

/** Platform admin only: recall a tenant's assigned number and disable the sender. */
export const recallTextoNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => BusinessIdSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { recallTextoNumber } = await loadAccountModule();
    await recallTextoNumber(data.businessId);
    return { ok: true as const };
  });

/** Platform admin only: platform-wide aggregate report across all tenants. */
export const getTextoGroupReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ window: ReportWindowSchema }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { getTextoGroupReport } = await loadAccountModule();
    return getTextoGroupReport(data.window);
  });

/** Platform admin only: add an available Australian number to the manual pool. */
export const addTextoNumberToPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PoolNumberSchema.parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { addNumberToPool } = await loadAccountModule();
    return addNumberToPool({ number: data.number, monthlyCostCents: data.monthlyCostCents });
  });
