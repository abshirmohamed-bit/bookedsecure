import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { BellRing, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { getPushSettings, savePushDevice, removePushDevice, savePushFallback, testBrowserPush } from '@/lib/browser-push.functions';
import { registerBrowserPush } from '@/lib/browser-push';

const STATUS_COPY: Record<string,string> = {
  'not-configured': 'Update the Firebase connection and select Include web push.',
  unsupported: 'Push notifications are unavailable in this browser. On iPhone, add BookedSecure to your Home Screen first.',
  'open-in-new-tab': 'Open BookedSecure in its own tab to enable notifications.',
  denied: 'Notifications are blocked. Allow them in your browser’s site settings, then try again.',
};
export function PushNotificationSettings() {
  const fetchSettings = useServerFn(getPushSettings); const saveDevice = useServerFn(savePushDevice);
  const removeDevice = useServerFn(removePushDevice); const saveFallback = useServerFn(savePushFallback); const sendTest = useServerFn(testBrowserPush);
  const client = useQueryClient(); const settings = useQuery({ queryKey: ['push-settings'], queryFn: () => fetchSettings() });
  const [busy,setBusy] = useState(false); const [message,setMessage] = useState(''); const [deviceEnabled,setDeviceEnabled] = useState(false);
  useEffect(() => { setDeviceEnabled(Boolean(localStorage.getItem('bookedsecure:push-token'))); }, []);
  const enable = async () => {
    setBusy(true);
    try {
      const result = await registerBrowserPush();
      if (result.status !== 'registered' || !result.token) { setMessage(STATUS_COPY[result.status] ?? 'Could not register notifications.'); return; }
      await saveDevice({ data: { token: result.token } });
      localStorage.setItem('bookedsecure:push-token', result.token); setDeviceEnabled(true); setMessage('Notifications enabled on this device.');
      await client.invalidateQueries({ queryKey: ['push-settings'] });
    } catch { setMessage('Could not enable notifications. Check your connection and try again.'); }
    finally { setBusy(false); }
  };
  return <section className="mb-6 border-b border-border pb-6">
    <h2 className="flex items-center gap-2 text-sm font-semibold"><BellRing className="size-4" /> Device notifications</h2>
    <p className="mt-2 text-xs text-muted-foreground">Immediate new-lead and booking-enquiry alerts. No SMS credits used for push.</p>
    {settings.isError && <p className="mt-2 text-xs text-destructive">Could not load notification settings.</p>}
    {settings.data?.owner && <>
      <Button className="mt-3 w-full" size="sm" disabled={busy} onClick={enable}>{busy ? 'Connecting…' : deviceEnabled ? 'Refresh this device' : 'Enable on this device'}</Button>
      {deviceEnabled && <div className="mt-2 flex gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await sendTest(); setMessage(r.reason); } catch { setMessage('Could not send the test notification.'); } finally { setBusy(false); } }}>Send test</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => { const token = localStorage.getItem('bookedsecure:push-token'); if (!token) return; setBusy(true); try { await removeDevice({data:{token}}); localStorage.removeItem('bookedsecure:push-token'); setDeviceEnabled(false); setMessage('Notifications disabled on this device.'); } catch { setMessage('Could not disable notifications.'); } finally { setBusy(false); } }}>Disable</Button>
      </div>}
      <label className="mt-4 flex items-center justify-between gap-3 text-xs"><span>SMS fallback <span className="block text-muted-foreground">Uses your SMS credits</span></span><Switch aria-label="SMS fallback" checked={settings.data.smsFallback} onCheckedChange={async enabled => { try { await saveFallback({data:{enabled}}); await client.invalidateQueries({queryKey:['push-settings']}); } catch { toast.error('Could not save SMS fallback'); } }} /></label>
    </>}
    {message && <p role="status" className="mt-3 text-xs text-muted-foreground">{message}</p>}
    {message === STATUS_COPY['open-in-new-tab'] && <Button size="sm" variant="outline" className="mt-2" onClick={() => window.open(`${window.location.origin}/notifications`, '_blank', 'noopener,noreferrer')}><ExternalLink className="size-3" /> Open in new tab</Button>}
  </section>;
}