# Phase 4 — Step 5: single-lead canary (plan only, not activated)

The boundary tests requested in the last review are added and green
(`src/lib/agent-executor-boundary.test.ts`, 18 tests; full suite 1027 passed,
typecheck and build clean). Nothing below runs until it is separately approved.

## 1. Tenant

- Business: **Glocast** — `11111111-1111-1111-1111-111111111111`
- Timezone `Australia/Sydney`; quiet hours 21:00 → 08:00 local.
- Caps for the canary only: daily 1, hourly 1, max leads per activation 1.
- `agent_enabled` and `agent_execution_opted_in_at` set by the owner in the UI,
  not by migration.

## 2. Lead

- Lead ID: **`ed39e7ca-88b5-4bba-b18b-5e04557adcd9`** (Usamah Ahmed)
- Mobile `+61447852565`
- `lead_context = active_form_enquiry`, `context_verified_at` set
- `consent_status = granted`, `consent_source = hosted_page`
- `quote_status = in_progress`, `booking_status = none`, `customer_status = unknown`
- `reachability_state = reachable_recently`, not suppressed, not opted out,
  `requires_owner_review = false`, `deleted_at` null

Chosen because consent is recorded at source, context is verified, there is no
booking (so no confirmation path is involved) and the number has recent
delivery evidence.

## 3. Campaign and sequence

One `sequence_campaigns` row, created by the owner through the Step 4 approval
screen:

- `sequence_id = active_enquiry_qualification`
- `scope_kind = explicit_lead_ids`, `scope_lead_ids = [ed39e7ca-…]` (exactly one)
- `status = authorised`, `campaign_approved_at` and `sequence_approved_at` set
- `execution_authorisation_kind = canary`, `execution_authorised_at` set
- `max_leads = 1`, `approved_template_version = 1`

## 4. Action, template and message

One outbound action only: `send_message` via `sendSms`.

- Template ID `active_enquiry_qualification_step`, **version 1**
- Rendered message (exact, 151 chars, GSM-7 only, no emoji, no link):

```text
Hi Usamah, it's Glocast Detailing. You asked us about a detail for your car. Can you reply with your suburb and preferred day so we can quote it? Thanks
```

- Substitution is limited to server-verified values: first name from
  `leads.name`, business name from `businesses.name`. Nothing else is
  interpolated; no model generates customer-visible text.
- Step 5 adds a versioned template-body registry (`src/lib/sequence-templates.ts`)
  so this copy is a constant, checked by the existing neutral-language guard and
  bound to version 1.

No `offer_booking`, `schedule_follow_up`, `capture_consent`, `handoff` or
`booking_confirm`. Follow-up steps 2 and 3 remain planned-only.

## 5. Consent and provenance basis

- Consent: hosted quote page submission — `consent_status = granted`,
  `consent_source = hosted_page`, `consent_record` retained on the lead.
- Provenance: `active_form_enquiry` with `context_verified_at` set, so the copy
  may reference the enquiry itself. It still implies no prior quote, booking,
  service or discount.

## 6. Segments and cost

- 151 GSM-7 characters → **1 segment**; the sender ID adds no body characters.
- Expected cost: one outbound segment on the Glocast Telnyx number.
- The existing segment cap check must record 1 and refuse anything above 1.

## 7. Quiet hours

- Send window 09:00–18:00 Sydney, inside 08:00–21:00 → the `quiet_hours` gate
  **passes**.
- Run outside that window and the gate defers rather than drops: the executor
  returns `gates_blocked` with `quiet_hours`, and the operator re-runs next
  morning with the same idempotency key.

## 8. Idempotency key

```text
seq:11111111-1111-1111-1111-111111111111:ed39e7ca-88b5-4bba-b18b-5e04557adcd9:active_enquiry_qualification:step1
```

Unique on `(business_id, mode, idempotency_key)`. The preview row is
`mode = dry_run`; the canary row is a separate `mode = live` row.

## 9. Expected ledger transitions

1. Owner previews → `dry_run` row `planned`, plan snapshot stored.
2. Owner presses Execute once → `live` row inserted `planned` (write-ahead,
   before any provider call).
3. Executor claims → `planned` → `claimed` via the conditional update, scoped by
   business, mode and `rolled_back_at is null`.
4. Provider accepts → `succeeded`, `result_kind = message`,
   `result_ref = messages.id`, `attempt_count = 1`.
5. Provider rejects → `failed` with `failure_reason`; retry allowed to
   `max_attempts = 3` on the same key, never a second message.
6. Any gate failing at recheck → `blocked` with the gate id in `blocked_reason`,
   no provider call.

## 10. Provider and message attribution

- Provider Telnyx, Glocast sender number, simulation off for this one send.
- `messages` row: `direction = outbound`, `business_id`, `lead_id`,
  `sequence_id = active_enquiry_qualification`,
  `template_id = active_enquiry_qualification_step`,
  `agent_action_id = <live ledger row id>`, `source = agent_sequence`.
- No `automation_jobs` row: execution is manual, no scheduler.

## 11. Delivery verification

- Provider message id recorded on the `messages` row.
- The status webhook must move it `queued` → `sent` → `delivered`, updating
  `last_outbound_sms_status`, `last_outbound_sms_at`, `last_delivered_sms_at`.
- Verify exactly one `messages` row for the key, one ledger row `succeeded`, one
  provider request in the SMS log, all three attribution columns populated, and
  the customer receiving the exact copy above.

## 12. Required canary tests (before and after the send)

- **Replay**: press Execute again with the same key → ledger stays `succeeded`,
  no second claim, no second `messages` row, no provider call.
- **Reply abandonment**: simulate an inbound reply before any later step →
  automation pauses for that lead and remaining planned actions move to
  `abandoned`; no further outbound.
- **Kill switch**: tenant switch on, then global switch on → Execute returns
  `gates_blocked` naming `tenant_kill_switch` / `global_kill_switch`, no
  provider call.
- **Stale plan**: set `booking_status = scheduled` → `plan_stale_booking_state`.
- **Opt-out**: mark the lead opted out → `gates_blocked` with `opt_out`.

## 13. Rollback procedure

1. Owner toggles the tenant kill switch — immediate, stops everything further.
2. `rollbackActivation(activation_id, reason, actor)` marks all non-`succeeded`
   rows `rolled_back` with reason, actor and timestamp, and writes
   `agent_activation_rolled_back` to the audit log. Nothing is deleted; the
   delivered message and its history stay intact.
3. Campaign `status` → `disabled`, `campaign_disabled_at` set.
4. `agent_execution_opted_in_at` cleared, caps back to 0.
5. If the customer objects, add suppression and record the opt-out.

Rollback cannot recall a delivered SMS — which is why the canary is one lead.

## 14. Success criteria

- Exactly one provider call, one `messages` row, one `succeeded` ledger row.
- Delivered copy matches the approved text byte-for-byte; 1 segment.
- Attribution columns populated; delivery webhook reaches `delivered`.
- Replay, reply-abandonment and kill-switch tests all behave as specified.
- No booking, follow-up job, scheduler run or other lead touched;
  `current_sequence` written for this single lead only, after a successful send.

## 15. Failure criteria (stop and roll back)

- Any second outbound message, duplicate claim, or retry storm.
- Any message to a lead outside `scope_lead_ids`.
- Body differing from the approved copy, or more than 1 segment.
- A send inside quiet hours, or after opt-out/suppression.
- Any booking, job, notification or campaign write this plan did not specify.
- A ledger row left `claimed` with no `succeeded`/`failed` resolution.

## 16. Constraints restated

One hand-picked lead, one approved outbound action, manual execution only, no
scheduler, no broad campaign, no batch, no autonomous booking. Nothing is sent
until this plan is separately reviewed and explicitly approved.
