import { BOOKING_STATUSES } from './api-keys';
import { LEAD_STATUSES } from './domain';

/** OpenAPI 3 description of the BookedSecure public API, for Zapier, n8n and developers. */
export function buildOpenApiSpec(origin: string) {
  const err = { $ref: '#/components/responses/Error' };
  const selection = { type: 'object', required: ['service_id'], properties: {
    service_id: { type: 'string', format: 'uuid' },
    size: { type: 'string', description: 'A size key from /booking/options, when the package has sizes' },
    addon_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
  } };
  const paging = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
  ];
  const dateRange = [
    { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
    { name: 'to', in: 'query', description: 'A date alone means the end of that day (UTC)', schema: { type: 'string', format: 'date-time' } },
  ];
  const statusFilter = { name: 'status', in: 'query', schema: { type: 'string', enum: [...LEAD_STATUSES] } };
  return {
    openapi: '3.0.3',
    info: { title: 'BookedSecure API', version: '1.0.0', description: 'Send leads into BookedSecure, read customers, bookings and services, and quote and book from your own website. Authenticate with an API key created in Settings → Integrations.' },
    servers: [{ url: `${origin}/api/public/v1` }],
    security: [{ bearer: [] }, { apiKey: [] }],
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer' },
        apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      responses: { Error: { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } } } },
    },
    paths: {
      '/me': { get: { summary: 'Check connection', responses: { 200: { description: 'Business name and key scopes' }, 401: err } } },
      '/leads': { get: {
        summary: 'List leads', description: 'Requires records:read. Newest first, with what each person asked for and where they came from. from and to filter by when the lead arrived.',
        parameters: [statusFilter, ...dateRange, { name: 'search', in: 'query', description: 'Name, email or mobile', schema: { type: 'string' } }, ...paging],
        responses: { 200: { description: 'Leads, total, limit, offset' }, 400: err, 401: err, 402: err, 403: err, 429: err },
      }, post: {
        summary: 'Create a lead', description: 'Requires leads:write. Reuses an existing customer with the same mobile. Triggers the normal acknowledgement and follow-ups.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'mobile'], properties: {
          name: { type: 'string' }, mobile: { type: 'string', example: '0412 345 678' }, email: { type: 'string' }, suburb: { type: 'string' }, address: { type: 'string' },
          service: { type: 'string' }, message: { type: 'string' }, vehicle: { type: 'string' }, source: { type: 'string', example: 'Website' },
          campaign: { type: 'string' }, ad_name: { type: 'string' }, form_name: { type: 'string' }, consent: { type: 'boolean' }, external_id: { type: 'string', description: 'e.g. the Meta leadgen id; repeat submissions are ignored' },
        } } } } },
        responses: { 201: { description: 'Created' }, 200: { description: 'Duplicate, already received' }, 400: err, 401: err, 402: err, 403: err, 429: err },
      } },
      '/customers': { get: { summary: 'Find customers', description: 'Requires records:read. Contact details, newest first. from and to filter by when the customer was added.', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, statusFilter, ...dateRange, ...paging], responses: { 200: { description: 'Customers, total, limit, offset' }, 400: err, 401: err, 403: err } } },
      '/bookings': { get: { summary: 'List bookings', description: 'Requires records:read. Shows upcoming bookings unless from is set.', parameters: [...dateRange, { name: 'status', in: 'query', schema: { type: 'string', enum: [...BOOKING_STATUSES] } }, ...paging], responses: { 200: { description: 'Bookings, total, limit, offset' }, 400: err, 401: err, 403: err } } },
      '/services': { get: { summary: 'List services', responses: { 200: { description: 'Active services' } } } },
      '/booking/options': { get: { summary: 'Booking options', description: 'Requires bookings:write. Packages with sizes, add-ons, prices and lengths, plus the booking rules.', responses: { 200: { description: 'Options' }, 401: err, 403: err } } },
      '/booking/quote': { post: {
        summary: 'Quote a booking', description: 'Requires bookings:write. Price and length for a package, size and add-ons. Nothing is saved.',
        requestBody: { required: true, content: { 'application/json': { schema: selection } } },
        responses: { 200: { description: 'Quote' }, 400: err, 422: err },
      } },
      '/booking/availability': { get: {
        summary: 'Open times', description: 'Requires bookings:write. Start times only; nothing about other customers. Accounts for bookings, blocked time and travel time.',
        parameters: [
          { name: 'service_id', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'size', in: 'query', schema: { type: 'string' } },
          { name: 'addon_ids', in: 'query', description: 'Comma separated', schema: { type: 'string' } },
          { name: 'date', in: 'query', description: 'First day, YYYY-MM-DD in the business timezone. Defaults to now.', schema: { type: 'string', format: 'date' } },
          { name: 'days', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 31, default: 7 } },
        ],
        responses: { 200: { description: 'Slots' }, 400: err, 422: err },
      } },
      '/booking/book': { post: {
        summary: 'Book', description: 'Requires bookings:write and an Idempotency-Key. Re-checks the time, then saves the customer and booking together. The same key returns the first booking. Sends the confirmation text once when sms_consent is true.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 120 } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['service_id', 'starts_at', 'customer'], properties: {
          ...selection.properties,
          starts_at: { type: 'string', format: 'date-time', description: 'A start from /booking/availability' },
          customer: { type: 'object', required: ['name', 'mobile'], properties: { name: { type: 'string' }, mobile: { type: 'string', example: '0412 345 678' }, email: { type: 'string' }, address: { type: 'string' }, suburb: { type: 'string' }, vehicle: { type: 'string' }, notes: { type: 'string' } } },
          sms_consent: { type: 'boolean', description: 'Customer agreed to booking texts (confirmation and reminder)' },
          source: { type: 'string', example: 'Glocast website' },
        } } } } },
        responses: { 201: { description: 'Booked' }, 200: { description: 'Replay of an earlier request with the same key' }, 400: err, 409: { description: 'Time no longer available' }, 422: err },
      } },
    },
  };
}
