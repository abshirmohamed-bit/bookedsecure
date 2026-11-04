import { supabaseAdmin } from '@/integrations/supabase/client.server';
import {
  LEAD_SYNC_INTERVAL_MINUTES, LEAD_SYNC_MAX_FAILURES, LEAD_SYNC_STALE_MINUTES,
  checkLead, computeSince, finalRunStatus, metaExternalId, parseSubmittedAt, type SyncLeadInput,
} from './lead-sync';

const SOURCE = 'Facebook Lead Ads via Make';
type Connection = { id: string; business_id: string; trigger_url: string | null; initial_lookback_days: number; consecutive_failures: number };

/** Marks runs that never reported back as expired so a new one can start. */
export async function expireStaleRuns(connectionId?: string) {
  const cutoff = new Date(Date.now() - LEAD_SYNC_STALE_MINUTES * 60_000).toISOString();
  let q = supabaseAdmin.from('lead_sync_runs').update({ status: 'expired', error: 'Make did not report back. Check the scenario is ON and its webhook is active.', completed_at: new Date().toISOString() })
    .in('status', ['requested', 'running']).lt('last_activity_at', cutoff);
  if (connectionId) q = q.eq('connection_id', connectionId);
  await q;
}

/** Starts one import for a business. The database allows only one active run per connection. */
export async function startSyncRun(conn: Connection, trigger: 'manual' | 'schedule', requestedBy: string | null) {
  if (!conn.trigger_url) throw new Error('Add your Make webhook address first.');
  await expireStaleRuns(conn.id);
  const { data: checkpoints, error: cpErr } = await supabaseAdmin.from('lead_sync_form_checkpoints')
    .select('form_id, last_submitted_at').eq('connection_id', conn.id);
  if (cpErr) throw new Error('Could not read import progress.');
  const forms = (checkpoints ?? []).map((c) => ({ form_id: c.form_id, since: computeSince(c.last_submitted_at, conn.initial_lookback_days).toISOString() }));
  const defaultSince = computeSince(null, conn.initial_lookback_days);
  // New forms with no checkpoint use the first-import lookback; known forms use their own checkpoint.
  const since = forms.length ? new Date(Math.min(...forms.map((f) => Date.parse(f.since)))) : defaultSince;

  const { data: run, error } = await supabaseAdmin.from('lead_sync_runs').insert({
    business_id: conn.business_id, connection_id: conn.id, trigger_kind: trigger, since: since.toISOString(), requested_by: requestedBy,
  }).select('id').single();
  if (error?.code === '23505') return { started: false as const, reason: 'An import is already running.' };
  if (error || !run) throw new Error('Could not start the import.');

  const now = new Date();
  let failure: string | null = null;
  try {
    const res = await fetch(conn.trigger_url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        run_id: run.id, since: since.toISOString(), new_form_since: defaultSince.toISOString(), forms,
        callback_url: `https://bookedsecure.com/api/public/v1/lead-sync/runs/${run.id}`,
      }),
    });
    if (!res.ok) failure = res.status === 410 || res.status === 404 ? 'Make webhook is turned off or deleted. Turn the scenario ON or paste the new address.' : `Make rejected the request (${res.status}).`;
  } catch {
    failure = 'Make could not be reached. Try again shortly.';
  }

  const failures = failure ? conn.consecutive_failures + 1 : 0;
  await supabaseAdmin.from('lead_sync_connections').update({
    last_attempt_at: now.toISOString(), next_check_at: new Date(now.getTime() + LEAD_SYNC_INTERVAL_MINUTES * 60_000).toISOString(),
    consecutive_failures: failures, status: failure ? 'error' : 'connected',
    last_error: failure ? (failures >= LEAD_SYNC_MAX_FAILURES ? `${failure} Automatic checks are paused until you fix this.` : failure) : null,
  }).eq('id', conn.id);
  if (failure) {
    await supabaseAdmin.from('lead_sync_runs').update({ status: 'failed', error: failure, completed_at: now.toISOString() }).eq('id', run.id);
    return { started: false as const, reason: failure, runId: run.id };
  }
  return { started: true as const, runId: run.id };
}

/** Five-minute sweep: triggers every business that switched automatic import on. */
export async function sweepScheduledSyncs() {
  await expireStaleRuns();
  const { data, error } = await supabaseAdmin.from('lead_sync_connections')
    .select('id, business_id, trigger_url, initial_lookback_days, consecutive_failures, next_check_at')
    .eq('auto_sync_enabled', true).neq('status', 'disconnected').not('trigger_url', 'is', null)
    .lt('consecutive_failures', LEAD_SYNC_MAX_FAILURES)
    .or(`next_check_at.is.null,next_check_at.lte.${new Date(Date.now() + 30_000).toISOString()}`).limit(50);
  if (error) throw new Error('Could not load scheduled imports.');
  let started = 0;
  for (const conn of data ?? []) {
    try { if ((await startSyncRun(conn, 'schedule', null)).started) started++; } catch (e) { console.error('lead sync trigger failed', e instanceof Error ? e.message : e); }
  }
  return { checked: data?.length ?? 0, started };
}

type ItemOutcome = { meta_lead_id: string; outcome: 'created' | 'duplicate' | 'skipped' | 'failed'; reason?: string };

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
  try {
    // Leads sent earlier through the plain /leads endpoint are stored with a key-specific prefix.
    const { data: legacy, error: legacyErr } = await supabaseAdmin.from('leads').select('id').eq('business_id', businessId)
      .like('external_id', `api:%:${externalId}`).limit(1).maybeSingle();
    if (legacyErr) throw legacyErr;
    if (legacy?.id) return record({ meta_lead_id: input.meta_lead_id, outcome: 'duplicate', lead_id: legacy.id, display_name: shortName });
    const { captureLead } = await import('./lead-engine.server');
    const result = await captureLead({
      businessId, name: check.lead.name, mobile_number: check.lead.mobile, email: check.lead.email,
      source_channel: 'meta', source_form: input.form_name ?? null, utm_source: SOURCE,
      consent: false, consent_text: 'No explicit SMS consent supplied with this Facebook lead.',
      lead_origin: 'inbound_form',
      source_metadata: { source: SOURCE, meta_lead_id: input.meta_lead_id, page_id: input.page_id ?? null, form_id: input.form_id ?? null, form_name: input.form_name ?? null, submitted_at: submittedAt, sync_run_id: runId },
      external_id: externalId,
    });
    return record({ meta_lead_id: input.meta_lead_id, outcome: result.duplicate ? 'duplicate' : 'created', lead_id: result.leadId, display_name: shortName });
  } catch (e) {
    console.error('lead sync ingest failed', e instanceof Error ? e.message : e);
    return record({ meta_lead_id: input.meta_lead_id, outcome: 'failed', reason: 'Could not be saved. It will be retried on the next import.', display_name: shortName });
  }
}

export type RunBatch = { leads: SyncLeadInput[]; final: boolean; error?: string | null };

/** Applies a batch from Make to a run owned by the calling key's business. */
export async function applyRunBatch(businessId: string, runId: string, batch: RunBatch) {
  const { data: run, error } = await supabaseAdmin.from('lead_sync_runs').select('id, business_id, connection_id, status').eq('id', runId).maybeSingle();
  if (error) throw new Error('lookup_failed');
  if (!run || run.business_id !== businessId) return { notFound: true as const };
  if (!['requested', 'running'].includes(run.status)) return { closed: true as const, status: run.status };

  const outcomes: ItemOutcome[] = [];
  for (const lead of batch.leads) outcomes.push(await ingestOne(businessId, runId, lead));

  const { data: items, error: itemsErr } = await supabaseAdmin.from('lead_sync_items').select('outcome, form_id, form_name, page_id, submitted_at').eq('run_id', runId).limit(5000);
  if (itemsErr) throw new Error('count_failed');
  const count = (o: string) => (items ?? []).filter((i) => i.outcome === o).length;
  const totals = { created_count: count('created'), duplicate_count: count('duplicate'), skipped_count: count('skipped'), failed_count: count('failed') };
  const now = new Date().toISOString();

  if (!batch.final) {
    await supabaseAdmin.from('lead_sync_runs').update({ ...totals, status: 'running', last_activity_at: now }).eq('id', runId);
    return { outcomes, totals, status: 'running' };
  }

  // Advance each form's checkpoint only when none of its leads still need a retry.
  const byForm = new Map<string, { latest: string | null; failed: boolean; form_name: string | null; page_id: string | null }>();
  for (const i of items ?? []) {
    if (!i.form_id) continue;
    const f = byForm.get(i.form_id) ?? { latest: null, failed: false, form_name: i.form_name, page_id: i.page_id };
    if (i.outcome === 'failed') f.failed = true;
    if (i.submitted_at && (!f.latest || i.submitted_at > f.latest)) f.latest = i.submitted_at;
    byForm.set(i.form_id, f);
  }
  for (const [form_id, f] of byForm) {
    if (f.failed || !f.latest || batch.error) continue;
    const { data: cp } = await supabaseAdmin.from('lead_sync_form_checkpoints').select('last_submitted_at').eq('connection_id', run.connection_id).eq('form_id', form_id).maybeSingle();
    if (cp && cp.last_submitted_at >= f.latest) continue;
    await supabaseAdmin.from('lead_sync_form_checkpoints').upsert({ business_id: businessId, connection_id: run.connection_id, form_id, form_name: f.form_name, page_id: f.page_id, last_submitted_at: f.latest, updated_at: now }, { onConflict: 'connection_id,form_id' });
  }
  const status = finalRunStatus(totals.failed_count, batch.error);
  await supabaseAdmin.from('lead_sync_runs').update({ ...totals, status, error: batch.error ?? null, last_activity_at: now, completed_at: now }).eq('id', runId);
  const connUpdate = status === 'completed'
    ? { last_success_at: now, last_error: null, status: 'connected', consecutive_failures: 0 }
    : { last_error: batch.error ? `Make reported: ${batch.error}` : `${totals.failed_count} lead(s) could not be saved and will be retried.` };
  await supabaseAdmin.from('lead_sync_connections').update(connUpdate).eq('id', run.connection_id);
  return { outcomes, totals, status };
}
