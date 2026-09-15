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

/* ------------------------------------------------------------------ platform admin: number pool */

/** Platform admin only: pull every number held at Texto into the local pool. */
export const syncTextoNumberPool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context);
    const { syncNumbersFromTexto } = await loadAccountModule();
    return syncNumbersFromTexto();
  });

/** Platform admin only: pool numbers, live-mode flags and tenants waiting on a number. */
export const getTextoNumberPoolOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePlatformAdmin(context);
    const mod = await loadAccountModule();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: numbers }, awaiting] = await Promise.all([
      supabaseAdmin
        .from("texto_numbers")
        .select("id, number, status, monthly_cost_cents, assigned_business_id, assigned_at, businesses:assigned_business_id(name)")
        .order("created_at"),
      mod.listBusinessesAwaitingNumber(),
    ]);
    return {
      liveProvisioning: mod.liveAccountProvisioning(),
      liveSubaccounts: mod.liveSubaccountProvisioning(),
      numbers: (numbers ?? []).map((n) => ({
        id: n.id,
        number: n.number,
        status: n.status,
        monthlyCostCents: n.monthly_cost_cents,
        assignedBusinessId: n.assigned_business_id,
        assignedBusinessName: (n.businesses as { name?: string | null } | null)?.name ?? null,
        assignedAt: n.assigned_at,
      })),
      awaiting,
    };
  });

/** Platform admin only: re-run provisioning for a queued or failed business. */
export const retryTextoProvisioning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requirePlatformAdmin(context);
    const { provisionMessagingForBusiness } = await import("@/lib/subscription-billing.server");
    const result = await provisionMessagingForBusiness(data.businessId);
    return result.ok
      ? { ok: true as const, number: result.number.number, state: result.account.provisioning_state }
      : { ok: false as const, reason: result.reason, queued: result.queued, state: result.account.provisioning_state };
  });

/* ------------------------------------------------------------------ owner: claim a dedicated number */

async function requireOwnBusinessOwner(context: { supabase: any; userId: string }) {
  const { requireAppContext } = await import("@/lib/app-context.server");
  const app = await requireAppContext(context.supabase, context.userId);
  if (app.role !== "owner") throw new Error("Only the business owner can manage numbers.");
  return app;
}

/** Owner-only: numbers the provider currently has for sale, with monthly price. */
export const listNumbersForPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireOwnBusinessOwner(context);
    const { listPurchasableNumbers, liveAccountProvisioning } = await loadAccountModule();
    if (!liveAccountProvisioning()) {
      return { live: false as const, numbers: [], reason: "Number buying is not switched on yet." };
    }
    try {
      const numbers = await listPurchasableNumbers();
      return { live: true as const, numbers, reason: null };
    } catch (error) {
      return {
        live: true as const,
        numbers: [],
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  });

/** Owner-only: buy one of those numbers and make it this business's number. */
export const claimNumberForBusiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        number: z.string().min(6).max(20),
        monthlyCostCents: z.number().int().min(0).max(100000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const app = await requireOwnBusinessOwner(context);
    const { claimDedicatedNumber } = await loadAccountModule();
    return claimDedicatedNumber({
      businessId: app.businessId,
      number: data.number,
      ...(data.monthlyCostCents === undefined ? {} : { monthlyCostCents: data.monthlyCostCents }),
    });
  });
