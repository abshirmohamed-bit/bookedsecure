import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// Existing inbox bell handles foreground banners; refreshing its data avoids a second popup.
export function PushForegroundListener() {
  const client = useQueryClient();
  useEffect(() => {
    let unsubscribe: (() => void) | undefined; let cancelled = false;
    if (!localStorage.getItem('bookedsecure:push-token')) return;
    void (async () => {
      const { getApps, initializeApp } = await import('firebase/app');
      const { isSupported, getMessaging, onMessage } = await import('firebase/messaging');
      if (!await isSupported() || cancelled) return;
      const appId = import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_APP_ID'];
      const apiKey = import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_WEB_API_KEY'];
      const projectId = import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_PROJECT_ID'];
      if (!appId || !apiKey || !projectId) return;
      const app = getApps().find(a => a.name === 'bookedsecure-push') ?? initializeApp({ appId, apiKey, projectId, messagingSenderId: appId.split(':')[1] }, 'bookedsecure-push');
      unsubscribe = onMessage(getMessaging(app), payload => {
        void client.invalidateQueries({ queryKey: ['notifications'] });
        // Tests have no inbox record to show; acknowledge explicitly without copying lead details.
        if (payload.data?.['alert_key']?.startsWith('test:')) {
          void import('sonner').then(({ toast }) => toast.success('Test push received on this device'));
        }
      });
      if (cancelled) unsubscribe();
    })().catch(() => { /* Notification settings exposes registration failures. */ });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [client]);
  return null;
}