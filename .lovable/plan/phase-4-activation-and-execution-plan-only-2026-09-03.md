# Phase 4 — Activation and Execution (plan only)

Phase 3 produced a dry-run planner that emits `PlannedAction`s and never touches the world. Phase 4 turns those plans into real actions, behind layered gates, with a canary as the only first live traffic. Nothing in this plan is implemented yet; no SMS, follow-up, enrolment, campaign, sequence-state change, or provider call happens during planning.

## 1. Planned actions call existing tools, never new ones

Each `PlannedAction.kind` maps to exactly one existing code path. The executor is a thin dispatcher — it owns no messaging, no scheduling, no booking logic.

| Action kind | Existing tool reused |
|---|---|
| `send_message`, `capture_consent` | `sendSms` (`src/lib/lead-engine.server.ts`) with `respectAutomation: true` |
| `schedule_follow_up` | `enqueueJob` (`src/lib/jobs.server.ts`) + existing `processDueJobs` / `runJob` runner |
| `offer_booking` | existing availability + offer path (`src/lib/availability.server.ts`, `src/lib/web-chat-booking.server.ts` offer creation) |
| `handoff` | `createNotification` (`src/lib/jobs.server.ts`) and the existing `owner_alert` job type |
| `record_audit` | `agent_actions` ledger + existing `audit_events` |
| `no_action` | records the block reason only |

Nothing forks `sendSms`, quiet-hours evaluation, segment caps, suppression, delivery-state handling, or slot generation. If a planned action cannot be expressed through an existing tool, the executor refuses it rather than adding a parallel implementation.

## 2. `agent_actions` becomes the idempotency and audit ledger

`agent_actions` does not exist yet (Phase 1 recorded the intent; the table was not created). Phase 4 creates it as the single write-ahead ledger for every agent action.

Shape: `id`, `business_id`, `lead_id`, `sequence_id`, `action_kind`, `template_id`, `idempotency_key` (unique per business), `status` (`planned | claimed | succeeded | blocked | failed | abandoned`), `attempt_count`, `max_attempts`, `blocked_reason`, `failure_reason`, `scheduled_for`, `claimed_at`, `completed_at`, `result_ref` (message/job/offer/notification id), `plan_snapshot` jsonb, `mode` (`dry_run | live`), timestamps.

Protocol per action: insert `planned` → conditional `UPDATE ... WHERE status IN ('planned','failed')` to `claimed` (the claim is the lock; losers stop) → invoke the tool → `succeeded` with `result_ref`, or `blocked`/`failed` with a reason. Unique `(business_id, idempotency_key)` makes replay a no-op that returns the recorded `result_ref`. RLS scoped by `business_id`; writes only via service role; grants for `authenticated` read and `service_role` all.

## 3. `sendSms` attribution

`sendSms` gains optional, additive fields: `sequenceId`, `actionKind`, `agentActionId`, and `source: "agent_sequence"` added to `MessageSource`. `message_kind` stays within the existing union (`follow_up` for cadence steps, `acknowledgement` for the first touch). `messages` gains `sequence_id`, `agent_action_id`, `template_id` so every outbound row is traceable to the plan that produced it. Existing callers are unchanged — omitting the fields keeps today's behaviour byte-for-byte. `sendSms` continues to own quiet hours, suppression, opt-out, segment caps and idempotency; the executor does not re-implement any of it.

## 4. Sequence-aware follow-up timers

`automation_jobs` gains `sequence_id`, `agent_action_id`, `sequence_step_template_id`. The executor enqueues cadence steps through `enqueueJob` with `job_type: "sequence_step"` and `idempotency_key` = the plan's key, so `FOLLOW_UP_OFFSETS_MINUTES` steps are naturally deduplicated. `runJob` gains one branch for `sequence_step`: it re-plans the lead at run time (Phase 3 planner), confirms the same sequence and step are still selected, and only then sends. If the lead has replied, booked, opted out, been taken over, or moved sequence, the job is abandoned rather than sent. Timers therefore cannot outlive the state that justified them, and existing `acknowledgement` / `follow_up` / `owner_alert` jobs keep their current behaviour.

## 5. Re-check immediately before every action

The plan is advisory; the executor re-reads truth inside the claim, in this order, and every failure records a `blocked_reason` and stops:

1. tenant takeover / `automation_paused` / `agent_enabled` (fresh `businesses` + `conversations` read)
2. lead opt-out, SMS suppression, reachability state
3. consent status and source (`capture_consent` must precede any messaging for consent-capture sequences)
4. booking state (`booking_status`, live `jobs` / `booking_offers`) — a booked lead plans nothing
5. quiet hours via `evaluateQuietHoursGate` (defer, do not drop)
6. service validity and `services.duration_minutes` for booking offers
7. sequence re-selection equality — the plan must still be the current plan
8. volume/rate limits and segment caps

Stale plans are never executed: the re-plan comparison is a hard gate, not a warning.

## 6. Safe retries without duplicates

- Ledger claim + unique idempotency key: at most one in-flight attempt per action.
- `sendSms` keeps its own outbound idempotency; a retry after an ambiguous provider response reconciles through `provider_message_id` and the existing delivery/reconcile path instead of resending.
- Retries only for transient classes (network, provider 5xx, rate limit) on the existing `RETRY_DELAYS_MINUTES` / `MAX_ATTEMPTS` backoff; permanent failures (invalid number, opt-out, declined consent) fail terminally.
- Bookings and jobs retry through `commit_web_chat_booking`, which is already replay-safe and returns the existing job.
- Handoffs deduplicate on `notifications.idempotency_key`, so one owner alert per action regardless of attempts.

## 7. Activation gates

Activation is off by default and requires every gate to pass:

1. **Tenant opt-in** — `businesses.agent_execution_opted_in_at` (explicit owner action, recorded with actor).
2. **Agent enabled** — `businesses.agent_enabled`, re-read per action.
3. **Campaign approval** — a `sequence_campaigns` row approved by the owner, with an explicit lead scope; no implicit "all leads".
4. **Sequence approval** — per-sequence approval and template version; an unapproved or changed template blocks execution.
5. **Per-lead eligibility** — provenance context, verified facts, reachability, no owner-review flag.
6. **Consent** — consent-capture sequences must complete consent before any content message; declined/absent consent blocks.
7. **Volume and rate limits** — per-tenant daily/hourly send caps and a max-leads-per-activation cap, on top of existing segment caps.
8. **Kill switch** — a single tenant-level flag plus a global platform flag; when set, claims stop immediately and queued `sequence_step` jobs abandon on their next run.
9. **Rollback** — kill switch → cancel pending `sequence_step` jobs → mark open `agent_actions` `abandoned` → clear `current_sequence` for affected leads → reversible migration; already-sent SMS cannot be recalled, which is why the canary is small.

## 8. Dry-run stays available

`mode` remains a first-class parameter: `planLeadSequence` keeps its dry-run default, and every activation gate is evaluated in dry-run so the owner sees precisely what would happen. Preview writes `agent_actions` rows with `mode = 'dry_run'` only when explicitly requested for inspection, never claimable by the executor. Live execution requires `mode = 'live'` plus all gates.

## 9. First live test = controlled canary

One tenant (Glocast), one approved sequence, one hand-picked lead with valid consent and a reachable number, outside quiet hours, executed manually — no scheduler, no campaign. Success criteria: exactly one outbound message, one `agent_actions` row `succeeded`, correct attribution, delivery reported, replay produces no second send. Then verification of the cadence step and abandonment on reply. Only after that is a bounded batch (single-digit) considered, still without broad campaign activation, and the canary records are cleaned up afterwards.

## 10. Booking confirmation stays separate

The executor still has no `booking_confirm` action kind, and a guard test keeps it that way. Booking confirmation remains owned exclusively by the successful `commitWebChatBooking` path, sent once under its own idempotency key after the commit returns a non-replay success. `booking_confirmation_followup` remains passive (`none_no_outbound`). No sequence, timer, or retry can emit a confirmation message.

## 11. Live-data and provider risks

- **Irreversible sends** — an SMS delivered in error cannot be recalled; mitigated by canary scope, rate caps and kill switch.
- **Ambiguous provider responses** — a timeout after acceptance risks a duplicate; mitigated by provider-id reconciliation instead of blind resend.
- **Stale plans** — mitigated by mandatory re-plan equality inside the claim.
- **Quiet hours / regulatory** — deferral rather than drop, plus opt-out honouring on every action.
- **Consent and neutral language** — history-implying templates stay blocked for unverified leads.
- **Cost** — segment caps, per-tenant volume limits and existing usage-period reservation.
- **Concurrency** — ledger claims and the existing transactional booking RPC prevent double jobs.
- **Cross-tenant leakage** — every read and write stays `business_id`-scoped; `TenantMismatchError` remains fatal.

## 12. What will change

**Migrations**: create `agent_actions` (with grants, RLS, indexes, unique idempotency key); add `sequence_id` / `agent_action_id` / `template_id` to `messages`; add `sequence_id` / `agent_action_id` / `sequence_step_template_id` to `automation_jobs`; add agent gate columns to `businesses` (`agent_enabled`, `agent_execution_opted_in_at`, kill switch, volume limits); create `sequence_campaigns` (approval, scope, status) with grants and RLS.

**New files**: `src/lib/agent-ledger.server.ts` (claim/complete/replay), `src/lib/sequence-execute.server.ts` (dispatcher + pre-action re-checks), `src/lib/agent-gates.ts` (pure gate evaluation), `src/lib/agent-gates.server.ts`, plus their tests and `src/lib/sequence-plan.test.ts`.

**Modified**: `src/lib/lead-engine.server.ts` (`sendSms` optional attribution, `MessageSource` union), `src/lib/jobs.server.ts` (`sequence_step` branch, attribution passthrough), `src/lib/sequence-actions.ts` (live mode representation, gate reasons), `src/lib/sequence-plan.server.ts` (mode parameter, gate evaluation), settings UI for opt-in/kill switch/approval.

**Tests**: gate matrix (each gate blocks alone), ledger claim/replay/concurrency, retry classes with no duplicate SMS/booking/job/handoff, stale-plan rejection, quiet-hours deferral, consent ordering, sequence-step abandonment on reply/booking/opt-out, `booking_confirm` never emitted, tenant isolation, canary script, plus the existing 885-test suite kept green.

## Phase 4 execution order (each step gated by approval)

1. Migrations + ledger + gates, still dry-run only.
2. Attribution plumbing (`sendSms`, `automation_jobs`), no behaviour change.
3. Executor behind gates, all off.
4. Owner-facing approval/opt-in/kill-switch UI with dry-run preview.
5. Single-lead canary.
6. Bounded batch; broad activation only after review.
