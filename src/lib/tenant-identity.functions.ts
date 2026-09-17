/**
 * Business identity record: request layer.
 *
 * The business is always resolved from the signed-in user's own profile, so one
 * business can never read or change another business's identity record.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const IdentitySchema = z.object({
  legal_name: z.string().min(1).max(160),
  trading_name: z.string().max(160).nullable(),
  abn: z.string().max(20),
  address_line1: z.string().min(1).max(160),
  address_line2: z.string().max(160).nullable(),
  suburb: z.string().min(1).max(80),
  state: z.string().min(2).max(3),
  postcode: z.string().min(4).max(4),
  website: z.string().max(200).nullable(),
  contact_name: z.string().min(1).max(120),
  contact_email: z.string().email().max(160),
  contact_phone: z.string().min(6).max(24),
  message_types: z.array(z.string().min(1).max(120)).max(10),
  declaration_accepted: z.boolean(),
});

export const getBusinessIdentity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { readBusinessIdentity } = await import("@/lib/tenant-identity.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await readBusinessIdentity(app);
  });

export const saveBusinessIdentityDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdentitySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { saveBusinessIdentity } = await import("@/lib/tenant-identity.server");
    // Deliberately not gated on an active plan: a business must be able to
    // complete its identity record before or while activating.
    const app = await requireAppContext(context.supabase, context.userId);
    return await saveBusinessIdentity(app, data);
  });

/** Platform admin only: every identity record with the numbers it stands behind. */
export const listBusinessIdentityRecords = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requirePlatformAdmin } = await import("@/lib/pilot.server");
    await requirePlatformAdmin(context.supabase, context.userId);
    const { listBusinessIdentities } = await import("@/lib/tenant-identity.server");
    return { records: await listBusinessIdentities() };
  });
