import { z } from 'zod';

/** Public API key helpers shared by the settings page, server routes and tests. */
export const API_KEY_PREFIX = 'bs_live_';
export const API_SCOPES = ['leads:write', 'records:read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_ACCESS_LEVELS = {
  leads_only: ['leads:write'],
  read_write: ['leads:write', 'records:read'],
} as const satisfies Record<string, readonly ApiScope[]>;
export type ApiAccessLevel = keyof typeof API_ACCESS_LEVELS;
export const API_RATE_LIMIT_PER_MINUTE = 60;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  access: z.enum(['leads_only', 'read_write']),
});

export function generateApiKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const body = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${API_KEY_PREFIX}${body}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isWellFormedApiKey(key: string): boolean {
  return /^bs_live_[0-9a-f]{64}$/.test(key);
}

/** Reads `Authorization: Bearer <key>` or `X-API-Key: <key>`. */
export function readApiKey(headers: Headers): string | null {
  const auth = headers.get('authorization');
  const fromAuth = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const key = (fromAuth ?? headers.get('x-api-key') ?? '').trim();
  return key || null;
}

export function hasScope(scopes: readonly string[], needed: ApiScope): boolean {
  return scopes.includes(needed);
}

const optionalText = (max: number) => z.string().trim().max(max).optional().nullable();

/** Body accepted by POST /api/public/v1/leads (Make.com, Zapier, custom code). */
export const apiLeadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().min(8).max(20),
  email: z.string().trim().email().max(120).optional().nullable().or(z.literal('')),
  suburb: optionalText(80),
  address: optionalText(200),
  service: optionalText(120),
  message: optionalText(1000),
  vehicle: optionalText(60),
  source: optionalText(40),
  campaign: optionalText(80),
  ad_name: optionalText(80),
  form_name: optionalText(80),
  consent: z.boolean().optional().default(false),
  external_id: optionalText(120),
});
export type ApiLeadInput = z.infer<typeof apiLeadSchema>;

/** Maps a free-text source to the lead source channel used across the app. */
export function apiSourceChannel(source: string | null | undefined): 'meta' | 'website' | 'unknown' {
  const s = (source ?? '').toLowerCase();
  if (/(meta|facebook|instagram|\bfb\b|\big\b)/.test(s)) return 'meta';
  if (/(website|web|site|form)/.test(s)) return 'website';
  return 'unknown';
}

export function clampLimit(raw: string | null, fallback = 25, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}
