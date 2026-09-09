# Texto multi-tenant messaging: full tenant journey

## In one sentence
Every new business gets their own Australian number and isolated Texto account, so all SMS to their customers comes from their number, paid from their own credit balance.

## End-to-end journey

```text
1. SIGN UP     owner creates account (email or Google)
2. ONBOARD     owner pastes website URL -> details, services, add-ons, prices, hours auto-filled
3. REVIEW      owner confirms the extracted details and availability
4. UPGRADE     owner pays -> plan active
5. PROVISION   BookedSecure creates their Texto sub-account, gives them starting credits,
               and assigns a dedicated AU number ($15/mo)
6. GO LIVE     automation turns on for that business only
7. RUN         every outbound SMS uses their number; replies and delivery receipts belong to them
8. METER       credits, message counts and spend tracked per business; top-ups per business
```

Customer experience stays the same: land on quote page, AI chat, booking, confirmation SMS — now from the business's own number.

## What already exists

- Multi-tenant data isolation and RLS
- Website onboarding (business details, services, add-ons, prices, hours)
- Deterministic booking, owner alerts, confirmation SMS
- Texto send/reply/delivery webhooks running alongside Telnyx
- Per-business sender records
- Paid upgrade flow with checkout and message tracking

## What this plan adds

### 1. Texto account layer
- New `texto_accounts` table: sub-account id, daily send cap, credit balance, provisioning state
- New `texto_numbers` pool table: available dedicated AU numbers
- `sms_senders` keeps the active sending number and links to the Texto account

### 2. Provisioning after upgrade
One idempotent step, safe to re-run:
- Create Texto sub-account for the business
- Set daily send cap
- Allocate starting credits
- Assign a dedicated number from the pool and record it as the business's sender
- Audit every step

If numbers cannot be bought via API, keep a manually-topped-up pool; if empty, queue the business and alert you instead of silently failing.

### 3. Number ownership rules
- A business is only "live" once it has an active assigned number
- Until then, automation stays off and the owner sees what's missing
- Cancellation/downgrade recalls the number and unused credits

### 4. Credits and caps per business
- Allocate credits on activation and each renewal/top-up
- Show remaining credits in business settings
- Block sends with a clear message when credits run out
- Recall unused credits when a business leaves

### 5. Per-business reporting
Per business: messages sent, delivered, failed, replies, opt-outs, credits used
Platform-wide: roll-up across all businesses

### 6. Cut over from Telnyx
- New businesses provision on Texto only
- Existing businesses move one at a time after a test message to a number you own
- Telnyx stays in code until every business is moved, then retired

### 7. Self-serve onboarding panel
A single "Get set up" panel showing live state for each step:
details confirmed -> plan active -> number assigned -> credits available -> automation on
Each step completes automatically or tells the owner exactly what to do.

## Technical notes

- New server module `src/lib/sms/texto-accounts.server.ts` for Texto account management calls
- Sending still uses the main API key with the business's assigned number as `sender` and business name as `campaign`
- Provisioning is a retry-safe server function with idempotency key, triggered by payment webhook and runnable from admin
- Credit checks join existing pre-send gates (quiet hours, consent, suppression, caps)
- Respect Texto rate limits: 50 req/s, 25 concurrent, group report once/minute
- Live sending disabled until Texto account clears Pending Review
- Tests: provisioning idempotency, number assign/recall, credit block, report isolation, cross-tenant leakage

## Order of work

1. Tables + account layer + tests (nothing live)
2. Provisioning wired to upgrade, behind a switch
3. Credits and caps in the send path
4. Reporting per business and group
5. Onboarding panel
6. One controlled live test to a number you own, then move businesses across one at a time
