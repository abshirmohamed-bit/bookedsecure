import { APP_CACHE_SCOPE, mayRegisterAppCache } from './pwa-policy';

export async function registerAppCache() {
  if (!('serviceWorker' in navigator)) return;
  const allowed = mayRegisterAppCache({ production: import.meta.env.PROD, hostname: window.location.hostname.toLowerCase(), embedded: window.top !== window.self, search: window.location.search });
  if (!allowed) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration => [registration.active, registration.waiting, registration.installing].some(worker => worker && new URL(worker.scriptURL).pathname === '/sw.js')).map(registration => registration.unregister()));
    return;
  }
  await navigator.serviceWorker.register('/sw.js', { scope: APP_CACHE_SCOPE, updateViaCache: 'none' });
}