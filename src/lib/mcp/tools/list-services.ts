import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { z } from 'zod';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'list_services', title: 'Read services and add-ons',
  description: 'Read the connected business’s current service and add-on catalog, price guidance, duration and active state. Paginate both catalogs; do not invent prices or appointment lengths.',
  inputSchema: { offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(50) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ offset, limit }, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const [services, addons] = await Promise.all([
      client.from('services').select('id,name,description,category,price_guidance,duration_minutes,active', { count: 'exact' }).eq('business_id', businessId).order('created_at').order('id').range(offset, offset + limit - 1),
      client.from('service_addons').select('id,name,description,category,price_guidance,duration_minutes,active', { count: 'exact' }).eq('business_id', businessId).order('created_at').order('id').range(offset, offset + limit - 1),
    ]);
    if (services.error || addons.error) throw new ToolError('The service catalog could not be read.');
    return jsonResult({ services: services.data ?? [], addons: addons.data ?? [], services_total: services.count, addons_total: addons.count, offset, next_offset: Math.max(services.count ?? 0, addons.count ?? 0) > offset + limit ? offset + limit : null });
  },
});