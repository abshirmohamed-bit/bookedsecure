export type PushGate = 'ready' | 'not-configured' | 'unsupported' | 'open-in-new-tab' | 'denied';
export function pushGate(input: { configured: boolean; supported: boolean; topLevel: boolean; permission: string }): PushGate {
  if (!input.configured) return 'not-configured';
  if (!input.supported) return 'unsupported';
  if (!input.topLevel) return 'open-in-new-tab';
  if (input.permission === 'denied') return 'denied';
  return 'ready';
}
export function shouldUseSmsFallback(input: { enabled: boolean; accepted: boolean; uncertain: boolean; muted: boolean }) {
  return input.enabled && !input.accepted && !input.uncertain && !input.muted;
}

export async function registerBrowserPush() {
  const appId = import.meta.env.VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_APP_ID;
  const vapidKey = import.meta.env.VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_VAPID_KEY;
  const config = {
    apiKey: import.meta.env.VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_WEB_API_KEY,
    projectId: import.meta.env.VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_PROJECT_ID,
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