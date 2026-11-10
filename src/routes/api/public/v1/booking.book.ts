import { createFileRoute } from '@tanstack/react-router';

/**
 * Re-checks the chosen time, then saves the customer and the booking together.
 * Requires an Idempotency-Key header: repeating a request with the same key
 * returns the first booking and never books or texts twice.
 */
export const Route = createFileRoute('/api/public/v1/booking/book')({
  server: {
    handlers: {
      OPTIONS: async () => {
        const { API_CORS } = await import('@/lib/api-keys.server');
        return new Response(null, { status: 204, headers: API_CORS });
      },
      POST: async ({ request }) => {
        const { authenticateApiRequest, apiOk, apiError, logApiRequest, API_CORS } = await import('@/lib/api-keys.server');
        const caller = await authenticateApiRequest(request, 'bookings:write', 'booking_book');
        if (caller instanceof Response) return caller;
        const { bookingRequestSchema, readIdempotencyKey } = await import('@/lib/booking-engine');
        const key = readIdempotencyKey(request.headers);
        if (!key) {
          await logApiRequest(caller, 'booking_book', 400, 'missing_idempotency_key');
          return apiError(400, 'missing_idempotency_key', 'Send an Idempotency-Key header (8 to 120 letters, numbers or . _ : -), the same one on every retry of this booking.');
        }
        let body: unknown;
        try { body = await request.json(); } catch { body = null; }
        const parsed = bookingRequestSchema.safeParse(body);
        if (!parsed.success) {
          await logApiRequest(caller, 'booking_book', 400, 'invalid_body');
          return Response.json({ ok: false, error: { code: 'invalid_body', message: 'Check the booking fields.', fields: parsed.error.flatten().fieldErrors } }, { status: 400, headers: API_CORS });
        }
        try {
          const { bookAppointment } = await import('@/lib/booking-engine.server');
          const result = await bookAppointment({
            businessId: caller.businessId,
            apiKeyId: caller.keyId,
            requestKey: `api:${caller.keyId}:${key}`,
            request: parsed.data,
          });
          if (!result.ok) {
            await logApiRequest(caller, 'booking_book', result.status, result.error);
            return apiError(result.status, result.error, result.message);
          }
          await logApiRequest(caller, 'booking_book', result.replay ? 200 : 201, result.replay ? 'replay' : 'created');
          return apiOk({ booking: result.booking, replay: result.replay, confirmation: result.confirmation }, result.replay ? 200 : 201);
        } catch (e) {
          console.error('[booking-api] book failed', e instanceof Error ? e.message : e);
          await logApiRequest(caller, 'booking_book', 500, 'book_failed');
          return apiError(500, 'server_error', 'The booking could not be saved. Retry with the same Idempotency-Key.');
        }
      },
    },
  },
});
