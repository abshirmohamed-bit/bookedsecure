import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaConnectError, buildLoginUrl, decryptMetaToken, encryptMetaToken, exchangeCodeForPages, readMetaAppConfig, signState, tokenContext, verifyState, META_CALLBACK_PATH } from './meta-oauth.server';

const BIZ = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

beforeEach(() => {
  vi.stubEnv('TENANT_AI_ENCRYPTION_SECRET', 'test-only-secret');
  vi.stubEnv('META_APP_ID', '1234');
  vi.stubEnv('META_APP_SECRET', 'app-secret-test');
  vi.stubEnv('META_LOGIN_CONFIG_ID', '');
  vi.stubEnv('PUBLIC_APP_URL', 'https://app.example');
  vi.stubEnv('META_GRAPH_VERSION', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('Facebook connection security', () => {
  it('encrypts Page tokens bound to the business and Page', () => {
    const sealed = encryptMetaToken('page-token', tokenContext(BIZ, '111'));
    expect(sealed).not.toContain('page-token');
    expect(decryptMetaToken(sealed, tokenContext(BIZ, '111'))).toBe('page-token');
    expect(() => decryptMetaToken(sealed, tokenContext(BIZ, '222'))).toThrow('reconnected');
    expect(() => decryptMetaToken(sealed, tokenContext(USER, '111'))).toThrow('reconnected');
  });
  it('accepts a signed state once issued and rejects tampering or expiry', () => {
    const now = Date.now();
    const state = signState({ businessId: BIZ, userId: USER }, now);
    expect(verifyState(state, now + 60_000)).toEqual({ businessId: BIZ, userId: USER });
    expect(verifyState(state, now + 16 * 60_000)).toBeNull();
    const [body, sig] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ b: USER, u: USER, e: now + 60_000 })).toString('base64url');
    expect(verifyState(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyState(`${body}.x${sig}`, now)).toBeNull();
    expect(verifyState('garbage', now)).toBeNull();
  });
  it('builds the login address with the platform app, callback and scopes', () => {
    const url = new URL(buildLoginUrl(readMetaAppConfig(), 'STATE'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1234');
    expect(url.searchParams.get('redirect_uri')).toBe(`https://app.example${META_CALLBACK_PATH}`);
    expect(url.searchParams.get('scope')).toContain('leads_retrieval');
    expect(url.toString()).not.toContain('app-secret-test');
  });
  it('uses a Login for Business configuration when one is set', () => {
    vi.stubEnv('META_LOGIN_CONFIG_ID', '777');
    const url = new URL(buildLoginUrl(readMetaAppConfig(), 'STATE'));
    expect(url.searchParams.get('config_id')).toBe('777');
    expect(url.searchParams.has('scope')).toBe(false);
  });
  it('refuses to start without platform app credentials', () => {
    vi.stubEnv('META_APP_SECRET', '');
    expect(() => buildLoginUrl(readMetaAppConfig(), 'STATE')).toThrow('META_APP_ID');
  });
});

describe('exchanging the Facebook login for Page tokens', () => {
  function fakeGraph(opts: { accounts?: unknown[]; granted?: string[]; pages?: Record<string, unknown> }) {
    return vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      const path = url.pathname.replace('/v27.0/', '');
      if (path === 'oauth/access_token') return Response.json({ access_token: url.searchParams.get('grant_type') ? 'long-user-token' : 'short-user-token' });
      if (path === 'me/accounts') return Response.json({ data: opts.accounts ?? [] });
      if (path === 'debug_token') return Response.json({ data: { granular_scopes: [{ scope: 'leads_retrieval', target_ids: opts.granted ?? [] }] } });
      const page = opts.pages?.[path];
      return page ? Response.json(page) : Response.json({ error: { code: 100 } }, { status: 400 });
    });
  }
  it('exchanges for a long-lived token and returns managed Pages', async () => {
    const fetcher = fakeGraph({ accounts: [{ id: '111', name: 'Page A', access_token: 'page-a-token' }] });
    expect(await exchangeCodeForPages(readMetaAppConfig(), 'CODE', fetcher as typeof fetch)).toEqual([{ id: '111', name: 'Page A', token: 'page-a-token' }]);
    const meCall = fetcher.mock.calls.map((c) => new URL(String(c[0]))).find((u) => u.pathname.endsWith('me/accounts'))!;
    expect(meCall.searchParams.get('access_token')).toBe('long-user-token');
  });
  it('finds Pages shared through a business portfolio via the login grants', async () => {
    const fetcher = fakeGraph({ accounts: [], granted: ['222'], pages: { '222': { id: '222', name: 'Portfolio Page', access_token: 'page-b-token' } } });
    expect(await exchangeCodeForPages(readMetaAppConfig(), 'CODE', fetcher as typeof fetch)).toEqual([{ id: '222', name: 'Portfolio Page', token: 'page-b-token' }]);
  });
  it('tags a refused code exchange with the step and Facebook codes, never secrets', async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { code: 100, error_subcode: 36007, message: 'secret-ish provider text' } }, { status: 400 }));
    const err = await exchangeCodeForPages(readMetaAppConfig(), 'CODE', fetcher as typeof fetch).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaConnectError);
    expect((err as MetaConnectError).reason).toBe('token-100-36007');
    expect(String((err as Error).message)).not.toMatch(/app-secret-test|provider text/);
  });
  it('still finds granted Pages when the Page list itself fails', async () => {
    const base = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname.replace('/v27.0/', '');
      if (path === 'oauth/access_token') return Response.json({ access_token: 'user-token-xyz' });
      if (path === 'me/accounts') return Response.json({ error: { code: 200 } }, { status: 403 });
      if (path === 'debug_token') return Response.json({ data: { granular_scopes: [{ scope: 'pages_show_list', target_ids: ['333'] }] } });
      return Response.json({ id: '333', name: 'Granted Page', access_token: 'page-c-token' });
    });
    expect(await exchangeCodeForPages(readMetaAppConfig(), 'CODE', base as typeof fetch)).toEqual([{ id: '333', name: 'Granted Page', token: 'page-c-token' }]);
  });
  it('keeps the long-lived user token and its expiry for ad spend', async () => {
    const { exchangeCodeForAccess } = await import('./meta-oauth.server');
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname.replace('/v27.0/', '');
      if (path === 'oauth/access_token') return Response.json({ access_token: new URL(String(input)).searchParams.get('grant_type') ? 'long-user-token' : 'short-user-token' });
      if (path === 'me/accounts') return Response.json({ data: [{ id: '111', name: 'Page A', access_token: 'page-a-token' }] });
      if (path === 'debug_token') return Response.json({ data: { expires_at: 1799000000, granular_scopes: [] } });
      return Response.json({ error: { code: 100 } }, { status: 400 });
    });
    const access = await exchangeCodeForAccess(readMetaAppConfig(), 'CODE', fetcher as typeof fetch);
    expect(access.userToken).toBe('long-user-token');
    expect(access.userTokenExpiresAt).toBe(new Date(1799000000 * 1000).toISOString());
    expect(access.pages).toHaveLength(1);
  });
  it('returns nothing when no Page was shared', async () => {
    expect(await exchangeCodeForPages(readMetaAppConfig(), 'CODE', fakeGraph({}) as typeof fetch)).toEqual([]);
  });
});
