# Upgrade journey: what happens behind the scenes (and what is still missing)

## Stripe status (your latest ask)
Stripe is already enabled on this project in **test mode** (test checkout, test webhook and the payments webhook secret are all in place, and a test top-up has already been paid and credited). What is not done is **going live**: step 1 of 5, "connect your sandbox to a Stripe account", is still in progress. Nothing needs to be built for that; it is finished from the Payments tab. No new Stripe integration should be added (the bring-your-own-key option would conflict with the one already running).

## The journey today, verified in code and data

```text
1. SIGN UP      auth user created -> trigger creates business + owner profile + owner role
                business.subscription_status = "preview" (view-only, CSV upload allowed)
2. ONBOARD      /setup: website URL -> Firecrawl -> owner confirms services, add-ons, hours
3. UPGRADE      /settings/billing -> Essentials or Pro, monthly or yearly
                server creates ONE Stripe customer per business (tagged with business id)
                and an embedded Stripe checkout with the business id in metadata
4. PAY          Stripe -> POST /api/public/payments/webhook?env=sandbox|live
                signature verified -> event stored once in stripe_events (idempotent)
                checkout.session.completed / customer.subscription.* ->
                business.subscription_status = "active", plan_id, period dates
5. ACCESS       every write/feature gate reads subscription_status + plan_id live
                (leads, bookings, assistant, messaging, team, automation, reactivation...)
                Essentials: defaults, 2 seats. Pro: reactivation, campaigns, custom automation
6. PROVISION    first activation -> provisionTextoAccount(business)
                creates texto_accounts row, takes the next number from texto_numbers pool,
                writes it as the primary sms_senders row (provider = texto)
7. RUN          every outbound text: resolve tenant sender -> subscription gate
                (included allowance first, then purchased credits at 6c) -> Texto account
                check -> daily cap -> POST api.texto.com.au/send with sender = tenant number
                replies  -> /api/public/sms/texto.inbound  (HMAC verified)
                receipts -> /api/public/sms/texto.delivery (HMAC verified)
8. TOP-UP       /settings/billing#credits -> one-off Stripe checkout -> webhook ->
                credit_topups row settled once -> credits added to the tenant account
9. LIFECYCLE    payment failed -> past_due (7-day grace) -> canceled -> gates close
```

## Where it breaks today (the honest checklist)

| Step | State | Why |
|---|---|---|
| Stripe test payments | Working | Verified end to end after last week's webhook fix |
| Stripe live payments | Not live | Go-live step 1 not finished in the Payments tab |
| Feature access on pay | Working | Gates read the business row the webhook updates |
| Included credits per plan | Working | Usage periods created on activation |
| Top-up credits | Working (test) | 1 paid, 9 abandoned checkouts sitting as "pending" |
| Number assignment | **Blocked** | The number pool (`texto_numbers`) is empty, so step 6 ends in "queued, no number" |
| Texto account creation | **Simulated** | `TEXTO_ACCOUNT_PROVISIONING` is not set to `live`, so no Texto call is made |
| Texto sub-account API calls | **Wrong URLs** | Code calls `/account`, `/credits/allocate`, `/numbers/assign`; Texto's published spec uses `POST /accounts`, `POST /account/{id}/credits/allocate`, `POST /account/{id}/numbers/assign` |
| Buying numbers | **Not possible via API** | Texto's API can list and assign numbers but has no purchase endpoint; numbers ($15/mo) are bought in the Texto dashboard on your parent account |
| Live sending | Off for everyone | The only active sender in the database is still Telnyx; no tenant is switched to Texto |

## How Texto actually works for us (from their published API spec)

- **One parent account (yours), your one API key.** The key you saved is the parent key.
- Numbers are bought in the Texto dashboard into the parent account. The API can then list them (`GET /numbers`, `GET /numbers/available`) and hand one to a sub-account.
- Sub-accounts are optional. Texto supports two credit models: sub-accounts draw from the parent pool, or the parent allocates credits to each one (recall by allocating a negative amount / recall endpoint). Daily limits are set per sub-account.
- Sending is `POST /send` with `sender` = the dedicated number. Delivery receipts and replies come to the webhook URLs configured on the account, signed with the secrets you already saved.

## Recommended shape (matches what you described)

**One Texto parent account, all numbers under it, each tenant assigned one number.** BookedSecure keeps doing the per-tenant metering it already does (included allowance, 6c credits, daily cap, quiet hours, consent). Texto sub-accounts become a later, optional layer for tenants who want their own Texto login; they are not needed for the money or the numbers to work.

## What to build

1. **Number pool operations (platform admin)**
   - Admin action "sync numbers from Texto": pulls `GET /numbers` from the parent account into `texto_numbers` so every number you buy in the Texto dashboard appears in the pool automatically.
   - Alert (feedback/admin notice + audit) when the pool is empty and a business is queued; admin "retry provisioning" button for queued businesses.
2. **Fix the Texto account client to the published endpoints**
   - `POST /accounts`, `PATCH /account/{id}` (`daily_limit`), `POST /account/{id}/credits/allocate|recall` (`{ amount }`), `POST /account/{id}/numbers/assign|recall` (`{ numbers: [] }`), `GET /account/{id}/report`, `GET /report/group`.
   - Keep sub-account creation behind its own switch (default off); number assignment and sending work with the parent account alone.
3. **Activation switch-over**
   - On first activation: assign a pool number, mark it the primary sender with `provider = texto`, deactivate the old Telnyx sender for that business only.
   - Nothing changes for a business until it activates; existing Glocast sender stays as is until you switch it.
4. **Live switch and smoke test**
   - Set `TEXTO_ACCOUNT_PROVISIONING=live` and `SMS_PROVIDER=texto` only after one controlled test: one number, one test tenant, one text to a phone you own, reply and receipt confirmed in the inbox.
5. **Stripe go-live** (no code): finish the 5 steps in the Payments tab; the live webhook and live keys are created automatically at step 4.
6. **Housekeeping**: expire abandoned top-up checkouts after 24h so "pending" rows do not pile up; show "queued for a number" state in the tenant's Get set up panel.

## Technical notes

- Files: `src/lib/sms/texto-accounts.server.ts` (endpoints, pool sync), `src/lib/subscription-billing.server.ts` (`onActivated` switch-over), new admin server function + small admin panel for pool sync/retry, `src/lib/sms/credit-topups.server.ts` (expiry sweep via existing cron hook).
- Provider selection order stays: `SMS_PROVIDER_OVERRIDE` > `sms_senders.provider` > `SMS_PROVIDER` > simulated.
- Send gate order stays: subscription gate (allowance/credits) -> Texto account active -> daily cap -> idempotent message row -> carrier.
- Tests: pool sync idempotency, provisioning with empty vs stocked pool, sender switch-over per business only, endpoint payload shapes against the spec.
- No schema change required; `texto_numbers` already has `provider_number_id` and `monthly_cost_cents`.
