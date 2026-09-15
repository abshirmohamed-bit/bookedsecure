# Reset Glocast's plan, then buy the number live from the front end

Goal: end Glocast's test subscription cleanly, pay the real $15 from the front end, claim the dedicated number yourself, and confirm Glocast's special pricing never leaks to another business — all while Glocast can still send and receive texts on the existing number.

## Where Glocast is right now

- Plan: Founder (hidden, not offered to anyone else) — $15/month, 0 included texts, credits at 3c.
- Status: active, from the test-mode subscription created yesterday.
- Special code USAMAH is recorded against Glocast only.
- Credits: 5,000 sitting in Glocast's own balance; no shared pool.

## Step 1 — End the test subscription properly

- Cancel the test-mode subscription at the payment provider so nothing renews or flips Glocast back to active.
- Set Glocast's status to "ended" in our records with a short wind-down window, so the workspace is no longer on a paid plan but Glocast keeps sending and answering replies during the test. Nothing is deleted: plan, code, credits, number, leads and conversations all stay.
- The billing page then shows "choose a plan" while messaging keeps working on the current number.

## Step 2 — Make the real $15 payment possible

- Confirm the live payment account has the Founder monthly price ($15 AUD) and the three 3c credit packs; create the missing ones in live if needed (same names/ids as the test ones so the plan matching keeps working).
- You then press the Founder plan on Plan & billing and pay with your real card. On success the system marks Glocast active on Founder again, records $15 as the provider's number cost for the month, and keeps the rest as margin — all private to you.

## Step 3 — Live updates on the front end

Right now the billing and messaging figures refresh when the page is reloaded or you return from checkout. Add live refresh so a payment, a credit purchase, or a text being sent updates the numbers on screen within a second, without a reload:

- Watch Glocast's own business row and its credit/account row and refresh the plan, credits-left and number panels when either changes.
- Also refresh when the tab regains focus, as a safety net.
- Scoped to the signed-in business only; no new data is exposed.

## Step 4 — Buy the number from the front end (you drive this)

- Messaging → "Your own number" → "Show me available numbers", pick one, confirm the monthly cost, and the platform buys and assigns it live.
- If the provider refuses, nothing is charged twice: the request is queued and the exact provider response is reported back to you. You can then buy it in the provider's own dashboard and paste the number into "Already bought a number yourself?" to connect it without a second purchase.
- The existing number stays switched on and keeps receiving replies from the customers you already messaged; new conversations go out from the new number.

## Step 5 — Prove Glocast is isolated

Checks run and reported back to you:

- Founder plan is not offered to anyone and cannot be chosen by another business; the code only applies to Glocast.
- Another business attempting the code is refused, and its prices stay $200 / $300 with 6c texts.
- Credits are per business: Glocast's balance cannot be spent by anyone else.
- The cost/profit ledger and monthly statements stay invisible to every tenant.

## Technical notes

- Cancel `sub_1UFhC5IPrMBJyWIG1ac2LL6H` in sandbox via the Stripe client; then write `subscription_status='canceled'` with a short `current_period_end` (keeps `accessLevel` at `full` so sending continues) and leave `plan_id='founder'`, `business_promo_codes` and `texto_accounts` untouched.
- Verify/create live prices with lookup keys `founder_monthly`, `sms_credit_pack_500_founder`, `sms_credit_pack_1500_founder`, `sms_credit_pack_5000_founder`; live checkout runs through the existing `createSubscriptionCheckout` with `environment: "live"`.
- Realtime: one Supabase channel in `BillingPanel` / messaging panels on `businesses` (id = business) and `texto_accounts` (business_id = business), invalidating `MY_BILLING_KEY`, `messaging-account`, `settings`; requires realtime on those two tables for the owner's own rows only.
- Number purchase uses the existing `listNumbersForPurchase` / `claimNumberForBusiness` server functions with `TEXTO_ACCOUNT_PROVISIONING=live`; provider errors are audited and surfaced verbatim.
- Provider-cost settlement already books $15/month rental and 3c per credit idempotently by invoice/top-up reference.
