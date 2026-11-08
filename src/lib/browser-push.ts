export type PushGate = 'ready' | 'not-configured' | 'unsupported' | 'open-in-new-tab' | 'denied';
export function pushGate(input: { configured: boolean; supported: boolean; topLevel: boolean; permission: string }): PushGate {
  if (!input.configured) return 'not-configured';
  if (!input.supported) return 'unsupported';
  if (!input.topLevel) return 'open-in-new-tab';
  if (input.permission === 'denied') return 'denied';
  return 'ready';
}
/**
 * The FCM message for one owner alert. It carries a display notification so the
 * phone shows it straight away, without first waking the service worker (data-only
 * pushes can be held back by iOS/Android power saving for minutes). The tag is the
 * alert key, so each lead is its own notification and a retry never duplicates one.
 */
export function buildOwnerPushMessage(input: { token: string; title: string; body: string; path: string; alertKey: string; appUrl: string }) {
  const base = input.appUrl.replace(/\/+$/, '');
  const path = input.path.startsWith('/') && !input.path.startsWith('//') ? input.path : '/leads';
  const title = input.title.slice(0, 160); const body = input.body.slice(0, 500);
  return {
    token: input.token,
    data: { title, body, path, alert_key: input.alertKey },
    webpush: {
      headers: { Urgency: 'high', TTL: '3600' },
      notification: { title, body, icon: `${base}/icon-192.png`, badge: `${base}/icon-192.png`, tag: input.alertKey, renotify: true },
      fcm_options: { link: `${base}${path}` },
    },
  };
}

export function shouldUseSmsFallback(input: { enabled: boolean; accepted: boolean; uncertain: boolean; muted: boolean }) {
  return input.enabled && !input.accepted && !input.uncertain && !input.muted;
}

export async function registerBrowserPush() {
  const appId = import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_APP_ID'];
  const vapidKey = import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_VAPID_KEY'];
  const config = {
    apiKey: import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_WEB_API_KEY'],
    projectId: import.meta.env['VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_PROJECT_ID'],
    appId, messagingSenderId: appId?.split(':')[1] ?? '',
  };
  const { isSupported, getMessaging, getToken } = await import('firebase/messaging');
  const gate = pushGate({ configured: Boolean(config.apiKey && config.projectId && appId && vapidKey && config.messagingSenderId), supported: 'Notification' in window && await isSupported(), topLevel: window.top === window.self, permission: 'Notification' in window ? Notification.permission : 'default' });
  if (gate !== 'ready') return { status: gate };
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'denied' as const };
  const { getApps, initializeApp } = await import('firebase/app');
  const app = getApps().find(a => a.name === 'bookedsecure-push') ?? initializeApp(config, 'bookedsecure-push');
  const registration = await navigator.serviceWorker.register(`/firebase-messaging-sw.js?${new URLSearchParams(config)}`);
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
  return token ? { status: 'registered' as const, token } : { status: 'denied' as const };
}