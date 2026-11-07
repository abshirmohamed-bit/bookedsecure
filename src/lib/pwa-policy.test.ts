import { describe, expect, it } from 'vitest';
import { APP_CACHE_SCOPE, mayRegisterAppCache } from './pwa-policy';

const published = { production: true, hostname: 'bookedsecure.com', embedded: false, search: '' };
describe('installed app cache safety', () => {
  it('allows published custom domains', () => expect(mayRegisterAppCache(published)).toBe(true));
  it('blocks development', () => expect(mayRegisterAppCache({ ...published, production: false })).toBe(false));
  it('blocks embedded previews', () => expect(mayRegisterAppCache({ ...published, embedded: true })).toBe(false));
  it.each(['id-preview--app.lovable.app', 'preview-2--app.gpt-eng.com', 'preview--app.gptengineer.run', 'project--app-dev.lovable.app', 'lovableproject.com', 'app.lovableproject-dev.com', 'beta.lovable.dev'])('blocks preview %s', hostname => expect(mayRegisterAppCache({ ...published, hostname })).toBe(false));
  it('does not block preview-like custom domains', () => expect(mayRegisterAppCache({ ...published, hostname: 'preview-v2--shop.example.com' })).toBe(true));
  it('blocks a delegated preview hostname', () => expect(mayRegisterAppCache({ ...published, delegatedPreviewHostname: 'bookedsecure.com' })).toBe(false));
  it('supports the cache kill switch', () => expect(mayRegisterAppCache({ ...published, search: '?sw=off' })).toBe(false));
  it('does not replace the root Firebase push registration', () => expect(APP_CACHE_SCOPE).toBe('/dashboard'));
});