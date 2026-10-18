import { defineTool, ToolError } from '@lovable.dev/mcp-js';
import { callerContext, jsonResult } from '../supabase';
export default defineTool({
  name: 'business_settings', title: 'Read business settings',
  description: 'Read the connected business’s name, timezone, website, service area, opening hours and quote/automation state. No credentials, billing IDs or private provider configuration are returned.',
  inputSchema: {}, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx) => {
    const { client, businessId } = await callerContext(ctx);
    const { data, error } = await client.from('businesses').select('name,timezone,website_url,phone_number,service_area,opening_hours,quote_mode,quote_form_active,automation_enabled').eq('id', businessId).maybeSingle();
    if (error || !data) throw new ToolError('Business settings could not be read.');
    return jsonResult({ business: data });
  },
});