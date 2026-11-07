import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { getPushSettings, savePushDevice } from '@/lib/browser-push.functions';
import { registerBrowserPush } from '@/lib/browser-push';

const TOKEN_KEY = 'bookedsecure:push-token';

// Owners get the browser's own Allow/Block prompt automatically, without visiting Notifications.
// Browsers that require a user gesture (Safari, Firefox) get it on the owner's first tap/keypress.
export function AutoPushPrompt() {
  const fetchSettings = useServerFn(getPushSettings);
  const saveDevice = useServerFn(savePushDevice);
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['push-settings'], queryFn: () => fetchSettings(), staleTime: 300_000 });
  const isOwner = Boolean(settings.data?.owner);

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
    const detach = () => { window.removeEventListener('pointerdown', onGesture); window.removeEventListener('keydown', onGesture); };
    window.addEventListener('pointerdown', onGesture, { once: false });
    window.addEventListener('keydown', onGesture, { once: false });
    const t = window.setTimeout(() => { void run(); }, 1500); // Chrome/Edge show the prompt without a gesture
    return () => { window.clearTimeout(t); detach(); };
  }, [isOwner, saveDevice, client]);
  return null;
}
