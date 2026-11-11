import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { BOOKING_STATUSES, readListFilters } from './api-keys';
import { LEAD_STATUSES } from './domain';
import { apiError, apiOk, authenticateApiRequest, logApiRequest } from './api-keys.server';

/** PostgREST "or" filter for a name, email or mobile search. */
function searchFilter(search: string): string {
  const digits = search.replace(/\D/g, '');
  const local = digits.startsWith('61') ? `0${digits.slice(2)}` : digits;
  const ors = [`name.ilike.%${search}%`, `email.ilike.%${search}%`];
  if (digits.length >= 6) ors.push(`mobile_number.ilike.%${local.slice(1)}%`);
  return ors.join(',');
}

/** GET /leads: enquiries with what they asked for and where they came from, newest first. */
export async function listLeadsResponse(request: Request): Promise<Response> {
  const caller = await authenticateApiRequest(request, 'records:read', 'list_leads');
  if (caller instanceof Response) return caller;
  const parsed = readListFilters(new URL(request.url).searchParams, LEAD_STATUSES);
  if (!parsed.ok) {
    await logApiRequest(caller, 'list_leads', 400, 'invalid_filter');
    return apiError(400, 'invalid_filter', parsed.message);
  }
  const { limit, offset, from, to, status, search } = parsed.filters;
  let q = supabaseAdmin.from('leads')
    .select('id, name, mobile_number, email, suburb, service_address, vehicle_type, service_intent, main_concerns, status, booking_status, quote_status, consent_status, opted_out_at, source_channel, source_campaign, source_form, utm_source, first_reply_at, created_at, updated_at', { count: 'exact' })
    .eq('business_id', caller.businessId).is('deleted_at', null)
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  if (search) q = q.or(searchFilter(search));
  const { data, error, count } = await q;
  if (error) {
    await logApiRequest(caller, 'list_leads', 500, 'read_failed');
    return apiError(500, 'server_error', 'Could not read leads.');
  }
  await logApiRequest(caller, 'list_leads', 200);
  const leads = (data ?? []).map((l) => ({
    id: l.id, name: l.name, mobile: l.mobile_number, email: l.email, suburb: l.suburb, address: l.service_address,
    vehicle: l.vehicle_type, service: l.service_intent, message: l.main_concerns,
    status: l.status, booking_status: l.booking_status, quote_status: l.quote_status,
    consent_status: l.consent_status, opted_out_at: l.opted_out_at,
    source: l.source_channel, source_detail: l.utm_source, campaign: l.source_campaign, form_name: l.source_form,
    first_reply_at: l.first_reply_at, created_at: l.created_at, updated_at: l.updated_at,
  }));
  return apiOk({ leads, total: count ?? 0, limit, offset });
}

/** GET /customers: contact details for looking someone up, newest first. */
export async function listCustomersResponse(request: Request): Promise<Response> {
  const caller = await authenticateApiRequest(request, 'records:read', 'list_customers');
  if (caller instanceof Response) return caller;
  const parsed = readListFilters(new URL(request.url).searchParams, LEAD_STATUSES);
  if (!parsed.ok) {
    await logApiRequest(caller, 'list_customers', 400, 'invalid_filter');
    return apiError(400, 'invalid_filter', parsed.message);
  }
  const { limit, offset, from, to, status, search } = parsed.filters;
  let q = supabaseAdmin.from('leads')
    .select('id, name, mobile_number, email, suburb, status, source_channel, created_at', { count: 'exact' })
    .eq('business_id', caller.businessId).is('deleted_at', null)
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  if (search) q = q.or(searchFilter(search));
  const { data, error, count } = await q;
  if (error) {
    await logApiRequest(caller, 'list_customers', 500, 'read_failed');
    return apiError(500, 'server_error', 'Could not read customers.');
  }
  await logApiRequest(caller, 'list_customers', 200);
  return apiOk({ customers: (data ?? []).map(({ mobile_number, ...r }) => ({ ...r, mobile: mobile_number })), total: count ?? 0, limit, offset });
}

/** GET /bookings: scheduled jobs in time order. Without `from`, only upcoming ones. */
export async function listBookingsResponse(request: Request): Promise<Response> {
  const caller = await authenticateApiRequest(request, 'records:read', 'list_bookings');
  if (caller instanceof Response) return caller;
  const parsed = readListFilters(new URL(request.url).searchParams, BOOKING_STATUSES);
  if (!parsed.ok) {
    await logApiRequest(caller, 'list_bookings', 400, 'invalid_filter');
    return apiError(400, 'invalid_filter', parsed.message);
  }
  const { limit, offset, from, to, status } = parsed.filters;
  let q = supabaseAdmin.from('jobs')
    .select('id, lead_id, scheduled_at, service_performed, completion_status, leads(name)', { count: 'exact' })
    .eq('business_id', caller.businessId).not('scheduled_at', 'is', null).gte('scheduled_at', from ?? new Date().toISOString())
    .order('scheduled_at', { ascending: true }).range(offset, offset + limit - 1);
  if (to) q = q.lte('scheduled_at', to);
  if (status) q = q.eq('completion_status', status);
  const { data, error, count } = await q;
  if (error) {
    await logApiRequest(caller, 'list_bookings', 500, 'read_failed');
    return apiError(500, 'server_error', 'Could not read bookings.');
  }
  await logApiRequest(caller, 'list_bookings', 200);
  const bookings = (data ?? []).map((j) => ({
    id: j.id, customer_id: j.lead_id, customer_name: (j.leads as { name?: string } | null)?.name ?? null,
    scheduled_at: j.scheduled_at, service: j.service_performed, status: j.completion_status,
  }));
  return apiOk({ bookings, total: count ?? 0, limit, offset });
}
