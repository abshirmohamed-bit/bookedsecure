/** OpenAPI 3 description of the BookedSecure public API, for Make.com, Zapier, n8n and developers. */
export function buildOpenApiSpec(origin: string) {
  const err = { $ref: '#/components/responses/Error' };
  const paging = [
    { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
    { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 } },
  ];
  return {
    openapi: '3.0.3',
    info: { title: 'BookedSecure API', version: '1.0.0', description: 'Send leads into BookedSecure and read customers, bookings and services. Authenticate with an API key created in Settings → Integrations.' },
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
      '/leads': { post: {
        summary: 'Create a lead', description: 'Requires leads:write. Reuses an existing customer with the same mobile. Triggers the normal acknowledgement and follow-ups.',
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'mobile'], properties: {
          name: { type: 'string' }, mobile: { type: 'string', example: '0412 345 678' }, email: { type: 'string' }, suburb: { type: 'string' }, address: { type: 'string' },
          service: { type: 'string' }, message: { type: 'string' }, vehicle: { type: 'string' }, source: { type: 'string', example: 'Meta (via Make.com)' },
          campaign: { type: 'string' }, ad_name: { type: 'string' }, form_name: { type: 'string' }, consent: { type: 'boolean' }, external_id: { type: 'string', description: 'e.g. the Meta leadgen id; repeat submissions are ignored' },
        } } } } },
        responses: { 201: { description: 'Created' }, 200: { description: 'Duplicate, already received' }, 400: err, 401: err, 402: err, 403: err, 429: err },
      } },
      '/customers': { get: { summary: 'Find customers', description: 'Requires records:read.', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }, ...paging], responses: { 200: { description: 'Customers' }, 403: err } } },
      '/bookings': { get: { summary: 'List bookings', description: 'Requires records:read. Defaults to upcoming.', parameters: [{ name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } }, { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } }, ...paging], responses: { 200: { description: 'Bookings' }, 403: err } } },
      '/services': { get: { summary: 'List services', responses: { 200: { description: 'Active services' } } } },
    },
  };
}
