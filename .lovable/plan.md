# BookedSecure autonomous operations agent — audit and phased build

Audit only so far. Nothing was changed: no code, schema, services, leads, campaigns, SMS or provider calls.

## 1. What already exists (capability map)

| Capability | Where it lives today | Server-authoritative | Tenant-scoped | Idempotent / retry-safe | Audited | Verdict |
|---|---|---|---|---|---|---|
| Lead creation (public form, web chat, intake API) | `captureLead` in `lead-engine.server.ts`, `api/public/leads/intake` | Yes | Yes | 30-minute duplicate window + `external_id` webhook dedupe | Yes (`audit_events`, `consent_events`) | Reuse |
| CSV import + staged review | `csv-import.server.ts`, `import-lead.server.ts`, `lead_import_rows`, `import_batches` | Yes | Yes | Batch/row keyed | Partly | Extend (provenance classification) |
| Manual lead entry | Leads workspace + `captureLead` | Yes | Yes | Same window | Yes | Extend |
| Approved services & facts | `services` (`active`, `duration_minutes`, `price_guidance`), `approved-facts.ts` | Yes | Yes | n/a | n/a | Reuse |
| Public Quote Chat (deterministic) | `web-chat.ts`, `web-chat.server.ts`, `web-chat.functions.ts` | Yes | Yes | `expectedStep` replay guard | Messages persisted | Extend (intent handling) |
| Owner-invoked AI analysis (only model call) | `analyseLead` in `ai.server.ts` + `guardReply` | Structured output only, never customer-facing | Yes | Bounded retries | `ai_usage_events` | Keep isolated |
| Outbound SMS | `sendSms` (consent, opt-out, invalid, suppression, quiet hours, caps, sender resolution, segment gate) | Yes | Yes | Idempotency key per send | Yes | Reuse |
| Inbound SMS + STOP | `api/public/sms/inbound`, `handleInboundMessage` | Yes, signature-verified | Yes, resolved by receiving number | `in:<providerMessageId>` + `webhook_events` claim/complete states | Yes | Reuse |
| Delivery status | `api/public/sms/status`, `sms/delivery.server.ts`, reachability fields on `leads` | Yes | Yes | Monotonic state machine | Yes | Reuse |
| Suppression + recovery | `sms_suppressed_at`, `suppression-recovery.server.ts` | Yes | Yes | Yes | Yes | Reuse |
| Quiet hours / usage caps | `sms/quiet-hours.ts`, `usage.server.ts`, `sms_usage_*`, `usage_limits` | Yes | Yes | Reserve/release segments | Yes | Reuse |
| Follow-ups | `automation_rules`, `processDueFollowUps`, `automation_jobs`, `jobs.server.ts` (retries 5/30 min, max 3) | Yes | Yes | `${lead.id}:follow_up:<step>` | Yes | Extend (sequence types) |
| Availability + slots + booking | `booking_availability`, `booking_offers`, `availability.server.ts`, `web-chat-booking.server.ts`, RPC `commit_web_chat_booking` | Yes | Yes | Atomic commit, replay returns same job | Yes | Reuse |
| Owner alerts / notifications | `owner_alert` jobs, `notifications` | Yes | Yes | `lead:<id>:owner_alert` | Yes | Reuse |
| Automation pause | `businesses.automation_enabled`, `conversations.automation_paused` | Yes | Yes | n/a | Partly | Extend into full takeover |
| Audit trail | `audit_events`, `consent_events`, `webhook_events`, `jobs` | Yes | Yes | n/a | n/a | Reuse |

Not present at all: reactivation campaigns, lead provenance classification (`contact_only_unqualified` etc.), named sequence types, tenant takeover as a first-class state, booking-link follow-ups, confirmation SMS after web-chat booking (web chat is currently zero-SMS by design), off-topic/intent classification in chat.

## 2. Gaps that block autonomous operation

1. **Provenance is thin.** `lead_origin` + `source_channel` + `source_metadata` exist, but there is no verified-context classification, so a sparse CSV contact is indistinguishable from a real historical enquiry. Nothing today would stop a follow-up template implying history.
2. **One follow-up sequence only.** `automation_rules` are stepped templates per business; there is no sequence identifier, entry condition or precedence engine.
3. **No takeover.** `automation_paused` is a boolean on the conversation with no actor, reason, timestamp, or queued-job cancellation on takeover.
4. **Web chat sends nothing.** Confirmed bookings produce no confirmation SMS, so the idempotent one-and-only-one confirmation path does not exist yet.
5. **Chat cannot answer.** Any question, greeting or off-topic message at a text step is stored as an answer (audited previously: "Can you recommend a restaurant?" became the vehicle). Service corrections match by id only, so a named service becomes free text and silently disables booking eligibility.
6. **Pilot booking eligibility is name-matched** (`PILOT_SERVICE_NAMES`), so renaming a service disables booking.
7. **No booking link concept** and no per-tenant public booking URL stored for sequences.
8. **All five Glocast services are 120 minutes** — backfilled placeholders, not verified durations.

## 3. Proposed architecture (extend, never duplicate)

- One lead table stays the single lead system; add provenance/lifecycle columns rather than a second pipeline.
- One sequence engine: extend `automation_rules` with a `sequence` identifier and entry conditions; `processDueFollowUps` gains a deterministic `selectSequence(lead, conversation)` step implementing the precedence list. Pure function in `src/lib/sequences.ts` (unit-testable, no I/O).
- One SMS path: every sequence message goes through `sendSms`; nothing bypasses the block checks.
- One booking path: `generateBookingOffers` → `commit_web_chat_booking`; the confirmation SMS becomes a job with idempotency key `booking:<job_id>:confirmation`.
- One audit trail: `audit_events` gains agent action types (`agent_action`, `agent_skipped`, `handoff`, `takeover`, `resume`, `override`).
- The language model keeps exactly its current role: owner-invoked analysis, structured output, never customer-facing, never a source of operational truth.

## 4. Proposed schema changes (not applied)

`leads`: `lead_context` enum-like text (the twelve required states), `context_verified_at`, `verified_service_id`, `verified_vehicle`, `verified_suburb`, `verified_concern`, `quote_status`, `booking_status`, `customer_status`, `consent_status`, `consent_source`, `current_sequence`, `manual_entry_by`.

`conversations`: `taken_over_at`, `taken_over_by`, `takeover_reason`, `handoff_state`, `last_agent_action_at`.

`automation_rules`: `sequence`, `entry_conditions` jsonb, `max_attempts`.

`businesses`: `booking_link` (public quote URL), `agent_enabled`.

New `agent_actions` table (append-only): business_id, lead_id, action, decision, sequence, outcome, reason, idempotency_key (unique per business), created_at — GRANTs to authenticated/service_role, RLS scoped by business.

Migration order: columns + backfill (`lead_context` derived from existing `lead_origin`/history; CSV-only rows with no service/vehicle/suburb/concern become `contact_only_unqualified`) → `agent_actions` → sequence columns → indexes on `(business_id, lead_context)` and `(business_id, current_sequence)`.

Rollback: all additive; `agent_enabled` defaults false so nothing activates on deploy.

## 5. Provider, cost and live-data risk

- Every new message costs an SMS segment and counts against `usage_limits`; sequences must reserve segments through the existing gate.
- Reactivation of historical leads is the highest-cost, highest-complaint risk: it must be owner-approved per batch, quiet-hours respected, capped, and STOP-first.
- Inbound replies and delivery receipts also bill; retries reuse idempotency keys so a retried job never re-bills.
- Live-data risks: existing suppression and consent records must be honoured on backfill (never overwritten); repeat CSV imports must not re-enrol; in-flight conversations must not be re-sequenced mid-flight; stale availability is already handled by commit-time revalidation.
- No AI cost change: the agent adds no model calls.

## 6. Phased plan (each phase separately approved)

1. **Provenance foundation** — schema + backfill + `lead_context` derivation, no behaviour change. Cannot send anything. Tests: sparse record classification, provenance preserved through CSV/manual/duplicate import, conflicting sources → owner review.
2. **Sequence selection engine** — pure `selectSequence` + precedence tests, wired into `processDueFollowUps` behind `agent_enabled = false`. No live sends.
3. **Takeover and control** — takeover fields, queued-job cancellation, resume, per-lead/campaign/tenant pause enforced server-side, full audit. Tests: takeover blocks queued sends, tenant edits never overwritten, resume only on explicit action.
4. **Chat intent handling** — classify question/greeting/off-topic/emotional at text steps, name-based service resolution, deterministic FAQ answers from approved facts, booking-status answers from server state, id-based pilot eligibility.
5. **Booking confirmation SMS** — one idempotent message per confirmed booking with date, time, tenant identity and "we'll call you"; replay/webhook/worker-retry safe.
6. **Sequence content + booking links** — the nine sequences with allowed/forbidden claims, neutral contact-only intro, historical booking-link path.
7. **Owner UI** — review queue, handoff inbox, sequence controls, audit history.
8. **Dry run / shadow mode** — sequences compute and log decisions without sending.
9. **Authorised limited rollout** for Glocast, then monitored expansion.

Baseline before any change: 821 tests across 58 files passing, typecheck clean, build clean.

## 7. Needs your decision before implementation

- Verified per-service durations for the five Glocast services (all currently 120 minutes).
- Whether the public quote URL (`/quote/glocast`) is the canonical booking link for sequences.
- Whether the web-chat booking should now send a confirmation SMS (today the chat is deliberately zero-SMS).
- Approved wording for the contact-only intro and historical reactivation messages.
- Whether reactivation of historical leads requires per-batch owner approval (recommended) or per-lead.

Approve phase 1 (provenance foundation) to start; nothing sends, nothing activates.
