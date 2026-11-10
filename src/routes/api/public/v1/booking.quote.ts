import { createFileRoute } from '@tanstack/react-router';

/** Price and length for a package, size and add-ons. Nothing is saved. */
export const Route = createFileRoute('/api/public/v1/booking/quote')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      POST: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest, API_CORS } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'bookings:write', 'booking_quote');
        if (caller instanceof Response) return caller;
        const { bookingSelectionSchema, QUOTE_ERROR_MESSAGES } = await import('@/lib/booking-engine');
        let body: unknown;
        try { body = await request.json(); } catch { body = null; }
        const parsed = bookingSelectionSchema.safeParse(body);
        if (!parsed.success) {
          await logApiRequest(caller, 'booking_quote', 400, 'invalid_body');
          return Response.json({ ok: false, error: { code: 'invalid_body', message: 'Send service_id, and size and addon_ids where they apply.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: API_CORS });
        }
        try {
          const { quoteFor } = await import('@/lib/booking-engine.server');
          const result = await quoteFor(caller.businessId, parsed.data);
          if (!result.ok) {
            await logApiRequest(caller, 'booking_quote', 422, result.error);
            return apiError(422, result.error, QUOTE_ERROR_MESSAGES[result.error]);
          }
          await logApiRequest(caller, 'booking_quote', 200);
          return apiOk({ quote: result.quote });
        } catch (e) {
          console.error('[booking-api] quote failed', e instanceof Error ? e.message : e);
          await logApiRequest(caller, 'booking_quote', 500, 'quote_failed');
          return apiError(500, 'server_error', 'Could not work out the quote.');
        }
      },
    },
  },
});
