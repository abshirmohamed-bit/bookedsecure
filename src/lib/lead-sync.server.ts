import { supabaseAdmin } from '@/integrations/supabase/client.server';
import {
  LEAD_SYNC_INTERVAL_MINUTES, LEAD_SYNC_MAX_FAILURES, LEAD_SYNC_STALE_MINUTES,
  checkLead, computeSince, enrichmentPatch, finalRunStatus, mapEnquiryFields, metaExternalId, parseSubmittedAt,
  type EnrichableLead, type SyncLeadInput,
} from './lead-sync';

const SOURCE = 'Facebook Lead Ads direct';
type Connection = { id: string; business_id: string; provider?: string; initial_lookback_days: number; consecutive_failures: number };

const DIRECT_STALE = 'The direct Facebook import stopped before finishing. The next check will pick up where it left off.';

/** Marks runs that never reported back as expired so a new one can start. */
export async function expireStaleRuns(connectionId?: string, message = DIRECT_STALE) {
  const cutoff = new Date(Date.now() - LEAD_SYNC_STALE_MINUTES * 60_000).toISOString();
  let q = supabaseAdmin.from('lead_sync_runs').update({ status: 'expired', error: message, completed_at: new Date().toISOString() })
    .in('status', ['requested', 'running']).lt('last_activity_at', cutoff);
  if (connectionId) q = q.eq('connection_id', connectionId);
  await q;
}

/** Records the outcome of one attempt on the connection: schedule, failure count and pause. */
async function recordAttempt(conn: Connection, startedAt: Date, failure: string | null) {
  const failures = failure ? conn.consecutive_failures + 1 : 0;
  await supabaseAdmin.from('lead_sync_connections').update({
    last_attempt_at: startedAt.toISOString(), next_check_at: new Date(startedAt.getTime() + LEAD_SYNC_INTERVAL_MINUTES * 60_000).toISOString(),
    consecutive_failures: failures,
    ...(failure
      ? { status: 'error', last_error: failures >= LEAD_SYNC_MAX_FAILURES ? `${failure} Automatic checks are paused until you fix this.` : failure }
      : {}),
  }).eq('id', conn.id);
}

/**
 * Direct Facebook import: BookedSecure reads the business's own Page leads and
 * applies them through the batch pipeline below. Runs to completion in this call.
 */
async function startDirectRun(conn: Connection, trigger: 'manual' | 'schedule', requestedBy: string | null) {
  const startedAt = new Date();
  const { loadMetaAccount, createDirectMetaTransport } = await import('./meta-direct.server');
  let account: Awaited<ReturnType<typeof loadMetaAccount>>;
  try {
    account = await loadMetaAccount(conn.business_id);
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Direct Facebook import is not available.';
    await recordAttempt(conn, startedAt, reason);
    return { started: false as const, reason };
  }
  await expireStaleRuns(conn.id, DIRECT_STALE);
  const { data: checkpoints, error: cpError } = await supabaseAdmin.from('lead_sync_form_checkpoints')
    .select('form_id, last_submitted_at').eq('connection_id', conn.id).eq('business_id', conn.business_id);
  if (cpError) throw new Error('Could not read direct import progress.');
  const since = checkpoints?.length
    ? new Date(Math.min(...checkpoints.map((c) => computeSince(c.last_submitted_at, conn.initial_lookback_days, startedAt).getTime())))
    : computeSince(null, conn.initial_lookback_days, startedAt);
  const { data: run, error } = await supabaseAdmin.from('lead_sync_runs').insert({
    business_id: conn.business_id, connection_id: conn.id, trigger_kind: trigger, requested_by: requestedBy,
    status: 'running', since: since.toISOString(),
  }).select('id').single();
  if (error?.code === '23505') return { started: false as const, reason: 'An import is already running.' };
  if (error || !run) throw new Error('Could not start the direct import.');
  try {
    const { received } = await createDirectMetaTransport(account).importLeads({
      lookbackDays: conn.initial_lookback_days, checkpoints: checkpoints ?? [], now: startedAt,
      apply: async (batch) => {
        const result = await applyRunBatch(conn.business_id, run.id, batch, account.pageId);
        if ('notFound' in result || 'closed' in result) throw new Error('The direct import run is unavailable.');
        return result;
      },
    });
    await recordAttempt(conn, startedAt, null);
    return { started: true as const, runId: run.id, received };
  } catch (e) {
    // Controlled messages only; never credentials or provider payloads.
    const reason = e instanceof Error ? e.message : 'Direct Facebook import failed.';
    await supabaseAdmin.from('lead_sync_runs').update({ status: 'failed', error: reason, completed_at: new Date().toISOString() }).eq('id', run.id).in('status', ['requested', 'running']);
    await recordAttempt(conn, startedAt, reason);
    return { started: false as const, reason, runId: run.id };
  }
}

/** Starts one import for a business. The database allows only one active run per connection. */
export async function startSyncRun(conn: Connection, trigger: 'manual' | 'schedule', requestedBy: string | null) {
  if (conn.provider !== 'meta_direct') return { started: false as const, reason: 'Only the direct Facebook connection can import leads.' };
  return startDirectRun(conn, trigger, requestedBy);
}

/** Five-minute sweep: imports for every business whose direct Facebook switch is on. */
export async function sweepScheduledSyncs() {
  await expireStaleRuns();
  const due = `next_check_at.is.null,next_check_at.lte.${new Date(Date.now() + 30_000).toISOString()}`;
  const { data: direct, error } = await supabaseAdmin.from('lead_sync_connections')
    .select('id, business_id, provider, initial_lookback_days, consecutive_failures, next_check_at')
    .eq('provider', 'meta_direct').eq('auto_sync_enabled', true).neq('status', 'disconnected')
    .lt('consecutive_failures', LEAD_SYNC_MAX_FAILURES)
    .or(due).limit(25);
  if (error) throw new Error('Could not load scheduled imports.');
  let started = 0;
  for (const conn of direct ?? []) {
    try { if ((await startSyncRun(conn, 'schedule', null)).started) started++; } catch (e) { console.error('direct lead sync failed', e instanceof Error ? e.message : e); }
  }
  return { checked: direct?.length ?? 0, started };
}

type ItemOutcome = { meta_lead_id: string; outcome: 'created' | 'duplicate' | 'enriched' | 'skipped' | 'failed'; reason?: string | undefined };

const ENRICH_SELECT = 'id, email, suburb, service_address, vehicle_type, main_concerns, service_intent, request_type, service_name_snapshot, flexible_request_text, source_metadata';

/**
 * A lead that already exists (same Meta submission, or one sent earlier through
 * the plain /leads endpoint) is enriched in place: missing enquiry details are
 * filled, raw form answers merged, and nothing the owner recorded is touched.
 */
async function enrichExisting(businessId: string, leadId: string, input: SyncLeadInput, email: string | null): Promise<'enriched' | 'duplicate'> {
  const { data: existing, error } = await supabaseAdmin.from('leads').select(ENRICH_SELECT).eq('business_id', businessId).eq('id', leadId).maybeSingle();
  if (error) throw error;
  if (!existing) return 'duplicate';
  const { patch, changed } = enrichmentPatch(existing as EnrichableLead, mapEnquiryFields(input), { email });
  if (!changed.length) return 'duplicate';
  const { error: upErr } = await supabaseAdmin.from('leads').update(patch as never).eq('business_id', businessId).eq('id', leadId);
  if (upErr) throw upErr;
  return 'enriched';
}

async function ingestOne(businessId: string, runId: string, input: SyncLeadInput): Promise<ItemOutcome> {
  const submittedAt = parseSubmittedAt(input.created_time);
  const base = { run_id: runId, business_id: businessId, meta_lead_id: input.meta_lead_id, form_id: input.form_id ?? null, form_name: input.form_name ?? null, page_id: input.page_id ?? null, submitted_at: submittedAt };
  const record = async (o: ItemOutcome & { lead_id?: string | null; display_name?: string | null }) => {
    await supabaseAdmin.from('lead_sync_items').upsert({ ...base, outcome: o.outcome, reason: o.reason ?? null, lead_id: o.lead_id ?? null, display_name: o.display_name ?? null }, { onConflict: 'run_id,meta_lead_id' });
    return { meta_lead_id: o.meta_lead_id, outcome: o.outcome, reason: o.reason };
  };
  const check = checkLead(input);
  if (!check.ok) return record({ meta_lead_id: input.meta_lead_id, outcome: 'skipped', reason: check.reason });
  const externalId = metaExternalId(input.meta_lead_id);
  const shortName = check.lead.name.split(/\s+/)[0] ?? null;
  const mapped = mapEnquiryFields(input);
  try {
    // The exact same Meta submission, or one sent earlier through the plain
    // /leads endpoint (stored with a key-specific prefix): enrich, never duplicate.
    const { data: existing, error: existErr } = await supabaseAdmin.from('leads').select('id').eq('business_id', businessId)
      .or(`external_id.eq.${externalId},external_id.like.api:%:${externalId}`).limit(1).maybeSingle();
    if (existErr) throw existErr;
    if (existing?.id) {
      const outcome = await enrichExisting(businessId, existing.id, input, check.lead.email);
      return record({ meta_lead_id: input.meta_lead_id, outcome, lead_id: existing.id, display_name: shortName });
    }
    const { alertTitle, classifyForBusiness, respondToFacebookLead } = await import('./facebook-lead-response.server');
    const { data: bizTz } = await supabaseAdmin.from('businesses').select('timezone').eq('id', businessId).maybeSingle();
    const { intent } = classifyForBusiness(mapped.rawAnswers, bizTz?.timezone ?? null);
    const respond = (leadId: string, returning: boolean) => respondToFacebookLead({
      businessId, leadId, metaLeadId: input.meta_lead_id, name: check.lead.name, submittedAt,
      answers: mapped.rawAnswers, service: mapped.service, returning,
    });

    // Returning customer: same mobile, name AND email as an active lead. Update
    // their record (fill-only), alert the owner and send a welcome-back reply.
    const { normaliseAuMobile } = await import('./domain');
    const mobile = normaliseAuMobile(check.lead.mobile);
    if (mobile && check.lead.email) {
      const { data: prior, error: priorErr } = await supabaseAdmin.from('leads').select('id, name, email, mobile_number')
        .eq('business_id', businessId).eq('mobile_number', mobile).is('deleted_at', null).order('created_at', { ascending: false }).limit(5);
      if (priorErr) throw priorErr;
      const { isSameCustomer } = await import('./facebook-lead-response');
      const match = (prior ?? []).find((p) => isSameCustomer({ mobile, name: check.lead.name, email: check.lead.email }, { mobile: p.mobile_number, name: p.name, email: p.email }));
      if (match) {
        await enrichExisting(businessId, match.id, input, check.lead.email);
        const { enqueueJob, runJobById } = await import('./jobs.server');
        const alert = await enqueueJob({ businessId, leadId: match.id, jobType: 'owner_alert', idempotencyKey: `facebook-lead:${input.meta_lead_id}:owner_alert`,
          payload: { title: alertTitle(intent, check.lead.name, true), body: [mapped.flexibleText, `Facebook form: ${input.form_name ?? input.form_id ?? 'unknown'}`].filter(Boolean).join('\n'), metadata: { lead_id: match.id, returning: true, intent } } });
        if (alert.job) await runJobById(alert.job.id);
        await respond(match.id, true);
        return record({ meta_lead_id: input.meta_lead_id, outcome: 'enriched', lead_id: match.id, display_name: shortName });
      }
    }

    const { captureLead } = await import('./lead-engine.server');
    const result = await captureLead({
      owner_alert_title: alertTitle(intent, check.lead.name, false),
      businessId, name: check.lead.name, mobile_number: check.lead.mobile, email: check.lead.email,
      suburb: mapped.suburb, service_address: mapped.address, vehicle_type: mapped.vehicle,
      main_concerns: mapped.notes, service_intent: mapped.service,
      request_type: mapped.requestType, service_name_snapshot: mapped.service,
      flexible_request_text: mapped.flexibleText,
      source_channel: 'meta', source_form: input.form_name ?? null, utm_source: SOURCE,
      consent: false, consent_text: 'No explicit SMS consent supplied with this Facebook lead.',
      lead_origin: 'inbound_form', channel: 'web' as const,
      source_metadata: { source: SOURCE, meta_lead_id: input.meta_lead_id, page_id: input.page_id ?? null, form_id: input.form_id ?? null, form_name: input.form_name ?? null, submitted_at: submittedAt, sync_run_id: runId, form_answers: mapped.rawAnswers },
      external_id: externalId,
    });
    if (!result.duplicate) await respond(result.leadId, false);
    return record({ meta_lead_id: input.meta_lead_id, outcome: result.duplicate ? 'duplicate' : 'created', lead_id: result.leadId, display_name: shortName });
  } catch (e) {
    console.error('lead sync ingest failed', e instanceof Error ? e.message : e);
    return record({ meta_lead_id: input.meta_lead_id, outcome: 'failed', reason: 'Could not be saved. It will be retried on the next import.', display_name: shortName });
  }
}

export type RunBatch = { leads: SyncLeadInput[]; final: boolean; error?: string | null | undefined };

/** Applies one batch of the business's own Page leads to its direct import run. */
export async function applyRunBatch(businessId: string, runId: string, batch: RunBatch, directPageId: string) {
  const { data: run, error } = await supabaseAdmin.from('lead_sync_runs').select('id, business_id, connection_id, status').eq('id', runId).maybeSingle();
  if (error) throw new Error('lookup_failed');
  if (!run || run.business_id !== businessId) return { notFound: true as const };
  const { data: connection, error: connectionError } = await supabaseAdmin.from('lead_sync_connections').select('provider, business_id').eq('id', run.connection_id).maybeSingle();
  if (connectionError) throw new Error('lookup_failed');
  if (!connection || connection.business_id !== businessId || connection.provider !== 'meta_direct') return { notFound: true as const };
  // Direct batches are produced in-process from the business's own connected Page only.
  if (!directPageId || batch.leads.some((l) => l.page_id !== directPageId || !l.form_id)) return { notFound: true as const };
  if (!['requested', 'running'].includes(run.status)) return { closed: true as const, status: run.status };

  const outcomes: ItemOutcome[] = [];
  for (const lead of batch.leads) outcomes.push(await ingestOne(businessId, runId, lead));

  const { data: items, error: itemsErr } = await supabaseAdmin.from('lead_sync_items').select('outcome, form_id, form_name, page_id, submitted_at').eq('run_id', runId).limit(5000);
  if (itemsErr) throw new Error('count_failed');
  const count = (o: string) => (items ?? []).filter((i) => i.outcome === o).length;
  const totals = { created_count: count('created'), duplicate_count: count('duplicate'), enriched_count: count('enriched'), skipped_count: count('skipped'), failed_count: count('failed') };
  const now = new Date().toISOString();

  if (!batch.final) {
    await supabaseAdmin.from('lead_sync_runs').update({ ...totals, status: 'running', last_activity_at: now }).eq('id', runId);
    return { outcomes, totals, status: 'running' };
  }

  // Advance each form's checkpoint only when none of its leads still need a retry.
  // A form whose leads were ALL skipped usually means the sender dropped the answers
  // (a mapping fault), so hold the checkpoint and let a fixed run pick them up again.
  const byForm = new Map<string, { latest: string | null; failed: boolean; usable: boolean; form_name: string | null; page_id: string | null }>();
  for (const i of items ?? []) {
    if (!i.form_id) continue;
    const f = byForm.get(i.form_id) ?? { latest: null, failed: false, usable: false, form_name: i.form_name, page_id: i.page_id };
    if (i.outcome === 'failed') f.failed = true;
    if (i.outcome !== 'skipped') f.usable = true;
    if (i.submitted_at && (!f.latest || i.submitted_at > f.latest)) f.latest = i.submitted_at;
    byForm.set(i.form_id, f);
  }
  for (const [form_id, f] of byForm) {
    if (f.failed || !f.usable || !f.latest || batch.error) continue;
    const { data: cp } = await supabaseAdmin.from('lead_sync_form_checkpoints').select('last_submitted_at').eq('connection_id', run.connection_id).eq('form_id', form_id).maybeSingle();
    if (cp && cp.last_submitted_at >= f.latest) continue;
    await supabaseAdmin.from('lead_sync_form_checkpoints').upsert({ business_id: businessId, connection_id: run.connection_id, form_id, form_name: f.form_name, page_id: f.page_id, last_submitted_at: f.latest, updated_at: now }, { onConflict: 'connection_id,form_id' });
  }
  const status = finalRunStatus(totals.failed_count, batch.error);
  await supabaseAdmin.from('lead_sync_runs').update({ ...totals, status, error: batch.error ?? null, last_activity_at: now, completed_at: now }).eq('id', runId);
  const connUpdate = status === 'completed'
    ? { last_success_at: now, last_error: null, status: 'connected', consecutive_failures: 0 }
    : { last_error: batch.error ? `Direct Facebook import reported: ${batch.error}` : `${totals.failed_count} lead(s) could not be saved and will be retried.` };
  await supabaseAdmin.from('lead_sync_connections').update(connUpdate).eq('id', run.connection_id);
  return { outcomes, totals, status };
}
