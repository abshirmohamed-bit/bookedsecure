import { describe, it, expect } from 'vitest';
import { pushGate, shouldUseSmsFallback } from './browser-push';
describe('browser push permissions', () => {
  const ready = { configured: true, supported: true, topLevel: true, permission: 'default' };
  it('requires a top-level page', () => expect(pushGate({...ready,topLevel:false})).toBe('open-in-new-tab'));
  it('blocks missing configuration', () => expect(pushGate({...ready,configured:false})).toBe('not-configured'));
  it('reports unsupported browsers', () => expect(pushGate({...ready,supported:false})).toBe('unsupported'));
  it('does not request denied permissions', () => expect(pushGate({...ready,permission:'denied'})).toBe('denied'));
  it('allows permission from an explicit action', () => expect(pushGate(ready)).toBe('ready'));
});
describe('optional SMS fallback', () => {
  const unavailable = { enabled: true, accepted: false, uncertain: false, muted: false };
  it('defaults to no SMS when not enabled', () => expect(shouldUseSmsFallback({...unavailable,enabled:false})).toBe(false));
  it('uses SMS only when push is unavailable', () => expect(shouldUseSmsFallback(unavailable)).toBe(true));
  it('does not text after accepted push', () => expect(shouldUseSmsFallback({...unavailable,accepted:true})).toBe(false));
  it('does not text for unknown push outcomes', () => expect(shouldUseSmsFallback({...unavailable,uncertain:true})).toBe(false));
  it('honours new-lead mute', () => expect(shouldUseSmsFallback({...unavailable,muted:true})).toBe(false));
});