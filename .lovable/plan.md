# Telnyx Readiness Audit + Minimal Activation Plan

Audit only — no code changed, no SMS sent, no live sending enabled, Glocast untouched (still `simulated`).

## Part 1 — Audit findings

### 1. Files, routes, functions, tables involved
- `src/lib/sms/telnyx.server.ts` — adapter: `createTelnyxProvider` (send via `POST https://api.telnyx.com/v2/messages`), `flattenTelnyxPayload`, `mapTelnyxStatus`, `buildTelnyxSendPayload`, `verifyTelnyxSignature`, `isProductionRuntime`, `telnyxFinalCost`.
- `src/lib/sms/provider.server.ts` — `SmsProvider` contract, `telnyxProvider` instance, `getProvider`/`getLegacyProvider`, `verifySharedSecret`.
- `src/lib/sms/registry.server.ts` — `resolveProviderId`, `getMessagingProvider`, Telnyx `getNumberStatus` lookup.
- `src/lib/sms/config.ts` — provider ids, labels, `PROVIDER_CAPABILITIES.telnyx` (send/inbound/delivery/signed/getNumberStatus true; provision/release/assign false).
- `src/lib/sms/contract.server.ts`, `events.ts`, `segments.ts`, `webhook.server.ts` — neutral contract, normalized events, segment counting, idempotency/logging.
- `src/routes/api/public/sms/telnyx.ts` — the Telnyx webhook route (inbound + status).
- `src/lib/lead-engine.server.ts` — `sendSms`, `resolveSender`, `findSenderByNumber`, `handleInboundMessage`, `handleDeliveryStatus`.
- `src/lib/commercial.server.ts` — `authorizeLiveSend`, `releaseReservedSegments`; `src/lib/usage.server.ts` — `checkSmsCap`.
- Tables: `sms_senders`, `messages`, `conversations`, `leads`, `consent_events`, `webhook_events`, `sms_usage_daily`, `sms_usage_periods`, `usage_limits`, `businesses`, `automation_jobs`, `audit_events`.
- Tests: `src/lib/sms/telnyx.test.ts`, `src/lib/sms/provider-contract.test.ts`.

### 2. Is +61468045220 configured?
No. It exists only in the Telnyx portal (ordered/approved). The database has exactly one sender row: `+61400000000`, provider `twilio`, Glocast, `messaging_profile_id = null`. No Telnyx sender row exists anywhere.

### 3. Is a Messaging Profile required, and where is the ID stored?
Yes — Telnyx will not send SMS from a number that is not attached to a Messaging Profile. The ID belongs in `sms_senders.messaging_profile_id` (column already exists, mapped through `ResolvedSender.messagingProfileId` and injected as `messaging_profile_id` by `buildTelnyxSendPayload`). No profile ID may live in frontend code.

### 4. Is the number assigned to a Messaging Profile?
Not from BookedSecure's perspective — nothing is recorded. Portal-side assignment must be verified manually; the adapter has no `assignNumberToTenant` capability for Telnyx (deliberately false).

### 5. Which Telnyx SMS connection is configured?
None in this app. The app talks to the Telnyx v2 Messages API directly with a bearer API key and a messaging profile — there is no Telnyx "connection"/app ID stored or referenced.

### 6. Required server-side secrets
- `TELNYX_API_KEY` — **missing** (outbound sends; `checkBalance` reports "not connected").
- `TELNYX_PUBLIC_KEY` — **missing** (Ed25519 webhook verification; production fails closed without it).
- `PUBLIC_APP_URL` — present (builds the per-message `webhook_url`).
- `SMS_WEBHOOK_SECRET` — present (query-token fallback, dev/test only).
All read server-side inside handlers only; none is exposed to the browser.

### 7. Inbound SMS webhooks
Implemented at `POST /api/public/sms/telnyx`. `message.received` → verify signature → `flattenTelnyxPayload` → tenant lookup by `to` via `findSenderByNumber` → `recordWebhookEvent` dedupe → `handleInboundMessage`. Unmatched numbers return 404 and are logged as `inbound_unmatched`.

### 8. Delivery-status webhooks
Same route. `message.sent` and `message.finalized` → `handleDeliveryStatus`, with `providerCost` taken from `message.finalized`. Tenant resolved by `from`. Other event types are ignored with `{ ok: true, ignored }`.

### 9. Signature verification method used
Ed25519 over `"{telnyx-timestamp}|{rawBody}"`, base64 signature from `telnyx-signature-ed25519`, 300-second timestamp tolerance, raw 32-byte key wrapped in an SPKI header. If `TELNYX_PUBLIC_KEY` is absent: rejected in production, shared-secret fallback in dev/test only.

### 10. Tenant isolation of inbound
Yes. The tenant is derived from the BookedSecure-owned number, never from the payload's claimed business; `assertTenantMatch` re-checks the lead's `business_id`; all writes are scoped by `business_id`; RLS restricts client reads.

### 11. STOP handling and quiet hours for Telnyx
Yes — both are provider-neutral and run in `sendSms`/`handleInboundMessage` before any carrier call: `opted_out_at`, `invalid`, `AUTOMATION_BLOCKED_STATUSES`, `automation_enabled`, quiet hours via `isQuietHour`, plus `consent_events` history.

### 12. Does the 250-segment cap apply before the carrier call?
Yes. `countSegments` → `checkSmsCap` (monthly safety cap, automated sends) → `authorizeLiveSend` which atomically reserves against `sms_usage_periods.included_segments` via `reserve_sms_segments`; a carrier failure calls `releaseReservedSegments`. All of this precedes `provider.sendMessage`.

### 13. Is live sending blocked unless gates pass?
Yes. Any non-simulated provider must pass `authorizeLiveSend`: paid pilot state, pilot window not expired, renewal prevention confirmed, and remaining segment allowance. Additionally Telnyx sends throw immediately without `TELNYX_API_KEY`.

### 14. Glocast simulated messaging
Unaffected. `businesses.default_sms_provider = 'simulated'` and no `SMS_PROVIDER`/`SMS_PROVIDER_OVERRIDE` env is set, so simulated stays selected and bypasses the commercial gate.

### 15. Telnyx dashboard settings to configure manually
1. Create/confirm a Messaging Profile (AU-capable, alphanumeric sender disabled).
2. Assign +61468045220 to that Messaging Profile.
3. Set the profile webhook URL to `https://<public-app-url>/api/public/sms/telnyx` and the failover URL blank or the same.
4. Webhook API version: **API v2**.
5. Copy the portal's **Public Key** (Ed25519) for `TELNYX_PUBLIC_KEY`.
6. Create an API v2 key for `TELNYX_API_KEY`.
7. Keep number-level messaging settings inheriting the profile.

### 16. Checks that confirm the number is active and SMS-ready
- `GET /v2/phone_numbers?filter[phone_number]=+61468045220` → `status: active` (already supported by the adapter's `getNumberStatus`).
- `GET /v2/phone_numbers/messaging` → confirms `messaging_profile_id` is attached and messaging is enabled.
- `GET /v2/messaging_profiles/{id}` → confirms webhook URL and API v2.
- Portal: Numbers → number shows *Active* and a Messaging Profile; Regulatory Requirements show *Approved*.

## Part 2 — Minimal implementation plan

### A. Telnyx portal configuration (manual, by you)
Items 1–7 of finding 15 — profile created, number attached, webhook URL + API v2 set, keys copied. Nothing sent.

### B. Secret configuration
Add `TELNYX_API_KEY` and `TELNYX_PUBLIC_KEY` server-side only. Confirm `PUBLIC_APP_URL` matches the webhook host. No frontend exposure, no changes to existing secrets.

### C. Code changes (minimal)
1. Add a platform-owned, **inactive** Telnyx sender row for +61468045220 with the messaging profile ID, `credential_mode = 'platform'`, `active = false`, and no `business_id` binding to Glocast — created via migration/admin action only after B.
2. Add a read-only server function `telnyxReadinessCheck` (platform-admin only) that calls `getNumberStatus` plus the messaging lookup and reports: key present, public key present, number active, profile attached, webhook URL match. No send path.
3. Surface that readiness result in the existing admin SMS setup panel as a checklist. Presentation only.
4. Tests: readiness check reports each missing precondition; sender rows with `active = false` are never resolved by `resolveSender`.
No changes to the simulated provider, gates, follow-ups, billing, or expiry code.

### D. Safe controlled test procedure
1. Run `telnyxReadinessCheck` — expect all green with zero messages sent.
2. Replay a signed Telnyx `message.received` fixture against the webhook using the real public key to confirm 200 + tenant resolution, and a tampered one to confirm 401.
3. Confirm dedupe by replaying the same event id.
4. Only then, one **manually triggered** outbound to a number you own, from a dedicated non-Glocast test business with a paid pilot period seeded — requires your explicit approval as a separate step.

### E. Final live-send activation gate
Live Telnyx sending switches on only when all of the following hold: secrets present; number active and profile-attached per the readiness check; signed webhook verified end to end; a non-Glocast tenant with `paid` access state, unexpired pilot window, confirmed renewal prevention, and remaining segments; the Telnyx sender row flipped to `active = true` and bound to that tenant. Glocast stays `simulated` throughout.
