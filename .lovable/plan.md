# Production SMS Provider Architecture

Design only — no code changes in this pass. Labels: **[EXISTS]**, **[CHANGE]**, **[MISSING]**.

## 1. Sender model

Platform owns the Twilio account. Glocast gets one dedicated Australian sender number, provisioned by us. Glocast never supplies credentials.

Three credential modes, one abstraction:

| Mode | Credentials | Numbers | Use |
|---|---|---|---|
| `platform` | Platform Twilio (connector) | Platform-owned pool | Glocast pilot |
| `subaccount` | Platform parent + business subaccount SID | Owned by subaccount | SaaS scale, cost separation |
| `byo` | Customer's own key, stored as a secret reference | Customer's own | Enterprise |

`business_id -> sender number` is a row in a new `sms_senders` table, not a column on `businesses`, so a business can hold several numbers (spare, migration, second brand) with exactly one marked primary.

**[CHANGE]** `businesses.phone_number` becomes display-only; the engine reads the primary `sms_senders` row.

## 2. Outbound sender selection

`sendSms` resolves, in order: explicit sender override -> the lead's last-used sender (conversation stickiness, so the customer always sees one number) -> the business's primary active sender. No sender -> refuse to send and record a failed message with reason `no_sender_configured`, never silently fall back to another business's number.

The resolved sender carries its own credential mode, so the provider client is built per send, not per process.

**[EXISTS]** single outbound path in `sendSms`, opt-out check, idempotency key, message row per attempt.
**[CHANGE]** sender resolution + `sender_id` stamped on every message.

## 3. Inbound replies

Twilio posts to one shared route per provider. Identification is by the `To` number, which is the tenant key:

1. Look up `sms_senders` by normalised `To` -> gives `business_id`.
2. Find the lead by `business_id` + normalised `From` (most recent).
3. No sender match -> 404 and log to `webhook_events`; never scan leads across all businesses.

**[CHANGE]** current inbound lookup finds a lead by mobile number **globally** — this is the main tenant-isolation gap and must become sender-scoped.
**[EXISTS]** `webhook_events` idempotency, STOP/UNSUBSCRIBE handling, follow-up cancellation on reply.

## 4. Delivery callbacks

Status callbacks are matched on `provider_message_id` **plus** the `business_id` derived from the callback's sender number, and the update is constrained to that business. Unknown SID -> logged, ignored.

**[CHANGE]** current status route updates by `provider_message_id` alone.

## 5. Credential storage and webhook verification

- Platform Twilio: connector-managed env, server-only, read inside handlers.
- Subaccount: SID stored in DB, auth handled by the parent credential — no per-tenant secret in the database.
- BYO: DB stores only a secret *name*; the value lives in platform secrets. No plaintext token, ever, in a table or in a client bundle.
- Signature verification **[MISSING]**: every Twilio webhook must verify `X-Twilio-Signature` (HMAC-SHA1 over full URL + sorted POST params, timing-safe compare) against the auth token for the receiving account before any DB write. Reject with 401. Simulated mode uses a shared cron-style secret instead.

## 6. Usage, cost and limits

- **Segments**: computed at send time — GSM-7 vs UCS-2 detection, 160/70 single, 153/67 concatenated — and stored on the message. Billing counts segments, not messages.
- **SMS usage** rolls up per business per month: segments sent, inbound received, failures, provider cost, retail charge.
- **AI usage**: one row per model call (lead analysis, reply drafting) with tokens in/out and computed cost, tenant-scoped.
- **Failures/retries** **[MISSING]**: failed sends already write a message row; add `attempt_count`, `next_retry_at`, and a bounded retry policy (retry transport/5xx and rate limits with backoff; never retry carrier rejections, invalid numbers, or opt-outs).
- **Limits and alerts** **[MISSING]**: per-business monthly segment and AI spend caps, plus soft-threshold alerts (80%/100%). Hitting a hard cap blocks automation but never blocks STOP handling or inbound recording.

## 7. Billing separation (Stripe)

Two ledgers kept deliberately apart:
- **Platform cost** — what Twilio and the AI gateway charge us, recorded from provider responses.
- **Customer charge** — subscription plan (included segment allowance) plus metered overage pushed to Stripe as usage records at period close.

Glocast pilot: usage is tracked but **not** billed; Stripe stays out of the pilot path. Margin is then simply retail minus recorded cost per business per period.

## 8. Provider abstraction

The existing `SmsProvider` interface is the right seam and stays. Additions: providers receive the resolved sender (number + credential mode), expose `verifyWebhookSignature`, and report cost and segment data back from a send. ClickSend becomes a third implementation with no changes above the interface; `simulated` remains the default until the pilot number is live.

**[EXISTS]** interface, simulated provider, Twilio-via-gateway provider.
**[CHANGE]** signature above; per-send credential resolution.
**[MISSING]** ClickSend implementation.

## 9. Database changes

All new tables carry `business_id`, RLS scoped via `current_business_id()`, and explicit grants.

- `sms_senders` **[MISSING]** — business, phone number (E.164, unique), provider, credential mode, subaccount SID, secret name, primary flag, active flag, status-callback URL.
- `sms_usage_daily` **[MISSING]** — business, date, segments out/in, failures, provider cost, retail charge.
- `ai_usage_events` **[MISSING]** — business, lead, purpose, model, tokens in/out, cost.
- `usage_limits` **[MISSING]** — business, period, segment cap, AI spend cap, alert thresholds, hard-block flag.
- `billing_subscriptions` **[MISSING]** — business, Stripe customer/subscription ids, plan, included allowance, status.
- `messages` **[CHANGE]** — add `sender_id`, `segments`, `provider_cost`, `attempt_count`, `next_retry_at`.
- `businesses` **[CHANGE]** — add `sms_credential_mode`; `phone_number` demoted to display.
- `webhook_events` **[CHANGE]** — add `business_id` and signature-verification outcome.

## 10. Security, consent, tenant isolation

Every webhook: verify signature -> resolve tenant from the receiving number -> then write. Opt-out is per business and per number, stored with the triggering message, and blocks every automated path including retries. Consent text and the "Reply STOP to opt out" suffix stay mandatory on outbound. Provider credentials are read only inside server handlers; nothing tenant-sensitive crosses to the browser. Cross-tenant reads are prevented by RLS on the new tables and by the sender-scoped lookups above.

## 11. Pilot vs SaaS scale

**Required for the Glocast pilot:** one platform Twilio number in `sms_senders`; sender resolution in the outbound path; sender-scoped inbound and delivery lookups; Twilio signature verification; segment counting and usage recording; a monthly segment cap with alerts; unattended follow-up scheduling.

**Deferrable to SaaS scale:** Twilio subaccounts and BYO credentials, ClickSend, Stripe subscriptions and metered overage, self-serve number provisioning, per-business onboarding wizard, margin reporting UI.

## 12. Suggested build order

1. `sms_senders` + Glocast number, sender resolution in `sendSms`.
2. Webhook signature verification on all Twilio routes.
3. Sender-scoped inbound and delivery-status lookups (closes the isolation gap).
4. Segment counting, usage tables, AI usage events.
5. Limits, alerts, bounded retries.
6. Later: subaccounts, BYO, ClickSend, Stripe.
