import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** All bookings for the signed-in tenant, with the business time zone. */
export const getBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadBookings } = await import("@/lib/bookings.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const [bookings, { data: business }] = await Promise.all([
      loadBookings(app.businessId),
      supabaseAdmin.from("businesses").select("timezone").eq("id", app.businessId).maybeSingle(),
    ]);
    return {
      bookings,
      timezone: (business as { timezone?: string | null } | null)?.timezone ?? null,
      now: new Date().toISOString(),
    };
  });

/** One booking, scoped to the signed-in tenant. */
export const getBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { requireAppContext } = await import("@/lib/app-context.server");
    const { loadBooking } = await import("@/lib/bookings.server");
    const app = await requireAppContext(context.supabase, context.userId);
    const booking = await loadBooking(app.businessId, data.jobId);
    if (!booking) throw new Error("Booking not found.");
    return booking;
  });

/** Permanently removes one job record for the signed-in tenant (mistaken entries). */
export const deleteBookingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ jobId: z.string().uuid(), reason: z.string().max(500).nullable().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { requireAppContext, requireWriteContext } = await import("@/lib/app-context.server");
    const { deleteBooking } = await import("@/lib/bookings-write.server");
    const app = await requireWriteContext(context.supabase, context.userId);
    return deleteBooking({
      businessId: app.businessId,
      userId: app.userId,
      jobId: data.jobId,
      reason: data.reason ?? null,
    });
  });

