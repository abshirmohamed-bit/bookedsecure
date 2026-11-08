// Messaging only: no offline/app-shell cache.
importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.2.0/firebase-messaging-compat.js');
const params = new URL(self.location).searchParams;
firebase.initializeApp(Object.fromEntries(['apiKey', 'projectId', 'appId', 'messagingSenderId'].map(key => [key, params.get(key)])));
// Data-only messages avoid Firebase auto-display plus a second custom notification.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const path = event.notification.data?.path;
  const target = new URL(path === '/notifications' ? path : '/leads', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(target); return existing.focus(); }
    return self.clients.openWindow(target);
  })());
});
firebase.messaging().onBackgroundMessage(payload => {
  const data = payload.data || {};
  return self.registration.showNotification(data.title || 'BookedSecure', {
    body: data.body || 'A new enquiry has arrived.', icon: '/favicon.png',
    tag: data.alert_key, data: { path: data.path || '/leads' },
  });
});