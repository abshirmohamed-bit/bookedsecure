# BookedSecure Paid Pilot — Implementation Plan

Payments are now enabled in test mode, so all of this can be built and verified end to end without real money. Nothing here touches the messaging engine's message composition, provider adapters, tenant isolation or the Glocast simulated environment — the only intersection is a new access check at the existing send-authorisation gate.

Delivered in three reviewable slices.

---

## Slice 1 — Commercial configuration, state model and payment gating

**Central commercial configuration**
One admin-only configuration record holding currency, price in minor units, billing interval, included segments, overage mode, pilot duration, support channel/address/target, cancellation terms, pilot-end action, the Stripe product and price IDs, a version number and who last changed it. Seeded to: AUD, $99, monthly, 250 segments, `hard_cap`, 30 days, email support, 1 business day, pause at pilot end, no automatic conversion, no free trial. Editing bumps the version and writes an audit event. Existing pilots are never re-priced — each pilot keeps a frozen snapshot of the terms it started on.

**Pilot commercial state**
The pilot application record gains commercial fields: access state (`pending`, `paid`, `past_due`, `canceled`, `paused`, `pilot_expired`), state reason, payment-invited/completed timestamps, pilot start and end, extension end, continuation requested/approved, cancellation requested, terms snapshot, configuration version, and the Stripe customer/subscription/checkout-session IDs. All existing application fields and workflow behaviour are preserved. A link from the application to the business tenant is added so gating can resolve state from a send.

**Segment accounting periods**
A usage-period table per billing period: period start/end, included segments, segments used, segments blocked, hard-cap timestamp. Created only when payment is confirmed.

**Payment gating**
A single server-side authority answers "may this business send live outbound SMS right now?" — true only when the pilot is `paid` and inside its pilot window or a valid written extension, and the period has segment capacity. It is called at the existing send gate in the lead engine, immediately before the provider is contacted, alongside the current monthly safety cap. Simulated sends for Glocast stay functional; live provisioning and live sending are what get blocked. No message composition, retry logic or provider code changes.

**Hard cap**
Segment reservation happens in one atomic database operation so concurrent sends cannot push past 250. Reaching the cap blocks the send, increments blocked count, stamps the cap timestamp, notifies owner and admin through the existing notification path, and writes audit events — no queueing for later, no overage, no invoice.

## Slice 2 — Stripe checkout, webhooks and lifecycle

**Product and price**
A `BookedSecure Paid Pilot` product with a recurring AUD 99.00 monthly price is created in the test environment and its IDs saved into the central configuration. Checkout always resolves the amount from the stored price server-side; no client-supplied amount is accepted.

**Checkout**
Admin-triggered "Invite to paid pilot" on an approved application creates a Stripe-hosted checkout session server-side, stamps the application ID into protected metadata, saves the session ID, records an audit event and yields a URL to send through the existing communication method. The session cannot be created for an unapproved or unknown application, and the application identifier cannot be substituted by the client. The subscription is configured not to renew past the pilot unless continuation is recorded.

**Webhook**
A signature-verified webhook at the required payments path handles checkout completion, subscription created/updated/deleted, invoice paid and invoice payment failed. Every event is recorded against a unique Stripe event ID first, so a replay is a no-op — no duplicate activation, no duplicate usage period. On confirmed payment it stores the customer and subscription IDs, sets payment completed, sets pilot start to the confirmed payment time and pilot end to exactly 30 calendar days later, moves access to `paid`, opens the activation path, creates the first usage period and audits. Payment failure sets `past_due`; cancellation and deletion set `canceled`. Signature failures are rejected; unknown applications and subscription mismatches are recorded as errors rather than silently applied. Logs carry no payment payloads.

**Return page**
A payment-confirming page that explicitly says payment is being confirmed and does not claim activation until the webhook has been processed; it polls the server for the real state.

**Lifecycle**
A scheduled server-side check expires pilots past their end date (or extension end) into `pilot_expired` then `paused`, without automatic conversion. Explicit continuation and written extension are separate admin actions requiring confirmation, each recording who/when/why and auditing. Cancellation records the request, cancels at period end, prevents the next renewal and preserves all data.

## Slice 3 — Admin surface, error states and acceptance tests

**Admin area** (reusing existing `platform_admin` authorisation — no second permission system)
- A commercial configuration screen: view and edit all commercial terms without code changes; Stripe IDs visible, changing them needs deliberate confirmation and validation.
- A pilot detail view: application status, payment state, access state and reason, Stripe customer/subscription/checkout status, pilot dates, extension and cancellation detail, current period, segments used/remaining/blocked, terms snapshot and related audit events.
- Admin actions: send or regenerate a payment invitation, record a written extension (with date validation), record explicit continuation, pause manually with a reason, resume only when payment conditions are valid, and retry a failed activation. No action can mark a pilot active without a valid audited exception.
- Support channel, address and the one-Australian-business-day target displayed, with the explicit note that support does not cover the business's own customer quote conversations.

**Error states**
Clear handling and display for checkout creation failure, missing/invalid price, abandonment, decline, signature failure, unknown application, duplicate event, subscription mismatch, paid-but-activation-failed (stays paid, raises a high-priority record, admin can retry safely), past due, expiry-processing failure, cap reached, concurrent accounting conflict, permission denied, invalid extension date and continuation after expiry.

**Tests**
Automated unit tests for pilot date arithmetic, terms snapshotting, state transitions, segment counting (outbound counted, inbound not, blocked not), the 250/251 boundary, concurrency safety and webhook idempotency. Live verification in the running app for checkout with test cards, webhook replay, failed payment, cancellation, past-due send blocking, signature rejection, gating before payment, and a full regression run of the existing messaging and Glocast tests.

---

## Technical notes

- Access states and gating live in a server-only module called from the existing send gate in the lead engine; the engine's composition and provider logic is untouched.
- Segment reservation uses a single atomic `update ... returning` guarded by the included-segment limit, so no two concurrent sends can both pass at 250.
- Stripe access goes through the project's shared gateway client; keys stay server-side and no card data is ever stored.
- Commercial configuration, Stripe IDs, usage periods and Stripe events are admin/service-role only under row-level security, consistent with existing tenant isolation.
- Test mode only in this phase. No live payment readiness will be claimed until the sandbox acceptance tests pass.
