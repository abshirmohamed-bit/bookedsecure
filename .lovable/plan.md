# Tenant quote forms, request routing, supervised AI

Incremental extension of the existing quote flow. One quote form, one lead-creation path (`captureLead`), one automation engine — nothing forked.

## 1. Reuse (extended, not replaced)

- `src/routes/quote.tsx` → becomes `src/routes/quote.$slug.tsx` (same component, same steps, same consent copy). `/quote` stays as a small redirect/not-found shim so existing links don't break.
- `src/lib/public.functions.ts` → `submitQuoteRequest` keeps its honeypot, rate limit, AU-mobile check; gains `slug`, `request_type`, service/flexible selection and full attribution.
- `src/lib/lead-engine.server.ts` → `captureLead` gains optional structured fields plus an idempotency key. Its existing 30-minute tenant-scoped duplicate check stays as-is and remains the only duplicate logic.
- `src/lib/ai.server.ts` → `analyseLead` keeps `guardReply` and the approved-catalogue-only prompt; gains request type, selected service snapshot and flexible-request text as context, plus a `manual_review_required` flag for flexible requests. Still draft-only.
- `src/components/settings/sections.tsx` + `src/routes/settings.business.tsx` → new read-mostly "Public quote form" card; existing `BusinessSettingsForm` / `ServicesEditor` and their owner checks unchanged.
- `src/lib/app-context.server.ts` (`requireAppContext`, `requireOwner`), `src/lib/domain.ts` (`normaliseAuMobile`), rate limiter, consent events, audit events, jobs/automation, quiet hours, STOP handling, usage caps, Telnyx adapters, delivery webhooks: untouched.

## 2. New files

- `src/routes/quote.$slug.tsx` — tenant public form (request-type step first, then approved service vs "Something else or not sure").
- `src/lib/tenant-slug.ts` — pure slug normalisation/validation helpers (unit-testable).
- `src/lib/quote-form.ts` — pure: request-type definitions, per-type required-field rules, attribution capture/merge, idempotency-key derivation.
- `src/lib/quote-form.server.ts` — server-only slug → tenant resolution (active tenants only) returning branding, services, form config.
- `src/lib/quote-form.test.ts`, `src/lib/tenant-slug.test.ts` — validation, attribution preservation, request types, idempotency, exclusion rules.

## 3. Migration (genuinely required — current schema can't store this)

One additive migration, no backfill of lead content:

- `businesses.slug text unique` (+ `logo_url text`, `quote_form_active boolean default true`, `flexible_requests_enabled boolean default true`); Glocast gets slug `glocast`.
- `services.qualification_note text` (vehicle size / inspection required).
- `leads.request_type text` (check: `quote | service | recommendation`), `leads.approved_service_id uuid references services(id)`, `leads.service_name_snapshot text`, `leads.flexible_request_text text`, `leads.requires_owner_review boolean default false`.
- `leads_lead_origin_check` extended with `inbound_form`; form leads are written as `lead_origin = 'inbound_form'` so imported leads can never be selected by the new paths.
- Attribution beyond the existing `utm_source` / `utm_campaign` / `source_campaign` columns (utm_medium, utm_content, ad id, campaign id, referrer, landing page, tenant slug) goes into the existing `source_metadata` jsonb — no new columns.
- GRANTs unchanged for existing tables; no new tables, so no new RLS surface. `leads.external_id` gets the form idempotency key with a `form:` prefix, keeping CRM `import:` keys distinct.

## 4. Unchanged behaviour

Import/CRM safety controls, rollout modes, commit gates, staged rows, SMS provider behaviour, STOP, quiet hours, usage caps, delivery webhooks, audit logging, reachability, suppression recovery, existing tests. Master automation switch stays **off**; nothing in this change enables it. Step 0 acknowledgement will only ever fire for `lead_origin = 'inbound_form'` non-flexible leads once you enable it manually.

## 5. Risks

- Slug uniqueness: enforced by a unique index; resolution is server-side only and returns not-found rather than any fallback tenant.
- `lead_origin` check constraint change is additive; existing rows unaffected.
- `/quote` link change: old path redirects, so Meta links keep working while you switch the CTA to `/quote/glocast`.

## 6. Verification

Full test suite, typecheck, production build. No live Glocast lead is modified, no SMS, no provider call, no rollout-mode change.
