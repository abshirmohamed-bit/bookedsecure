# Hands-off numbers, credits and cancellations

## Live test result (done just now, real Texto account)

I called Texto with your live key. Results:

- **Numbers available to take up: yes.** Texto returned a list of clean Australian 04xx numbers at **$15/month each** (e.g. +61480044756, +61480813062-65, all Pivotel).
- **Buying a number by code: yes, it exists.** Texto's endpoint list includes a purchase call for numbers. So the platform *can* buy a number for a business without you logging in. My earlier "you must buy them manually" answer is now out of date — this changes the plan for the better.
- **Numbers currently held by your account: none.** Nothing in your pool yet.
- **Your Texto credit balance: 0.** Needs funding before any real text can send.
- **Sub-accounts are switched off.** Texto replies "Account hierarchy is not enabled for this account". So separate Texto areas per business are not available until Texto turns that on for you.

## What this means for the design

You do **not** need sub-accounts for tenants to have their own private number and their own wallet. One Texto account holds the numbers; BookedSecure locks each number to one business, sends only from that business's number, routes replies back to that business only, and meters that business's credits itself. That already exists and works. Sub-accounts stay an optional later upgrade (ask Texto to enable hierarchy if you ever want it).

## What gets built

### 1. Tenant buys their own number, self-serve
- On the business's messaging screen: "Get your dedicated number" — shows real available numbers pulled live from Texto, at $15/month.
- They pick one, pay through Stripe, and the platform buys it from Texto and locks it to their business in the same step.
- If the purchase fails, the charge isn't kept and they're told plainly to try again — no half-done state.
- No spare-pool babysitting and no alerts to you.

### 2. Tenant cancels or downgrades without you
- Cancel plan: access runs to the end of the paid period, then the number is released back to Texto and unused credits stop.
- Downgrade Pro to Essentials: keeps the number, features drop at the next period.
- Cancel just the number: releases it, stops the $15/month, messaging pauses with a clear "add a number to resume".
- Every one of these is a button in Plan & billing with a confirmation step. All release steps are safe to re-run.

### 3. Auto top-up so reminders never stop
- Optional switch per business: "Keep my balance topped up".
- When their balance falls under a threshold they set (default around $5 worth), the platform charges their saved card for a $20 credit pack and adds the credits immediately.
- Guard rails: one auto top-up at a time, at most a set number per day, off automatically after two failed cards, email/notification either way.

### 4. Credit counter while typing
- A live counter under the message box: characters used and how many texts (segments) it will cost before they hit send. Uses the segment rules already in the codebase.

### 5. Go-live switches
- Turn on live Texto account operations, point delivery and inbound webhooks at the live site, and fund the Texto balance.
- Stripe live mode still needs finishing in the Payments tab before real cards work.

## Technical notes

- `POST /numbers/purchase` and `GET /numbers/available` confirmed present on the live API; wire both into `texto-accounts.server.ts` alongside the existing assign/recall calls, with simulated equivalents for tests.
- Purchase flow: Stripe Checkout for the $15/month number line item, then purchase-on-webhook with an idempotency key; number written to `texto_numbers` + `sms_senders` in one transaction, tenant-locked.
- Release path reuses existing recall logic plus number removal on subscription `canceled`/period end and on explicit number cancellation.
- Auto top-up: saved payment method (`off_session` Stripe charge) triggered by the existing credit-check gate, with a cooldown row so concurrent sends can't double-charge; failures recorded and the switch disabled after repeated declines.
- Admin number pool page stays for oversight but is no longer required for onboarding.
- Sub-account provisioning stays behind `TEXTO_SUBACCOUNT_PROVISIONING`; it will keep returning `hierarchy_disabled` until Texto enables it.
- No schema changes beyond an auto-top-up preference/attempt record and number ownership fields if missing.

## Still needs you (once)

- Add funds to the Texto account so credits can be allocated.
- Finish Stripe live activation in the Payments tab.
