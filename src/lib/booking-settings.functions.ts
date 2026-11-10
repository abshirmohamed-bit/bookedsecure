import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

/**
 * Owner settings for website booking: travel buffer, start-time spacing, the
 * customer reminder, blocked time, and prices and lengths by size. All of it is
 * stored by docs/booking-api.sql; until that is applied `ready` is false and the
 * page explains it instead of failing.
 */
export const getBookingSettings = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  const { requireAppContext } = await import('./app-context.server');
  const ctx = await requireAppContext(context.supabase, context.userId);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { parseSizeOptions } = await import('./booking-engine');
  const [rules, blocks, services] = await Promise.all([
    supabaseAdmin.from('booking_availability')
      .select('travel_buffer_minutes, slot_step_minutes, customer_reminder_hours' as never)
      .eq('business_id', ctx.businessId).maybeSingle(),
    supabaseAdmin.from('booking_blocks' as never).select('id, starts_at, ends_at, reason')
      .eq('business_id', ctx.businessId).gte('ends_at', new Date().toISOString()).order('starts_at').limit(100),
    supabaseAdmin.from('services').select('id, name, price_guidance, duration_minutes, size_options' as never)
      .eq('business_id', ctx.businessId).eq('active', true).order('name'),
  ]);
  const ready = !rules.error && !blocks.error && !services.error;
  const row = (rules.data ?? {}) as Record<string, unknown>;
  return {
    ready,
    role: ctx.role,
    rules: {
      travel_buffer_minutes: Number(row['travel_buffer_minutes'] ?? 0) || 0,
      slot_step_minutes: Number(row['slot_step_minutes'] ?? 30) || 30,
      customer_reminder_hours: row['customer_reminder_hours'] == null ? null : Number(row['customer_reminder_hours']),
    },
    blocks: ready ? ((blocks.data ?? []) as unknown as Array<{ id: string; starts_at: string; ends_at: string; reason: string | null }>) : [],
    services: ready
      ? ((services.data ?? []) as unknown as Array<Record<string, unknown>>).map((service) => ({
          id: service['id'] as string,
          name: service['name'] as string,
          price_guidance: (service['price_guidance'] as string | null) ?? null,
          duration_minutes: (service['duration_minutes'] as number | null) ?? null,
          sizes: parseSizeOptions(service['size_options']),
        }))
      : [],
  };
});

async function ownerWrite(context: { supabase: never; userId: string }) {
  const { requireWriteContext, requireOwner } = await import('./app-context.server');
  const ctx = await requireWriteContext(context.supabase, context.userId);
  requireOwner(ctx);
  return ctx;
}

export const saveBookingRules = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    travel_buffer_minutes: z.number().int().min(0).max(240),
    slot_step_minutes: z.number().int().min(5).max(240),
    customer_reminder_hours: z.number().int().min(1).max(72).nullable(),
  }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerWrite(context as never);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: existing } = await supabaseAdmin.from('booking_availability').select('business_id').eq('business_id', ctx.businessId).maybeSingle();
    if (!existing) throw new Error('Set your bookable availability first, then these rules.');
    const { error } = await supabaseAdmin.from('booking_availability').update(data as never).eq('business_id', ctx.businessId);
    if (error) throw new Error('Could not save. Ask Lovable to apply the booking update (docs/booking-api.sql) first.');
    return { ok: true };
  });

export const addBookingBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    reason: z.string().trim().max(120).optional().nullable(),
  }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerWrite(context as never);
    if (Date.parse(data.ends_at) <= Date.parse(data.starts_at)) throw new Error('Blocked time must end after it starts.');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.from('booking_blocks' as never).insert({
      business_id: ctx.businessId, starts_at: data.starts_at, ends_at: data.ends_at,
      reason: data.reason || null, created_by: ctx.userId,
    } as never);
    if (error) throw new Error('Could not block that time.');
    return { ok: true };
  });

export const removeBookingBlock = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerWrite(context as never);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { error } = await supabaseAdmin.from('booking_blocks' as never).delete().eq('id', data.id).eq('business_id', ctx.businessId);
    if (error) throw new Error('Could not remove that blocked time.');
    return { ok: true };
  });

export const saveServiceSizes = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    service_id: z.string().uuid(),
    sizes: z.array(z.object({
      label: z.string().trim().min(1).max(60),
      price: z.number().min(0).max(100000).nullable(),
      duration_minutes: z.number().int().min(5).max(1440).nullable(),
    })).max(12),
  }).strict().parse(input))
  .handler(async ({ data, context }) => {
    const ctx = await ownerWrite(context as never);
    const { parseSizeOptions, sizeKeyFor } = await import('./booking-engine');
    const sizes = parseSizeOptions(data.sizes.map((size) => ({ ...size, key: sizeKeyFor(size.label) })));
    if (sizes.length !== data.sizes.length) throw new Error('Each size needs its own name.');
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { data: row, error } = await supabaseAdmin.from('services').update({ size_options: sizes } as never)
      .eq('id', data.service_id).eq('business_id', ctx.businessId).select('id').maybeSingle();
    if (error || !row) throw new Error('Could not save the sizes for that service.');
    return { ok: true, sizes };
  });
