# Tenant quote forms, request routing, supervised AI

Incremental extension of the existing quote flow. One quote form, one lead-creation path (`captureLead`), one automation engine — nothing forked. Revised to incorporate the five review corrections and the final rollout gate.

## 0. Verified facts (checked before writing this plan)

- Routing convention in `src/routes/` is flat dot-notation (`leads.$leadId.tsx`, `settings.business.tsx`). So `quote.$slug.tsx` **is** the existing convention — it extends `quote.tsx` with a slug parameter instead of competing with it. No nested folder or second router pattern is introduced.
- `leads.external_id` currently has a **non-unique** partial index: `leads_business_external_id_idx btree (business_id, external_id) WHERE external_id IS NOT NULL`. It therefore cannot be relied on for idempotency as-is (correction 3).
- `leads_lead_origin_check` allows `live | historical | reactivation | crm_import` (NULL permitted). Adding `inbound_form` is additive; every existing row already satisfies it.

## 1. Routes (correction 1 and 2)

- `src/routes/quote.tsx` → renamed to `src/routes/quote.$slug.tsx` (same component, steps, consent copy). Slug is validated and resolved server-side.
- New `src/routes/quote.index.tsx` for `/quote` with **no silent default**: it renders a "which business are you enquiring with?" / not-found state. Glocast is never inferred. If a legacy mapping is wanted, it comes from one explicit, configured legacy-slug constant that an owner sets deliberately — not a redirect baked into the route.
- Unresolvable, inactive, or unknown slug → `notFound()`, never a fallback tenant.

## 2. Reuse (extended, not replaced)

- `src/lib/public.functions.ts` → `submitQuoteRequest` keeps honeypot, rate limit, AU-mobile check; gains `slug`, `request_type`, service/flexible selection, full attribution, idempotency key.
- `src/lib/lead-engine.server.ts` → `captureLead` gains optional structured fields. Its existing 30-minute tenant-scoped duplicate check stays and remains the primary duplicate logic.
- `src/lib/ai.server.ts` → `analyseLead` keeps `guardReply` and the approved-catalogue-only prompt; gains request type, service snapshot and flexible-request text as context plus a `manual_review_required` flag. Still draft-only.
- `src/components/settings/sections.tsx` + `src/routes/settings.business.tsx` → new read-mostly "Public quote form" card; existing forms and owner checks unchanged.
- `app-context.server.ts`, `domain.ts`, rate limiter, consent events, audit events, jobs/automation, quiet hours, STOP, usage caps, Telnyx adapters, delivery webhooks: untouched.

## 3. New files

- `src/routes/quote.$slug.tsx`, `src/routes/quote.index.tsx`
- `src/lib/tenant-slug.ts` — pure slug normalisation/validation.
- `src/lib/quote-form.ts` — request types, per-type required fields, attribution merge, deterministic idempotency-key derivation.
- `src/lib/quote-form.server.ts` — server-only slug → tenant resolution (active tenants only).
- `src/lib/quote-form.test.ts`, `src/lib/tenant-slug.test.ts`.

## 4. Idempotency (correction 3)

The form key is stored in `leads.external_id` with a `form:` prefix **and backed by a real constraint**, added in the migration:

```
create unique index leads_business_external_id_unique
  on public.leads (business_id, external_id) where external_id is not null;
```

Key properties, each covered by a test:
- Deterministic — derived from tenant id + normalised mobile + request type + a client-generated submission nonce held for the life of the form session, so a retry of the *same* submission produces the same key.
- Unique per legitimate submission — a genuinely new enquiry carries a new nonce, so a returning customer is never collapsed into an old lead.
- Tenant-scoped — the unique index is `(business_id, external_id)`; cross-tenant collision is impossible.
- Retry-safe under concurrency — insert relies on the unique index, and a unique-violation is caught and resolved by reading back the existing lead. No upsert, no update of lead content: an existing lead can never be overwritten.
- The pre-existing non-unique index is replaced by the unique one after a duplicate check confirms no current `(business_id, external_id)` pair repeats.

## 5. Service history (correction 4)

- `leads.approved_service_id uuid references public.services(id) on delete set null` — deleting or archiving a service never blocks or breaks a historical lead.
- `leads.service_name_snapshot text` is written at capture time and is the **historical source of truth** shown in the lead detail, inbox and AI context. Renames and archival of the live service record do not change what a past lead displays.
- The live service is only used for current-form rendering and for the AI catalogue; a lead is always readable without it.
- Cross-tenant safety: the submitted service id is verified to belong to the resolved tenant before capture; a mismatch is rejected, never silently dropped.

## 6. Migration (additive) and its verification (correction 5)

Additive migration:
- `businesses`: `slug text unique`, `logo_url text`, `quote_form_active boolean not null default true`, `flexible_requests_enabled boolean not null default true`. Glocast gets slug `glocast`.
- `services`: `qualification_note text` (nullable — no fabricated content).
- `leads`: `request_type text` (check allows NULL plus `quote | service | recommendation`), `approved_service_id`, `service_name_snapshot`, `flexible_request_text`, `requires_owner_review boolean not null default false`.
- `leads_lead_origin_check` extended with `inbound_form`.
- Unique partial index on `(business_id, external_id)`.
- Extra attribution (utm_medium, utm_content, ad/campaign ids, referrer, landing page, tenant slug) goes into existing `source_metadata` jsonb — no new columns.
- No new tables, so no new RLS surface; existing table GRANTs unchanged.

Post-migration verification queries, reported before any code depends on them:
1. Every existing row satisfies the new `lead_origin` check (count of violating rows = 0).
2. `request_type` is NULL for all pre-existing leads — no fabricated request type, no backfill.
3. Imported leads keep `lead_origin = 'crm_import'`; count unchanged before/after.
4. `services.qualification_note` is NULL everywhere; `businesses` boolean defaults applied without changing tenant intent; only Glocast has a slug.
5. No lead references a `services` row from another tenant (`join` check returns 0), and the FK is `on delete set null`.
6. RLS remains enabled on `leads`, `services`, `businesses` with unchanged policy count; every new field is written only through server-side paths that resolve the tenant from the server context, never from a browser-supplied business id.

## 7. Unchanged behaviour

Import/CRM safety controls, rollout modes, commit gates, staged rows, SMS provider behaviour, STOP, quiet hours, usage caps, delivery webhooks, audit logging, reachability, suppression recovery, existing tests.

## 8. Final implementation gate

- The automation master switch is **not** enabled as part of this implementation.
- After deployment, the public quote flow is verified first with a synthetic, non-sending fixture / dry run: tenant resolution, service loading, request routing, attribution, consent, duplicate prevention and lead creation are confirmed with no SMS sent, no provider call, and no modification of real Glocast customer records.
- Only after you manually verify the deployed behaviour may Step 0 acknowledgement be enabled. Steps 1 and 2 stay disabled.
- The first production test must be a genuinely new inbound enquiry submitted during business hours. Imported leads, existing Glocast leads and the previous canary number are ineligible.

## 9. Verification

Full test suite, typecheck, production build, plus the section 6 database checks. No live Glocast lead modified, no SMS, no provider call, no rollout-mode change.
