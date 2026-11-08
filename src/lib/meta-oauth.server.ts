import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Per-business Facebook connection for direct lead import.
 *
 * An owner signs in with Facebook (Facebook Login for Business) and picks a Page.
 * BookedSecure keeps only that Page's access token, encrypted and bound to the
 * business and Page, in a server-only table. Platform-level app credentials come
 * from server secrets; nothing tenant-specific lives in code.
 */

/** Graph API version used when META_GRAPH_VERSION is not set (verified with lead filtering). */
export const DEFAULT_GRAPH_VERSION = 'v27.0';
export const META_CALLBACK_PATH = '/api/public/meta/oauth/callback';
/** Requested when no Login for Business configuration id is set. */
export const META_SCOPES = ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_metadata', 'pages_manage_ads', 'pages_messaging', 'business_management', 'ads_read', 'ads_management'] as const;

export type MetaAppConfig = { appId?: string | undefined; appSecret?: string | undefined; configId?: string | undefined; version: string; appUrl: string };

export function readMetaAppConfig(): MetaAppConfig {
  const version = process.env['META_GRAPH_VERSION']?.trim() || DEFAULT_GRAPH_VERSION;
  return {
    appId: process.env['META_APP_ID']?.trim() || undefined,
    appSecret: process.env['META_APP_SECRET']?.trim() || undefined,
    configId: process.env['META_LOGIN_CONFIG_ID']?.trim() || undefined,
    version: /^v\d+\.\d+$/.test(version) ? version : DEFAULT_GRAPH_VERSION,
    appUrl: (process.env['PUBLIC_APP_URL']?.trim() || 'https://bookedsecure.com').replace(/\/+$/, ''),
  };
}

export function metaAppReady(config: MetaAppConfig): boolean {
  return Boolean(config.appId && config.appSecret && process.env['TENANT_AI_ENCRYPTION_SECRET']);
}

export function assertMetaAppReady(config: MetaAppConfig) {
  if (!config.appId || !config.appSecret) throw new Error('Facebook connections are not set up on this platform yet (META_APP_ID / META_APP_SECRET).');
  if (!process.env['TENANT_AI_ENCRYPTION_SECRET']) throw new Error('Secure token storage is unavailable.');
}

// ----- Encryption (AES-256-GCM, key separated from AI key storage) -----

function tokenKey() {
  const secret = process.env['TENANT_AI_ENCRYPTION_SECRET'];
  if (!secret) throw new Error('Secure token storage is unavailable.');
  return createHash('sha256').update(`meta-lead-token:${secret}`).digest();
}

export const tokenContext = (businessId: string, pageId: string) => `meta-page:${businessId}:${pageId}`;

export function encryptMetaToken(value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptMetaToken(value: string, context: string): string {
  try {
    const data = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', tokenKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new Error('The Facebook connection needs to be reconnected.'); }
}

// ----- Signed OAuth state: binds the callback to the owner who started it -----

const STATE_TTL_MS = 15 * 60_000;
function stateKey() { return createHash('sha256').update(`meta-oauth-state:${process.env['TENANT_AI_ENCRYPTION_SECRET'] ?? ''}`).digest(); }

export function signState(payload: { businessId: string; userId: string }, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ b: payload.businessId, u: payload.userId, e: now + STATE_TTL_MS, n: randomBytes(8).toString('hex') })).toString('base64url');
  const sig = createHmac('sha256', stateKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(state: string, now = Date.now()): { businessId: string; userId: string } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', stateKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const parsed = z.object({ b: z.string().uuid(), u: z.string().uuid(), e: z.number() }).safeParse((() => { try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; } })());
  if (!parsed.success || parsed.data.e < now) return null;
  return { businessId: parsed.data.b, userId: parsed.data.u };
}

export function buildLoginUrl(config: MetaAppConfig, state: string): string {
  assertMetaAppReady(config);
  const url = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  url.searchParams.set('client_id', config.appId!);
  url.searchParams.set('redirect_uri', `${config.appUrl}${META_CALLBACK_PATH}`);
  url.searchParams.set('state', state);
  url.searchParams.set('response_type', 'code');
  if (config.configId) url.searchParams.set('config_id', config.configId);
  else url.searchParams.set('scope', META_SCOPES.join(','));
  return url.toString();
}

// ----- Graph calls used during connection -----

export type MetaPageCandidate = { id: string; name: string; token: string };

/**
 * A connection failure tagged with the step and Facebook's numeric error code,
 * so the owner (and support) can see where it broke. Never carries tokens,
 * secrets or provider message text.
 */
export class MetaConnectError extends Error {
  constructor(message: string, readonly step: string, readonly graphCode?: number, readonly graphSubcode?: number) { super(message); }
  get reason(): string { return [this.step, this.graphCode, this.graphSubcode].filter((x) => x !== undefined).join('-'); }
}

async function graphGet(config: MetaAppConfig, path: string, params: Record<string, string>, fetcher: typeof fetch, step = 'graph'): Promise<unknown> {
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try { res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000) }); } catch { throw new MetaConnectError('Facebook could not be reached. Please try again.', `${step}_unreachable`); }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body || (typeof body === 'object' && 'error' in body)) {
    const err = z.object({ error: z.object({ code: z.number().optional(), error_subcode: z.number().optional() }) }).safeParse(body);
    throw new MetaConnectError('Facebook did not accept the connection. Please try again.', step, err.success ? err.data.error.code : res.status, err.success ? err.data.error.error_subcode : undefined);
  }
  return body;
}

const tokenResponse = z.object({ access_token: z.string().min(10) });
const pageWithToken = z.object({ id: z.string().regex(/^\d+$/), name: z.string().default(''), access_token: z.string().min(10).optional() });

/**
 * Exchanges the login code for a long-lived user token, then finds the Pages the
 * owner granted. Page tokens derived from a long-lived user token do not expire.
 * Pages shared through a business portfolio are missing from me/accounts, so the
 * login's granular grants are used as a second source.
 */
export async function exchangeCodeForPages(config: MetaAppConfig, code: string, fetcher: typeof fetch = fetch): Promise<MetaPageCandidate[]> {
  assertMetaAppReady(config);
  const redirect = `${config.appUrl}${META_CALLBACK_PATH}`;
  const short = tokenResponse.safeParse(await graphGet(config, 'oauth/access_token', { client_id: config.appId!, client_secret: config.appSecret!, redirect_uri: redirect, code }, fetcher, 'token'));
  if (!short.success) throw new MetaConnectError('Facebook did not return a sign-in token.', 'token_shape');
  const long = tokenResponse.safeParse(await graphGet(config, 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: config.appId!, client_secret: config.appSecret!, fb_exchange_token: short.data.access_token }, fetcher, 'longtoken'));
  if (!long.success) throw new MetaConnectError('Facebook did not return a long-lived token.', 'longtoken_shape');
  const userToken = long.data.access_token;

  const pages = new Map<string, MetaPageCandidate>();
  // A failed Page list is not fatal: Pages may still come from the login's granted assets.
  const accounts = z.object({ data: z.array(pageWithToken) }).safeParse(await graphGet(config, 'me/accounts', { fields: 'id,name,access_token', limit: '100', access_token: userToken }, fetcher, 'pages').catch(() => null));
  if (accounts.success) for (const p of accounts.data.data) if (p.access_token) pages.set(p.id, { id: p.id, name: p.name, token: p.access_token });

  const debug = z.object({ data: z.object({ granular_scopes: z.array(z.object({ scope: z.string(), target_ids: z.array(z.string()).optional() })).optional() }) })
    .safeParse(await graphGet(config, 'debug_token', { input_token: userToken, access_token: `${config.appId}|${config.appSecret}` }, fetcher).catch(() => null));
  const granted = new Set<string>();
  if (debug.success) for (const g of debug.data.data.granular_scopes ?? []) if (['leads_retrieval', 'pages_show_list', 'pages_read_engagement'].includes(g.scope)) for (const id of g.target_ids ?? []) granted.add(id);
  for (const id of granted) {
    if (pages.has(id) || !/^\d+$/.test(id)) continue;
    const page = pageWithToken.safeParse(await graphGet(config, id, { fields: 'id,name,access_token', access_token: userToken }, fetcher).catch(() => null));
    if (page.success && page.data.access_token) pages.set(page.data.id, { id: page.data.id, name: page.data.name, token: page.data.access_token });
  }
  return [...pages.values()].slice(0, 25);
}
