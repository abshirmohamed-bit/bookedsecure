import { useEffect, useState } from 'react';
import { Share, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPushSettings, savePushDevice } from '@/lib/browser-push.functions';
import { registerBrowserPush } from '@/lib/browser-push';

// iPhone Safari only grants permission from click/touchend, not pointerdown.
const GESTURES = ['click', 'touchend', 'keydown'] as const;
const TOKEN_KEY = 'bookedsecure:push-token';

// Owners get the browser's own Allow/Block prompt automatically, without visiting Notifications.
// Browsers that require a user gesture (Safari, Firefox) get it on the owner's first tap/keypress.
export function AutoPushPrompt() {
  const fetchSettings = useServerFn(getPushSettings);
  const saveDevice = useServerFn(savePushDevice);
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['push-settings'], queryFn: () => fetchSettings(), staleTime: 300_000 });
  const isOwner = Boolean(settings.data?.owner);

  const [iosHint, setIosHint] = useState(false);
  useEffect(() => {
    if (!isOwner) return;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    if (ios && !standalone && !localStorage.getItem('bookedsecure:ios-push-hint-dismissed')) setIosHint(true);
  }, [isOwner]);
  useEffect(() => {
    if (!isOwner || typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.top !== window.self) return; // preview iframe cannot show the prompt
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'granted' && localStorage.getItem(TOKEN_KEY)) return;
    let running = false; let done = false;
    const run = async () => {
      if (running || done) return; running = true;
      try {
        const result = await registerBrowserPush();
        if (result.status === 'registered' && result.token) {
          await saveDevice({ data: { token: result.token } });
          localStorage.setItem(TOKEN_KEY, result.token);
          await client.invalidateQueries({ queryKey: ['push-settings'] });
        }
        if (Notification.permission !== 'default') done = true;
      } catch { /* Notifications page shows detailed errors */ }
      finally { running = false; if (done) detach(); }
    };
    const onGesture = () => { void run(); };
    const detach = () => { for (const e of GESTURES) window.removeEventListener(e, onGesture); };
    for (const e of GESTURES) window.addEventListener(e, onGesture);
    const t = window.setTimeout(() => { void run(); }, 1500); // Chrome/Edge show the prompt without a gesture
    return () => { window.clearTimeout(t); detach(); };
  }, [isOwner, saveDevice, client]);
  if (!iosHint) return null;
  // Apple only allows website notifications for sites added to the Home Screen.
  return <div role="status" className="fixed inset-x-3 bottom-3 z-[60] rounded-lg border border-border bg-card p-3 text-sm text-card-foreground shadow-lg">
    <button aria-label="Dismiss" className="absolute right-2 top-2 text-muted-foreground" onClick={() => { localStorage.setItem('bookedsecure:ios-push-hint-dismissed', '1'); setIosHint(false); }}><X className="size-4" /></button>
    <p className="pr-6 font-semibold">Get new-lead alerts on this iPhone</p>
    <p className="mt-1 text-xs text-muted-foreground">Tap <Share className="inline size-3.5" /> Share, then <b>Add to Home Screen</b>. Open BookedSecure from that icon and tap Allow.</p>
  </div>;
}
