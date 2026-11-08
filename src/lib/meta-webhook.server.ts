import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Facebook Lead Ads webhooks: Facebook calls /api/public/meta/webhook the moment
 * a lead is submitted on a connected Page. Every POST is authenticated with the
 * X-Hub-Signature-256 HMAC (keyed by the app secret), so only Facebook can trigger
 * an import. The verify token only answers Facebook's one-off subscription check
 * and is not a secret.
 */
export const META_WEBHOOK_PATH = '/api/public/meta/webhook';
export const DEFAULT_WEBHOOK_VERIFY_TOKEN = 'bookedsecure-leadgen-v1';
const MAX_EVENTS = 25;

export function webhookVerifyToken(): string {
  return process.env['META_WEBHOOK_VERIFY_TOKEN']?.trim() || DEFAULT_WEBHOOK_VERIFY_TOKEN;
}

/** Facebook's subscription handshake: echo the challenge only for our token. */
export function verifySubscription(params: URLSearchParams, token = webhookVerifyToken()): string | null {
  if (params.get('hub.mode') !== 'subscribe' || params.get('hub.verify_token') !== token) return null;
  const challenge = params.get('hub.challenge') ?? '';
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}

/** Constant-time check of `X-Hub-Signature-256: sha256=<hex>` over the raw body. */
export function validSignature(rawBody: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const payload = z.object({
  object: z.string(),
  entry: z.array(z.object({
    id: z.string().optional(),
    changes: z.array(z.object({
      field: z.string(),
      value: z.object({ leadgen_id: z.union([z.string(), z.number()]).optional(), page_id: z.union([z.string(), z.number()]).optional() }).passthrough(),
    })).optional(),
  })).default([]),
});

export type LeadgenEvent = { pageId: string; leadgenId: string };

/** The distinct new-lead events in a webhook body (capped, ids validated). */
export function parseLeadgenEvents(body: unknown): LeadgenEvent[] {
  const parsed = payload.safeParse(body);
  if (!parsed.success || parsed.data.object !== 'page') return [];
  const seen = new Set<string>();
  const events: LeadgenEvent[] = [];
  for (const entry of parsed.data.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = String(change.value.leadgen_id ?? '');
      const pageId = String(change.value.page_id ?? entry.id ?? '');
      if (!/^\d{3,40}$/.test(leadgenId) || !/^\d{3,40}$/.test(pageId) || seen.has(leadgenId)) continue;
      seen.add(leadgenId);
      events.push({ pageId, leadgenId });
      if (events.length >= MAX_EVENTS) return events;
    }
  }
  return events;
}
