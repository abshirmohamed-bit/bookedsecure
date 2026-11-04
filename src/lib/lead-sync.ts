import { z } from 'zod';

/**
 * Facebook lead sync helpers shared by the settings screen, server routes and tests.
 * The bridge today is a per-business Make scenario; the same runs/items/checkpoints
 * are designed to serve a direct Meta connection later.
 */
export const LEAD_SYNC_INTERVAL_MINUTES = 5;
/** Re-read this much before each form's checkpoint so late-delivered leads are not missed. */
export const LEAD_SYNC_OVERLAP_MINUTES = 15;
/** A run with no activity for this long is treated as lost and can be retried. */
export const LEAD_SYNC_STALE_MINUTES = 20;
/** Automatic checks pause after this many consecutive failed triggers. */
export const LEAD_SYNC_MAX_FAILURES = 5;
export const LEAD_SYNC_LOOKBACK_OPTIONS = [1, 7, 14, 30, 90] as const;

/** Only Make's own webhook hosts may be called, so the URL cannot target anything else. */
export function isAllowedTriggerUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' && /^hook\.[a-z0-9-]+\.make\.com$/i.test(u.hostname) && /^\/[A-Za-z0-9_-]{8,}$/.test(u.pathname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

export const saveConnectionSchema = z.object({
  trigger_url: z.string().trim().max(300).refine(isAllowedTriggerUrl, 'Paste the Make webhook address (https://hook.…make.com/…).').optional(),
  auto_sync_enabled: z.boolean().optional(),
  initial_lookback_days: z.number().int().refine((n) => (LEAD_SYNC_LOOKBACK_OPTIONS as readonly number[]).includes(n)).optional(),
});

const fieldDataSchema = z.array(z.object({ name: z.string().max(120), values: z.array(z.string().max(500)).max(10).optional().default([]) })).max(60);

export const syncLeadSchema = z.object({
  meta_lead_id: z.string().trim().min(1).max(64),
  form_id: z.string().trim().max(64).optional().nullable(),
  form_name: z.string().trim().max(120).optional().nullable(),
  page_id: z.string().trim().max(64).optional().nullable(),
  created_time: z.string().trim().max(40).optional().nullable(),
  field_data: fieldDataSchema.optional().nullable(),
  name: z.string().max(200).optional().nullable(),
  mobile: z.string().max(200).optional().nullable(),
  email: z.string().max(200).optional().nullable(),
});
export type SyncLeadInput = z.infer<typeof syncLeadSchema>;

export const syncBatchSchema = z.object({
  leads: z.array(syncLeadSchema).max(100).optional().default([]),
  final: z.boolean().optional().default(false),
  error: z.string().trim().max(500).optional().nullable(),
});

const NAME_KEYS = ['full_name', 'fullname', 'name', 'your_name'];
const FIRST_KEYS = ['first_name', 'firstname'];
const LAST_KEYS = ['last_name', 'lastname', 'surname'];
const PHONE_KEYS = ['phone_number', 'phone', 'mobile', 'mobile_number', 'mobile_phone', 'contact_number'];
const EMAIL_KEYS = ['email', 'email_address', 'work_email'];

const norm = (k: string) => k.trim().toLowerCase().replace(/[\s-]+/g, '_');
function first(fields: Map<string, string[]>, keys: string[]): string | null {
  for (const k of keys) { const v = fields.get(k)?.find((x) => x.trim()); if (v) return v.trim(); }
  return null;
}

/** Meta's Lead Ads Testing Tool fills fields with "<test lead: dummy data for …>". */
export function isMetaPlaceholder(value: string | null | undefined): boolean {
  return Boolean(value && /<\s*test lead/i.test(value));
}

export type MappedLead = { name: string | null; mobile: string | null; email: string | null };

/** Takes the first value of each field, from Meta's raw field_data or flat fields. */
export function mapLeadFields(lead: SyncLeadInput): MappedLead {
  const fields = new Map<string, string[]>();
  for (const f of lead.field_data ?? []) fields.set(norm(f.name), f.values ?? []);
  const joined = [first(fields, FIRST_KEYS), first(fields, LAST_KEYS)].filter(Boolean).join(' ');
  const name = lead.name?.trim() || first(fields, NAME_KEYS) || joined || null;
  return {
    name,
    mobile: lead.mobile?.trim() || first(fields, PHONE_KEYS),
    email: lead.email?.trim() || first(fields, EMAIL_KEYS),
  };
}

export type LeadCheck = { ok: true; lead: MappedLead } | { ok: false; reason: string };

/** Validation that never needs a retry: these leads are recorded as skipped with a reason. */
export function checkLead(lead: SyncLeadInput): LeadCheck {
  const m = mapLeadFields(lead);
  if ([m.name, m.mobile, m.email].some(isMetaPlaceholder)) return { ok: false, reason: 'Meta test lead (dummy data).' };
  if (!m.name) return { ok: false, reason: 'No name on the form submission.' };
  if (!m.mobile) return { ok: false, reason: 'No phone number on the form submission.' };
  const digits = m.mobile.replace(/\D/g, '');
  if (digits.length < 8 || m.mobile.length > 20) return { ok: false, reason: 'Phone number is not valid.' };
  const email = m.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email) ? m.email : null;
  return { ok: true, lead: { name: m.name.slice(0, 80), mobile: m.mobile, email } };
}

export const metaExternalId = (metaLeadId: string) => `facebook-lead:${metaLeadId}`;

/** Where each form's next import starts: its checkpoint minus overlap, else the first-import lookback. */
export function computeSince(checkpoint: string | null, lookbackDays: number, now = new Date()): Date {
  if (checkpoint) return new Date(new Date(checkpoint).getTime() - LEAD_SYNC_OVERLAP_MINUTES * 60_000);
  return new Date(now.getTime() - lookbackDays * 86_400_000);
}

export function parseSubmittedAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Completed when nothing failed; partial when any lead needs another attempt. */
export function finalRunStatus(failed: number, callerError: string | null | undefined): 'completed' | 'partial' | 'failed' {
  if (callerError) return failed ? 'failed' : 'partial';
  return failed ? 'partial' : 'completed';
}
