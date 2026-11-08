import { describe, expect, it } from 'vitest';
import { mapConversations, mapFacebookComments, mapInstagramComments, replyWindow, socialWebhookTargets } from './meta-social';

const since = new Date('2026-11-08T00:00:00Z');

describe('comment mapping', () => {
  it('keeps customer Facebook comments and skips the Page’s own replies and old ones', () => {
    const posts = [{ id: 'p1', message: 'Interior detail special', permalink_url: 'https://fb/p1', comments: { data: [
      { id: 'c1', message: 'How much for a ute?', created_time: '2026-11-08T10:00:00+0000', from: { id: 'u1', name: 'Sam' } },
      { id: 'c2', message: 'Thanks Sam!', created_time: '2026-11-08T10:05:00+0000', from: { id: 'PAGE', name: 'Glocast' } },
      { id: 'c3', message: 'old', created_time: '2026-11-01T10:00:00+0000', from: { id: 'u2', name: 'Old' } },
      { id: 'c4', message: '   ', created_time: '2026-11-08T11:00:00+0000', from: { id: 'u3' } },
    ] } }];
    expect(mapFacebookComments(posts, 'PAGE', since)).toEqual([{ platform: 'facebook', commentId: 'c1', postId: 'p1', postText: 'Interior detail special', authorName: 'Sam', text: 'How much for a ute?', commentedAt: '2026-11-08T10:00:00+0000', url: 'https://fb/p1' }]);
  });
  it('keeps customer Instagram comments and skips the business account', () => {
    const media = [{ id: 'm1', caption: 'Before/after', permalink: 'https://ig/m1', comments: { data: [
      { id: 'i1', text: 'Do you come to Parramatta?', username: 'jess', timestamp: '2026-11-08T09:00:00+0000' },
      { id: 'i2', text: 'Yes!', username: 'glocast', timestamp: '2026-11-08T09:10:00+0000' },
    ] } }];
    expect(mapInstagramComments(media, 'glocast', since).map((c) => [c.commentId, c.authorName, c.platform])).toEqual([['i1', 'jess', 'instagram']]);
  });
});

describe('message mapping', () => {
  it('marks direction and the other participant', () => {
    const conv = [{ id: 't1', participants: { data: [{ id: 'PAGE', name: 'Glocast' }, { id: 'psid9', name: 'Alex' }] }, messages: { data: [
      { id: 'm2', message: 'We can do Tuesday', created_time: '2026-11-08T12:05:00+0000', from: { id: 'PAGE' } },
      { id: 'm1', message: 'Hi, quote for a sedan?', created_time: '2026-11-08T12:00:00+0000', from: { id: 'psid9', name: 'Alex' } },
    ] } }];
    expect(mapConversations('facebook', conv, ['PAGE']).map((m) => [m.messageId, m.direction, m.participantId, m.participantName])).toEqual([
      ['m2', 'out', 'psid9', 'Alex'], ['m1', 'in', 'psid9', 'Alex'],
    ]);
  });
  it('keeps the customer’s older messages in an active conversation', () => {
    // Regression: the Page's recent replies were imported but the customer's older message was not.
    const conv = [{ id: 't2', participants: { data: [{ id: 'PAGE' }, { id: 'psid7', name: 'Bernard' }] }, messages: { data: [
      { id: 'r1', message: 'Hi Bernard! How can we help?', created_time: '2026-11-06T06:31:38+0000', from: { id: 'PAGE' } },
      { id: 'q1', message: 'Can I get a quote?', created_time: '2026-10-20T01:00:00+0000', from: { id: 'psid7', name: 'Bernard' } },
    ] } }];
    expect(mapConversations('facebook', conv, ['PAGE']).map((m) => [m.messageId, m.direction])).toEqual([['r1', 'out'], ['q1', 'in']]);
  });
  it('keeps photo and sticker messages', () => {
    const conv = [{ id: 't3', participants: { data: [{ id: 'PAGE' }, { id: 'psid8' }] }, messages: { data: [
      { id: 'a1', created_time: '2026-11-08T01:00:00+0000', from: { id: 'psid8' }, attachments: { data: [{}] } },
      { id: 'a2', created_time: '2026-11-08T01:01:00+0000', from: { id: 'psid8' }, sticker: 'https://s' },
    ] } }];
    expect(mapConversations('facebook', conv, ['PAGE']).map((m) => m.body)).toEqual(['(photo or file)', '(sticker)']);
  });
});

describe('Meta reply window', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('allows a normal reply within 24 hours', () => {
    expect(replyWindow('2026-11-10T01:00:00Z', now)).toEqual({ allowed: true, messagingType: 'RESPONSE' });
  });
  it('allows a human-agent reply up to 7 days', () => {
    expect(replyWindow('2026-11-06T12:00:00Z', now)).toEqual({ allowed: true, messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });
  });
  it('refuses after 7 days or when the customer never wrote', () => {
    expect(replyWindow('2026-11-01T12:00:00Z', now).allowed).toBe(false);
    expect(replyWindow(null, now).allowed).toBe(false);
  });
});

describe('webhook targets', () => {
  it('picks out comment and message events per Page or Instagram account', () => {
    expect(socialWebhookTargets({ object: 'page', entry: [
      { id: '111', changes: [{ field: 'feed', value: { item: 'comment' } }] },
      { id: '222', changes: [{ field: 'feed', value: { item: 'like' } }] },
      { id: '333', messaging: [{}] },
      { id: '111', changes: [{ field: 'leadgen', value: {} }] },
    ] })).toEqual([{ object: 'page', id: '111' }, { object: 'page', id: '333' }]);
    expect(socialWebhookTargets({ object: 'instagram', entry: [{ id: '999', changes: [{ field: 'comments', value: {} }] }] })).toEqual([{ object: 'instagram', id: '999' }]);
    expect(socialWebhookTargets({ object: 'user', entry: [{ id: '1', messaging: [{}] }] })).toEqual([]);
  });
});
