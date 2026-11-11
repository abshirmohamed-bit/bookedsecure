import { z } from 'zod';

/** Public API key helpers shared by the settings page, server routes and tests. */
export const API_KEY_PREFIX = 'bs_live_';
export const API_SCOPES = ['leads:write', 'records:read', 'social:write', 'bookings:write'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_ACCESS_LEVELS = {
  leads_only: ['leads:write'],
  read_write: ['leads:write', 'records:read'],
  social_comments: ['social:write'],
  /** A website's own quote and booking screens: options, quote, availability and book. */
  website_booking: ['bookings:write'],
  full: ['leads:write', 'records:read', 'social:write', 'bookings:write'],
} as const satisfies Record<string, readonly ApiScope[]>;
export type ApiAccessLevel = keyof typeof API_ACCESS_LEVELS;
export const API_RATE_LIMIT_PER_MINUTE = 60;

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(60),
  access: z.enum(['leads_only', 'read_write', 'social_comments', 'website_booking', 'full']),
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

/** Body accepted by POST /api/public/v1/leads (Zapier, n8n, website forms, custom code). */
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

export const BOOKING_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;

export type ApiListFilters = { limit: number; offset: number; from: string | null; to: string | null; status: string | null; search: string };

/** Reads limit, offset, from, to, status and search from a list request. A bad date or status is refused rather than ignored, so a caller never mistakes unfiltered records for filtered ones. */
export function readListFilters(params: URLSearchParams, statuses: readonly string[]): { ok: true; filters: ApiListFilters } | { ok: false; message: string } {
  const readDate = (name: 'from' | 'to'): string | null | undefined => {
    const raw = params.get(name)?.trim();
    if (!raw) return null;
    if (Number.isNaN(Date.parse(raw))) return undefined;
    // "to=2026-11-11" means up to the end of that day.
    return new Date(name === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.999Z` : raw).toISOString();
  };
  const from = readDate('from');
  const to = readDate('to');
  if (from === undefined || to === undefined) return { ok: false, message: 'from and to must be dates, for example 2026-11-01 or 2026-11-01T09:00:00Z.' };
  const status = params.get('status')?.trim() || null;
  if (status && !statuses.includes(status)) return { ok: false, message: `status must be one of: ${statuses.join(', ')}.` };
  return { ok: true, filters: {
    limit: clampLimit(params.get('limit')),
    offset: Math.max(0, Math.floor(Number(params.get('offset')) || 0)),
    from, to, status,
    search: (params.get('search') ?? '').trim().slice(0, 80).replace(/[,()%*\\]/g, ' ').trim(),
  } };
}

export function clampLimit(raw: string | null, fallback = 25, max = 100): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Body accepted by POST /api/public/v1/social-comments (Make.com comment review). */
export const apiSocialCommentSchema = z.object({
  platform: z.string().trim().toLowerCase().max(20).optional().default('facebook'),
  comment_id: z.string().trim().min(1).max(120),
  comment_text: z.string().trim().min(1).max(4000),
  comment_author: optionalText(120),
  comment_url: z.string().trim().url().max(500).optional().nullable().or(z.literal('')),
  original_post_id: optionalText(120),
  original_post_text: optionalText(4000),
  sentiment: optionalText(30),
  needs_response: z.boolean().optional().default(true),
  response_reason: optionalText(500),
  draft_response: optionalText(2000),
  created_at: z.string().trim().max(40).optional().nullable(),
});
export type ApiSocialCommentInput = z.infer<typeof apiSocialCommentSchema>;

export const apiPostedResultSchema = z.object({
  success: z.boolean(),
  error: optionalText(500),
});
