import { describe, expect, it } from 'vitest';
import { API_ACCESS_LEVELS, apiLeadSchema, apiSourceChannel, generateApiKey, hasScope, hashApiKey, isWellFormedApiKey, readApiKey } from './api-keys';

describe('API keys', () => {
  it('generates distinct well-formed keys', () => {
    const a = generateApiKey(); const b = generateApiKey();
    expect(isWellFormedApiKey(a)).toBe(true);
    expect(a).not.toBe(b);
  });
  it('hashes deterministically and never returns the key', async () => {
    const k = generateApiKey();
    expect(await hashApiKey(k)).toBe(await hashApiKey(k));
    expect(await hashApiKey(k)).not.toContain(k.slice(8));
  });
  it('reads bearer or X-API-Key headers', () => {
    expect(readApiKey(new Headers({ authorization: 'Bearer bs_live_x' }))).toBe('bs_live_x');
    expect(readApiKey(new Headers({ 'x-api-key': 'bs_live_y' }))).toBe('bs_live_y');
    expect(readApiKey(new Headers())).toBeNull();
  });
  it('leads-only keys cannot read records', () => {
    expect(hasScope(API_ACCESS_LEVELS.leads_only, 'records:read')).toBe(false);
    expect(hasScope(API_ACCESS_LEVELS.leads_only, 'leads:write')).toBe(true);
    expect(hasScope(API_ACCESS_LEVELS.read_write, 'records:read')).toBe(true);
  });
  it('requires name and mobile on leads', () => {
    expect(apiLeadSchema.safeParse({ name: 'Sam' }).success).toBe(false);
    expect(apiLeadSchema.safeParse({ name: 'Sam', mobile: '0412345678', email: '' }).success).toBe(true);
  });
  it('attributes Meta sources', () => {
    expect(apiSourceChannel('Meta (via Make.com)')).toBe('meta');
    expect(apiSourceChannel('Facebook lead ad')).toBe('meta');
    expect(apiSourceChannel('Zapier')).toBe('unknown');
  });
});

import { apiSocialCommentSchema, API_ACCESS_LEVELS as LEVELS } from './api-keys';
describe('social comment inbox', () => {
  it('requires comment_id and comment_text', () => {
    expect(apiSocialCommentSchema.safeParse({ comment_text: 'hi' }).success).toBe(false);
    expect(apiSocialCommentSchema.safeParse({ comment_id: '1', comment_text: 'hi' }).data?.platform).toBe('facebook');
  });
  it('lead-only keys cannot use the comment inbox', () => {
    expect(LEVELS.leads_only).not.toContain('social:write');
    expect(LEVELS.social_comments).toEqual(['social:write']);
  });
});
