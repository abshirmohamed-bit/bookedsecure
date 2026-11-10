import { createFileRoute } from '@tanstack/react-router';

/**
 * Open start times for a package, size and add-ons. Returns times only, never
 * anything about other customers or their bookings.
 */
export const Route = createFileRoute('/api/public/v1/booking/availability')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      GET: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest, API_CORS } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'bookings:write', 'booking_availability');
        if (caller instanceof Response) return caller;
        const url = new URL(request.url);
        const { bookingSelectionSchema, QUOTE_ERROR_MESSAGES } = await import('@/lib/booking-engine');
        const addonParam = url.searchParams.get('addon_ids') ?? '';
        const parsed = bookingSelectionSchema.safeParse({
          service_id: url.searchParams.get('service_id') ?? '',
          size: url.searchParams.get('size') || null,
          addon_ids: addonParam ? addonParam.split(',').map((id) => id.trim()).filter(Boolean) : [],
        });
        if (!parsed.success) {
          await logApiRequest(caller, 'booking_availability', 400, 'invalid_query');
          return Response.json({ ok: false, error: { code: 'invalid_query', message: 'Send service_id, and size and addon_ids (comma separated) where they apply.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: API_CORS });
        }
        const daysRaw = Number(url.searchParams.get('days'));
        try {
          const { availabilityFor } = await import('@/lib/booking-engine.server');
          const result = await availabilityFor(caller.businessId, parsed.data, {
            date: url.searchParams.get('date'),
            days: Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : null,
          });
          if (!result.ok) {
            await logApiRequest(caller, 'booking_availability', 422, result.error);
            const message = result.error === 'invalid_date' ? (result.detail ?? 'Use date=YYYY-MM-DD.') : QUOTE_ERROR_MESSAGES[result.error];
            return apiError(422, result.error, message);
          }
          await logApiRequest(caller, 'booking_availability', 200);
          return apiOk({
            timezone: result.timezone,
            duration_minutes: result.duration_minutes,
            price: result.quote.price,
            slots: result.slots,
            message: result.reason,
          });
        } catch (e) {
          console.error('[booking-api] availability failed', e instanceof Error ? e.message : e);
          await logApiRequest(caller, 'booking_availability', 500, 'availability_failed');
          return apiError(500, 'server_error', 'Could not read availability.');
        }
      },
    },
  },
});
