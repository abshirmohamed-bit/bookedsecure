import { createServerOnlyFn } from '@tanstack/react-start';
import { supabaseAdmin } from '@/integrations/supabase/client.server';

export const deliverOwnerPush = createServerOnlyFn(async (input: { businessId: string; alertKey: string; title: string; body: string; path: string; userId?: string }) => {
  const key = process.env['FIREBASE_MESSAGING_API_KEY'];
  const platformKey = process.env['LOVABLE_API_KEY'];
  if (!key || !platformKey) return { accepted: false, uncertain: false, reason: 'Firebase sending credentials are unavailable.' };
  const owners = await supabaseAdmin.from('profiles').select('id').eq('business_id', input.businessId).eq('active', true);
  if (owners.error) throw new Error('Could not verify notification owners.');
  const ids = (owners.data ?? []).map(p => p.id);
  if (!ids.length) return { accepted: false, uncertain: false, reason: 'No active owner devices.' };
  const roles = await supabaseAdmin.from('user_roles').select('user_id').in('user_id', ids).eq('role', 'owner');
  if (roles.error) throw new Error('Could not verify notification owner roles.');
  const ownerIds = (roles.data ?? []).map(r => r.user_id).filter(id => !input.userId || id === input.userId);
  if (!ownerIds.length) return { accepted: false, uncertain: false, reason: 'No active owner devices.' };
  const devices = await supabaseAdmin.from('owner_push_devices').select('id,token').eq('business_id', input.businessId).in('user_id', ownerIds).limit(50);
  if (devices.error) throw new Error('Could not read owner devices.');
  let accepted = false; let uncertain = false;
  for (const device of devices.data ?? []) {
    const reservation = await supabaseAdmin.from('owner_push_deliveries').insert({ business_id: input.businessId, device_id: device.id, alert_key: input.alertKey }).select('id').single();
    if (reservation.error) {
      if (reservation.error.code !== '23505') throw new Error('Could not reserve push delivery.');
      const prior = await supabaseAdmin.from('owner_push_deliveries').select('status').eq('device_id', device.id).eq('alert_key', input.alertKey).single();
      if (prior.error) throw new Error('Could not check previous push delivery.');
      accepted ||= prior.data.status === 'accepted';
      uncertain ||= prior.data.status === 'reserved' || prior.data.status === 'unknown';
      continue;
    }
    let status: 'accepted' | 'failed' | 'unknown' = 'unknown';
    try {
      const response = await fetch('https://connector-gateway.lovable.dev/firebase_messaging/v1/projects/_/messages:send', {
        method: 'POST', headers: { Authorization: `Bearer ${platformKey}`, 'X-Connection-Api-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: device.token, data: { title: input.title.slice(0,160), body: input.body.slice(0,500), path: input.path, alert_key: input.alertKey }, webpush: { headers: { Urgency: 'high', TTL: '3600' } } } }),
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) { status = 'accepted'; accepted = true; }
      else {
        const errorBody = await response.text();
        // Tokens may appear in provider errors: retain only safe error codes/status, never raw payloads.
        const stale = errorBody.includes('UNREGISTERED');
        console.error('[owner-push] provider rejected push', { status: response.status, stale });
        status = 'failed';
        if (stale) await supabaseAdmin.from('owner_push_devices').delete().eq('id', device.id).eq('business_id', input.businessId);
      }
    } catch { uncertain = true; }
    const updated = await supabaseAdmin.from('owner_push_deliveries').update({ status, updated_at: new Date().toISOString() }).eq('id', reservation.data.id);
    if (updated.error) uncertain = true;
  }
  return { accepted, uncertain, reason: accepted ? 'Firebase accepted the push; device receipt is not confirmed.' : uncertain ? 'Push outcome uncertain; SMS held to prevent duplicate alerts.' : 'No reachable push devices; Firebase did not accept a notification.' };
});