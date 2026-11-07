import { supabaseAdmin } from '@/integrations/supabase/client.server';
import { buildFacebookReply, classifyFacebookAnswers, formatAuPhone, FACEBOOK_AUTO_REPLY_FROM, type FacebookIntent } from './facebook-lead-response';
import type { RawAnswer } from './lead-sync';

const SLOT_GAP_MS = 90 * 60_000;

export function classifyForBusiness(answers: RawAnswer[], timeZone: string | null) {
  return classifyFacebookAnswers(answers, timeZone || 'Australia/Sydney', new Date());
}

export function alertTitle(intent: FacebookIntent, name: string, returning: boolean) {
  const first = name.split(/\s+/)[0] ?? name;
  return `${returning ? 'Returning customer — ' : ''}${intent === 'booking' ? 'Booking request' : 'Quote request'}: ${first}`;
}

/** Saves an exact requested time only when the lead has no booking yet and no other customer is near that slot. */
async function tryBook(businessId: string, leadId: string, at: string): Promise<boolean> {
  const t = new Date(at).getTime();
  const { data: clash, error } = await supabaseAdmin.from('jobs').select('id, lead_id').eq('business_id', businessId).eq('completion_status', 'scheduled')
    .gte('scheduled_at', new Date(t - SLOT_GAP_MS).toISOString()).lte('scheduled_at', new Date(t + SLOT_GAP_MS).toISOString()).limit(5);
  if (error) throw error;
  if ((clash ?? []).some((j) => j.lead_id !== leadId)) return false;
  const { data: own } = await supabaseAdmin.from('jobs').select('id').eq('business_id', businessId).eq('lead_id', leadId).eq('completion_status', 'scheduled').limit(1);
  if (own?.length) return false; // never move a customer's existing booking automatically
  const { error: rpcErr } = await supabaseAdmin.rpc('schedule_owner_job', { p_business_id: businessId, p_lead_id: leadId, p_scheduled_at: at });
  if (rpcErr) throw rpcErr;
  return true;
}

/**
 * Analyses a freshly imported Facebook submission and sends the ONE allowed
 * enquiry reply (phone + quote link, opt-out). Never sends follow-ups, never
 * replies to submissions made before the feature started, and never throws
 * into the importer — a failure only means no reply.
 */
export async function respondToFacebookLead(input: {
  businessId: string; leadId: string; metaLeadId: string; name: string; submittedAt: string | null;
  answers: RawAnswer[]; service: string | null; returning: boolean;
}): Promise<{ replied: boolean; intent: FacebookIntent | null; booked: boolean; note: string }> {
  try {
    if (!input.submittedAt || input.submittedAt < FACEBOOK_AUTO_REPLY_FROM)
      return { replied: false, intent: null, booked: false, note: 'Submitted before automatic replies started.' };
    const [{ data: biz, error }, { data: identity }] = await Promise.all([
      supabaseAdmin.from('businesses').select('name, slug, timezone').eq('id', input.businessId).maybeSingle(),
      supabaseAdmin.from('business_identity').select('contact_phone').eq('business_id', input.businessId).maybeSingle(),
    ]);
    if (error || !biz) throw error ?? new Error('Business not found.');
    const tz = biz.timezone || 'Australia/Sydney';
    const { intent, requestedAt } = classifyForBusiness(input.answers, tz);
    let bookedLabel: string | null = null;
    if (intent === 'booking' && requestedAt && (await tryBook(input.businessId, input.leadId, requestedAt))) {
      bookedLabel = new Intl.DateTimeFormat('en-AU', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(requestedAt));
    }
    const base = process.env['PUBLIC_APP_URL'] ?? 'https://bookedsecure.com';
    const body = buildFacebookReply({
      firstName: input.name.split(/\s+/)[0] ?? input.name, businessName: biz.name,
      phone: formatAuPhone(identity?.contact_phone), quoteUrl: biz.slug ? `${base}/quote/${biz.slug}` : null,
      intent, returning: input.returning, service: input.service, bookedLabel,
    });
    if (!body) return { replied: false, intent, booked: !!bookedLabel, note: 'No contact number or quote page set up, so no reply was sent.' };
    const { enqueueJob, runJobById } = await import('./jobs.server');
    // Keyed on the Meta submission: one reply per form submission, ever.
    const job = await enqueueJob({ businessId: input.businessId, leadId: input.leadId, jobType: 'acknowledgement', idempotencyKey: `facebook-lead:${input.metaLeadId}:reply`, payload: { body } });
    const result = job.job ? await runJobById(job.job.id) : null;
    return { replied: result?.status === 'succeeded', intent, booked: !!bookedLabel, note: result?.reason ?? 'Reply queued.' };
  } catch (e) {
    console.error('facebook auto-reply failed', e instanceof Error ? e.message : e);
    return { replied: false, intent: null, booked: false, note: 'Automatic reply could not be prepared.' };
  }
}
