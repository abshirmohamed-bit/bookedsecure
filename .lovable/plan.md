# Texto multi-tenant messaging: full tenant journey

Goal: every business signs up, gets onboarded from their website, buys their own
dedicated Australian number, and from that moment all texts to their customers
come from their own number, on their own isolated Texto sub-account, paid from
credits you allocate them.

## The journey, end to end

```text
1. SIGN UP            owner creates account (email or Google)
2. ONBOARD            owner pastes their website URL -> details, services,
                      add-ons, prices, hours filled in automatically
3. REVIEW             owner confirms the details and availability
4. UPGRADE            owner pays -> plan active
5. PROVISION          BookedSecure creates their Texto sub-account,
                      allocates their starting credits, assigns them a
                      dedicated number ($15/mo), records it as their number
6. GO LIVE            automation switches on for that business only
7. RUN                every text out uses their number; replies and delivery
                      receipts come back to their business only
8. METER              credit balance, message counts and spend shown per
                      business; top-ups and caps handled per business
```

Customer side stays as it is today: they land on the business's quote page,
have the AI conversation, get a booking, and receive the confirmation text —
now from the business's own number.

## What already exists

- Multi-tenant data with per-business isolation and access rules.
- Website onboarding (details, services, add-ons, prices, hours).
- Deterministic booking, owner alerts, confirmation texts.
- Texto sending, reply webhook and delivery webhook, all signed and
  duplicate-safe, running alongside Telnyx.
- A per-business sender record (number, provider, primary/active).
- Paid-upgrade flow with checkout and included-message tracking.

## What this plan adds

### 1. Texto account layer (new)
Store, per business: their Texto sub-account id, daily send cap, credit
balance snapshot, assigned number(s), and provisioning state
(`not_started`, `provisioning`, `active`, `suspended`, `failed`).

### 2. Provisioning after upgrade
One idempotent provisioning step, safe to re-run, that:
- creates the sub-account (business name + owner email),
- sets a daily send cap so one runaway loop can't become your invoice,
- allocates the starting credits,
- assigns a dedicated number from your pool and records it as that
  business's sending number,
- writes an audit entry for every step.

If numbers can't be bought over the API yet, the plan keeps a pool you top up
manually and assigns from it automatically; if the pool is empty the business
is queued and you get an alert instead of a silent failure.

### 3. Number ownership rules
- A business is only "live" once it has an active assigned number.
- Until then, automation stays off and the owner sees exactly what's missing.
- Cancelling or downgrading recalls the number and credits back to you.

### 4. Credits and caps per business
- Allocate on activation and on each renewal or top-up.
- Show remaining credits in the business's own settings.
- Block sends with a clear owner-facing message when credits run out,
  rather than failing silently.
- Recall unused credits when a business leaves.

### 5. Per-business reporting
Pull each business's own message totals, delivery and failure counts, replies,
opt-outs and credits used; plus a whole-of-platform roll-up for you.

### 6. Cut over from Telnyx
- New businesses provision on Texto only.
- Existing businesses move one at a time by switching their sender record,
  after a single test message to a number you own.
- Telnyx stays supported in code until the last business is moved, then it is
  retired.

### 7. Self-serve onboarding screen
A single "Get set up" panel showing the steps above with live state: details
confirmed, plan active, number assigned, credits available, automation on.
Each step either completes itself or tells the owner exactly what to do.

## Technical notes

- New table `texto_accounts` (one row per business) plus a `texto_numbers`
  pool table; both business-scoped with row-level security and grants.
  `sms_senders` keeps holding the sending number and links to the Texto
  account row.
- All Texto account-management calls (`POST /account`, `PATCH /account/:id`,
  `credits/allocate`, `credits/recall`, `numbers/assign`, `numbers/recall`,
  `/account/:id/report`, `/report/group`) go in a new
  `src/lib/sms/texto-accounts.server.ts` behind the existing provider
  capability flags, called only from server functions.
- Sending keeps using the parent API key with the business's assigned number
  as `sender`, and the business name as `campaign` for roll-up reporting, so
  no per-tenant key needs storing. Per-sub-account keys stay possible later
  via `POST /account/:id/key` if a business ever wants direct access.
- Provisioning is one server function with an idempotency key per business,
  retry-safe, writing `agent_actions`/`audit_events` entries; triggered by the
  payment webhook and re-runnable from an admin action.
- Credit checks join the existing pre-send gates (quiet hours, consent,
  suppression, caps) so an empty balance blocks before the provider call.
- Rate limits respected: 50 req/s, 25 concurrent, group report once a minute.
- Live sending stays disabled until your Texto account clears Pending Review;
  everything above is testable against the simulated provider first.
- Tests: provisioning idempotency, number assign/recall, credit block,
  per-business report isolation, and cross-tenant leakage guards.

## Order of work

1. Tables + account layer + tests (nothing live).
2. Provisioning wired to upgrade, behind a switch.
3. Credits and caps in the send path.
4. Reporting per business and group.
5. Onboarding panel.
6. One controlled live test to a number you own, then move businesses across
   one at a time.
