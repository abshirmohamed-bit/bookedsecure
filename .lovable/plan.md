# Phase 3 — Sequence execution planning (no activation, no sends)

Phase 3 turns the Phase 2 decision into a **planned action set** that is fully
simulated. Nothing is enrolled, scheduled, sent, or written to
`current_sequence`. Activation stays a separate, later, explicit step.

## 1. What Phase 3 adds

One new pure module plus one dry-run server planner:

- `src/lib/sequence-actions.ts` (pure) — maps a `SequenceDecision` plus
  server-loaded tenant/lead facts to an ordered list of typed actions
  (`capture_consent`, `send_message`, `schedule_follow_up`, `offer_booking`,
  `handoff`, `record_audit`, `no_action`), each with the template id, timing
  offset, idempotency key shape, and required preconditions.
- `src/lib/sequence-plan.server.ts` (dry-run only) — loads real tenant state
  through existing loaders, builds the action list, and returns it. It has a
  hard-coded `mode: "dry_run"` and contains **no** write, send, enqueue, or
  provider call. There is no live-mode branch to accidentally enter.

Everything else is reuse.

## 2. Reuse map

Reused unchanged (read-only in Phase 3):

| Existing | Used for |
|---|---|
| `selectSequence` / `evaluateSequences` (`sequences.ts`) | the decision itself |
| `lead-provenance.ts` (`requiresNeutralLanguage`, `mayReferenceHistory`) | language guards on every planned message |
| `availability.server.ts` (`loadAvailabilityConfig`, `loadServiceDurationMinutes`, `generateBookingOffers`, `occupiedSlotStarts`) | whether a booking offer is even possible, and slot shape |
| `booking.ts` (`assessOfferGeneration`, `assessBookingConfirmation`, `assessAutomaticBooking`, `BOOKING_BLOCKED_STATUSES`, `slotOfferIdempotencyKey`, `bookingConfirmationIdempotencyKey`, `buildSlotOfferMessage`, `buildBookingConfirmationMessage`) | booking gating + message text + idempotency keys |
| `web-chat-booking.server.ts` (`commitWebChatBooking`, `bookingConfirmationText`) | the existing single, idempotent, server-confirmed booking commit path — Phase 3 does not replace or wrap it |
| `sms/quiet-hours.ts`, `sms/suppression-recovery.ts`, `sms/reachability.ts`, `sms/segments.ts` | send-eligibility, suppression, segment cost — evaluated, never acted on |
| `approved-facts.ts`, `ai-context.ts` | allow-listed facts available to templates |
| `automation_rules` rows (via existing query shape) | follow-up step timing and templates |

Reused for *checks only*, never invoked: `sendSms` (`lead-engine.server.ts`),
`jobs.server.enqueueJob`, `processDueFollowUps`, `sendSlotOffer`,
`recordCustomerSlotSelection`, `confirmBooking`, all providers in `sms/`.

Requires extension (Phase 4+, not now):

- `sendSms` — needs a `sequenceId` + `agent_action_id` attribution argument.
- `conversations` follow-up timer — needs `current_sequence` awareness so a
  step belongs to a sequence rather than a flat step counter.
- `agent_actions` (table already exists from Phase 1, still unused by code) —
  becomes the audit + idempotency ledger when activation lands.

## 3. Message-generation boundary

Hard boundary, unchanged from today: **no model generates customer text on any
automated path.** Templates are the only source.

- Templates live in existing template constants (`SLOT_OFFER_TEMPLATE`,
  `BOOKING_CONFIRMATION_TEMPLATE`, `automation_rules.message_template`) plus
  new neutral-language templates for `contact_only_introduction` and
  `booking_intent_fast_path`.
- Substitution only accepts server-verified values: tenant name, verified
  service name, confirmed booking date/time, tenant booking link.
- When `neutralLanguageRequired` is true the planner rejects any template that
  references a prior enquiry, quote, booking, or discount — a planning error,
  not a silent fallback.
- `analyseLead` (the only model call in the product) stays owner-invoked and
  produces internal structure, never outbound text.

## 4. How sequence outputs would call existing tools (recorded, not executed)

Each planned action names its target tool, tenant scope, idempotency key, and
consent precondition:

```text
capture_consent    -> sendSms(template=consent_intro, key=seq:<leadId>:<seq>:consent)
send_message       -> sendSms(template=<automation_rules step>, key=seq:<leadId>:<seq>:step<N>)
schedule_follow_up -> conversations.next_follow_up_at (immediate / 4-6h / 24h)
offer_booking      -> generateBookingOffers + sendSlotOffer, key=slotOfferIdempotencyKey(offerIds)
booking_confirm    -> commitWebChatBooking result only; key=bookingConfirmationIdempotencyKey(offerId)
handoff            -> automation pause + owner notification, no customer message
record_audit       -> agent_actions insert (business_id, lead_id, sequence, action, key)
```

Suppression, opt-out, and quiet hours are evaluated by the existing gates
before an action is considered eligible; the planner reports `eligible: false`
with the gate reason instead of dropping the action.

## 5. `booking_confirmation_followup` clarification (enforced)

- The sequence remains `none_no_outbound`, no handoff, no send, purely the
  post-booking state. The planner asserts it never emits `send_message`,
  `offer_booking`, or `schedule_follow_up`.
- Booking confirmation stays a **separate** action owned by the booking commit:
  exactly one SMS, keyed by `bookingConfirmationIdempotencyKey(offerId)`, only
  after the server confirms the commit, containing the confirmed date and time
  where the tenant supports it, and stating the tenant will call the customer.
  Wording is verified in tests in Phase 3; sending stays inactive.

## 6. Control, isolation, idempotency, consent

- **Tenant takeover** — `tenantTakeover`, `automationPaused`, and
  `agentEnabled: false` are already hard stops in `selectSequence`; the planner
  additionally returns an empty action list for those states, so a takeover
  zeroes all automated actions rather than pausing some.
- **Tenant scope** — every loader call takes `businessId`; the planner requires
  the lead's `business_id` to match its input and throws on mismatch (same
  contract as `assertTenantMatch`).
- **Idempotency** — every action carries a deterministic key derived from
  `(businessId, leadId, sequenceId, step | offerId)`; keys are asserted stable
  across repeated planning of identical input.
- **Consent** — `consentRequired` from Phase 2 gates the action list:
  `blocked` → empty, `consent_capture_required` → consent action first and no
  content messages before a reply, `existing_consent_required` → content only
  when consent is already recorded.
- **Server authority** — client input never selects a sequence, template,
  duration, or slot; all facts come from server loaders.

## 7. Synthetic test plan (no live effects)

New `src/lib/sequence-actions.test.ts` and `src/lib/sequence-plan.test.ts`,
using stubbed loaders and the existing test utils:

1. Every sequence id produces a stable, ordered action list (snapshot-style).
2. Hard stops (opt-out, suppressed, declined, takeover, pause, agent disabled)
   → empty action list.
3. Handoff decisions produce `handoff` + `record_audit` only, never a customer
   message.
4. `booking_confirmation_followup` → no send / no offer / no schedule.
5. Booking confirmation text asserts: exactly one message, includes confirmed
   date and time, includes "will call you", stable idempotency key, and no
   second message on replay.
6. Neutral-language leads reject any history-implying template.
7. `consent_capture_required` orders consent before content; `blocked` yields
   nothing.
8. Follow-up offsets match the conservative cadence: immediate, 4–6h, 24h.
9. Tenant mismatch throws; keys are tenant-distinct for identical lead shapes.
10. Guard test asserting `sequence-plan.server.ts` contains no `sendSms`,
    `enqueueJob`, provider, or write call, so Phase 3 cannot send.
11. Full suite, typecheck, and build re-run.

Nothing in Phase 3 activates a sequence, writes `current_sequence`, enrols a
lead, or sends any communication.
