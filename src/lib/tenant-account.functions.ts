/**
 * Tenant account settings: owner notification number and business logo.
 *
 * Authorisation is always resolved server-side from the signed-in user's own
 * profile. A tenant id is never accepted from the browser, so one tenant can
 * never read or change another tenant's account settings.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAX_LOGO_BYTES } from "@/lib/tenant-logo";

export const getTenantAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { readTenantAccount } = await import("@/lib/tenant-account.server");
    const app = await requireAppContext(context.supabase, context.userId);
    return await readTenantAccount(app);
  });

export const saveOwnerNotification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        owner_notification_name: z.string().max(80).nullable(),
        /** Empty string or null clears the number and turns owner alerts off. */
        owner_notification_number: z.string().max(24).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { saveOwnerNotificationSettings } = await import("@/lib/tenant-account.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await saveOwnerNotificationSettings(app, data);
  });

export const uploadTenantLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        content_type: z.string().max(80),
        // Base64 payload; the byte length is re-checked server-side.
        data_base64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 1024),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { storeTenantLogo } = await import("@/lib/tenant-account.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await storeTenantLogo(app, data);
  });

export const removeTenantLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { clearTenantLogo } = await import("@/lib/tenant-account.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await clearTenantLogo(app);
  });

const SERVICE_IMAGE_KIND = z.enum(["service", "addon"]);

/** Attach or replace the picture on one of the tenant's own services or extras. */
export const uploadServiceImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        kind: SERVICE_IMAGE_KIND,
        id: z.string().uuid(),
        content_type: z.string().max(80),
        data_base64: z
          .string()
          .min(1)
          .max(Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 1024),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { storeServiceImage } = await import("@/lib/service-images.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await storeServiceImage(app, data);
  });

export const removeServiceImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ kind: SERVICE_IMAGE_KIND, id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireWriteContext } = await import("@/lib/app-context.server");
    const { clearServiceImage } = await import("@/lib/service-images.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return await clearServiceImage(app, data);
  });
