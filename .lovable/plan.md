# Phase 0 verification + approved-scope plan (BookedSecure / Glocast)

Read-only inspection is complete. Nothing has been changed.

## What exists today (verified in code and schema)

- Public quote page: `src/routes/quote.$slug.tsx` (+ `quote.index.tsx` no-default landing), tenant resolved server-side from the slug only in `src/lib/quote-form.server.ts`. `/quote/glocast` renders the 4-step manual form.
- Public submit: `submitQuoteRequest` in `src/lib/public.functions.ts` (honeypot, IP rate limit, AU mobile check, slug-scoped tenant, service ownership check, idempotency key, consent text) → `captureLead` in `src/lib/lead-engine.server.ts`.
- `captureLead` does: external_id retry reuse, 30-minute duplicate window, lead insert, conversation, owner alert job, then acknowledgement job → SMS. Skips ACK when mobile invalid, when `requires_owner_review`, or when form consent is missing.
- SMS safety: quiet hours, opt-out/STOP, suppression, reachability, usage caps, delivery observability, follow-up steps — all in `src/lib/sms/*` and `jobs.server.ts`.
- Owner side: dashboard, `leads.index.tsx`, `leads.$leadId.tsx`, settings routes, `AvailabilityEditor` + `saveAvailabilitySettings` (auth + `requireOwner`, tenant from server context), owner-invoked AI in `src/lib/ai.server.ts` with approved-facts guardrails.
- Schema: `businesses` (slug, logo_url, quote_form_active, flexible_requests_enabled, quiet hours, timezone, automation_enabled), `services` (description, price_guidance, qualification_note), `leads` (lead_origin, request_type, approved_service_id, service_name_snapshot, requires_owner_review, consent_record, source_metadata), `conversations`, `messages` (SMS-shaped: delivery_status, provider fields), `booking_availability`, `booking_offers`, `automation_rules`, jobs, usage, suppression.
- No quote-mode field, no public AI chat, no customer slot selection. Glocast has zero `booking_availability` rows.

### Confirmed acknowledgement defect

In `captureLead`, the active acknowledgement rule is read, then `resolveAcknowledgementTemplate(rule?.message_template)` returns the frozen template even when **no active rule exists**. So turning the acknowledgement rule off does not suppress the ACK — the job is still queued and sent. This is exactly the reported suppression bug and is a 5-line fix at that one site.

## 1. Files and routes

Existing files to extend
- `src/lib/lead-engine.server.ts` — ACK suppression fix (no active rule → no job, no send, lead still created); add an explicit non-SMS capture path for web-chat leads.
- `src/lib/public.functions.ts` — mode-aware public payload; new AI-chat server functions live in a new file, not here.
- `src/lib/quote-form.server.ts` — return the tenant's quote mode plus approved service display fields.
- `src/routes/quote.$slug.tsx` — thin mode switch: Manual (default) renders today's form untouched; AI renders the new chat component.
- `src/routes/settings.business.tsx` + `src/components/settings/sections.tsx` — Quote Page Settings card (two values only).
- `src/lib/app.functions.ts` — `saveQuotePageMode` (auth + `requireOwner`, tenant from server context, enum-validated).
- `src/routes/leads.$leadId.tsx`, `src/routes/leads.index.tsx`, `src/lib/lead-source.ts` — show AI origin, owner-review flag, and the web transcript.

New files
- `src/components/quote/AiQuoteChat.tsx` — branded tenant chat UI.
- `src/lib/quote-mode.ts` — the two-value enum, parse/fallback-to-manual helper (pure, tested).
- `src/lib/web-chat.functions.ts` — public server fns: start conversation, post message, finalise lead.
- `src/lib/web-chat.server.ts` — tenant-scoped persistence + AI turn via the existing gateway helper in `ai.server.ts`.
- `src/lib/web-chat.ts` — pure state machine: required fields, unsupported-request detection, completion/owner-review resolution.
- Tests: `quote-mode.test.ts`, `web-chat.test.ts`, `acknowledgement-suppression.test.ts`, `manual-quote-regression.test.ts`.

Protected from modification
- `src/integrations/supabase/*` (generated), `src/lib/sms/**`, `jobs.server.ts`, `usage.server.ts`, quiet-hours/suppression/opt-out/delivery code, `acknowledgement-contract.ts` frozen text, follow-up rules, CSV/import and commit-gate code, `booking_offers`/`availability.server.ts` booking paths, existing AI schema and guardrails.

## 2. Data fields

Reuse (no new column):
- Consent → `leads.consent_record`. Customer/vehicle/suburb/concerns → existing lead columns. Requested service → `approved_service_id` + `service_name_snapshot`; typed request → `flexible_request_text`. Owner review → `requires_owner_review`. Tenant → `business_id`. Attribution → `source_metadata`.

New (minimum):
- `businesses.quote_mode text not null default 'manual_sms'`, check in (`manual_sms`,`ai_chat`). Needed for the mode selector; default keeps every existing tenant, including Glocast, on Manual.
- `leads.lead_origin` gains allowed value `ai_web_chat` (check-constraint extension only; existing rows untouched, no backfill). This is the mode indicator.
- New `web_conversations` (business_id, lead_id nullable, status, consent_outcome, unsupported_request, requires_owner_review, completed_at, timestamps) and `web_conversation_messages` (business_id, conversation_id, role, body, created_at), both with GRANTs + RLS (tenant-scoped read for members, writes server-side only).
  Reason not to reuse `messages`: that table is SMS delivery state (provider ids, delivery_status, retries) and is what the SMS pipeline, usage counting and delivery webhooks scan. Writing web chat there is the single biggest risk of accidental SMS behaviour, so it is kept out.

## 3. Manual mode protection

Manual is the default and the fallback for missing/invalid/unloadable mode. The existing form component, validation, `submitQuoteRequest`, `captureLead` dedupe, consent text, billing, opt-out, quiet hours, suppression, delivery and follow-ups are not edited — the only manual-path change is the ACK-suppression correction. A regression test asserts the manual submit path still produces the same capture inputs and that AI chat controls never render in Manual mode. AI lead creation goes through an explicit non-SMS flag so it can never reach the ACK or follow-up enqueue.

## 4. Audit conflicts

- The prompt says reuse existing conversation structures for web chat; the audited `messages`/`conversations` tables are SMS-specific. Safest resolution: new web-chat tables (above), lead-linked, no SMS coupling. Flagging rather than silently deciding.
- The prompt asks for approved inclusions/exclusions/duration in the AI experience; `services` has only `description`, `price_guidance`, `qualification_note`. No fields will be invented: the AI shows what exists, and inclusions/exclusions/duration are reported as remaining work unless you want those columns added later.
- Price guidance today is AI-context only, never customer-facing. Displaying it publicly needs an explicit per-tenant opt-in, so it stays hidden until you ask for that flag.

## 5. Glocast availability

Yes — safely, via the existing `AvailabilityEditor` + `saveAvailabilitySettings` (authenticated, `requireOwner`, business id from server context, writes only `booking_availability`). It touches no SMS code and no historical rows. It is **not required** for this AI lead-capture slice. Nothing will activate booking or slot offers: no public slot surface is built and `booking_offers` code is untouched. I will not invent Glocast hours — the row stays unconfigured until you supply real days/times.

## 6. Test plan

Before: full suite, typecheck, build (baseline green).
After: quote-mode default/enum/fallback/tenant-scoping and no-side-effect tests; manual public-page regression; acknowledgement enabled / disabled / unset / usage-cap / quiet-hours / opted-out / lead-still-created; AI page rendering, tenant-correct services, unsupported request, recommendation → owner review, field collection, consent accepted and declined, no booking claim; persistence and duplicate tests; owner dashboard visibility; explicit no-SMS assertions (no ACK job, no message row, no follow-up, no usage event); availability auth/tenant scoping; tenant isolation and public-write rejection; typecheck; build. No provider calls — all SMS assertions use the existing fake/simulation harness.

Awaiting approval before any code changes.
