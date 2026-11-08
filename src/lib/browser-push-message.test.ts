import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildOwnerPushMessage } from './browser-push';

const base = { token: 't', title: 'Quote request: George', body: 'A new enquiry has arrived.', path: '/leads', alertKey: 'lead:1:owner_alert', appUrl: 'https://bookedsecure.com/' };

describe('owner alert push message', () => {
  it('carries a display notification so the phone shows it without waking the worker', () => {
    const m = buildOwnerPushMessage(base);
    expect(m.webpush.notification).toMatchObject({ title: 'Quote request: George', body: 'A new enquiry has arrived.', tag: 'lead:1:owner_alert' });
    expect(m.webpush.headers).toEqual({ Urgency: 'high', TTL: '3600' });
    expect(m.webpush.fcm_options.link).toBe('https://bookedsecure.com/leads');
    expect(m.webpush.notification.icon).toBe('https://bookedsecure.com/icon-192.png');
  });
  it('gives each lead its own notification tag', () => {
    expect(buildOwnerPushMessage({ ...base, alertKey: 'lead:2:owner_alert' }).webpush.notification.tag).not.toBe(buildOwnerPushMessage(base).webpush.notification.tag);
  });
  it('never links outside BookedSecure', () => {
    expect(buildOwnerPushMessage({ ...base, path: '//evil.example' }).webpush.fcm_options.link).toBe('https://bookedsecure.com/leads');
  });
});

describe('service worker', () => {
  function worker() {
    const showNotification = vi.fn();
    let background: ((p: unknown) => unknown) | undefined;
    const self = { location: new URL('https://bookedsecure.com/firebase-messaging-sw.js?apiKey=a'), registration: { showNotification }, addEventListener: vi.fn(), clients: {} };
    runInNewContext(readFileSync('public/firebase-messaging-sw.js', 'utf8'), {
      self, URL, importScripts: vi.fn(),
      firebase: { initializeApp: vi.fn(), messaging: () => ({ onBackgroundMessage: (fn: (p: unknown) => unknown) => { background = fn; } }) },
    });
    return { showNotification, background: (p: unknown) => background?.(p) };
  }
  it('does not show a second copy of a notification Firebase already displayed', () => {
    const w = worker();
    w.background({ notification: { title: 'New lead' }, data: { title: 'New lead', alert_key: 'lead:1' } });
    expect(w.showNotification).not.toHaveBeenCalled();
  });
  it('still shows data-only messages', () => {
    const w = worker();
    w.background({ data: { title: 'New lead', body: 'x', path: '/leads', alert_key: 'lead:1' } });
    expect(w.showNotification).toHaveBeenCalledTimes(1);
  });
});
