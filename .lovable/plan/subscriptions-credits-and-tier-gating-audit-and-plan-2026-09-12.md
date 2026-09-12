# Subscriptions, credits and tier gating — audit and plan

## 1. What the audit found (verified in code and data)

Working today
- Plans table: Essentials $200/mo, $2,000/yr, 800 texts, 9c overage, 2 team members; Pro $300/mo, $3,000/yr, 1,500 texts, 8c overage, unlimited team.
- Top-up: Settings > Messaging > "Top up credits" (owner only) opens a pop-up with three packs (500/$40, 1,500/$120, 5,000/$400 = 8c each) and an embedded Stripe payment. The Stripe webhook verifies the signature, records the purchase, adds credits to the tenant's number account, and logs an audit event. Duplicate webhook deliveries are ignored.
- Usage tracking: every outbound text is reserved atomically against the monthly included allowance; when the allowance is gone, sends fall through to purchased credits, and are blocked when both are empty. A separate daily safety cap (1,000/month, alert at 80%) also exists.
- Stripe test mode already holds the four plan prices (essentials_monthly/annual, pro_monthly/annual at the right amounts) and the three credit packs.

Gaps
- No subscription checkout exists for Essentials/Pro. The Pricing page buttons just link to sign-in. The only Stripe subscription flow is the old admin-only $99 "paid pilot".
- Nothing tells the app whether a tenant has actually paid: every new business defaults to Pro (`plan_id = 'pro'`) and no page or action checks payment status. `pilot_applications.access_state` gates live SMS only.
- Tier gating is almost non-existent: only reactivation campaigns are checked; the team-member limit is never enforced; campaigns and automation are open to everyone.
- Purchased credits are not actually deducted when used for overage (the overage is logged, the balance never goes down).
- No proactive "credits running low" or "payment failed" reminder: only a red tile on the Messaging page and an internal audit log entry.
- All Stripe calls are hard-wired to test mode; there is no live-mode switch.
- Setup (website scrape) is only offered right after sign-in and can be skipped.

## 2. Commercial model (as confirmed)

```text
                      Essentials            Pro
Monthly               $200                  $300
Annual upfront        $2,000                $3,000
Included credits/mo   900                   1,500
Extra credit          6c                    6c
Dedicated AU number   yes                   yes
Co-work AI            yes (read + act)      yes
Reactivation          no                    yes
Bulk SMS campaigns    no                    yes
Automation rules /    no (defaults only)    yes
follow-up customising
Team members          2                     unlimited
Top-up packs (both)   500/$30  1,500/$90  5,000/$300
```
Internal costs (AI ~$15–30, number $15, SMS 3c) are never shown to tenants; they only ever see credits.

Credits and AI: included credits meter texts (1 credit per SMS segment). AI use stays included in the subscription, protected by the existing per-tenant AI safety cap. Charging AI against the same credit pool is possible later but needs a per-request rate first; it is out of scope here.

## 3. Tenant journey and access states

```text
sign up -> confirm email -> sign in -> /setup (website scrape, auto-onboard)
   -> workspace in "Preview" state (no payment yet)
   -> Upgrade -> choose tier + monthly/annual -> Stripe checkout
   -> webhook marks business "Active" -> number provisioned, credits allocated
```

Business subscription states: `preview` (default for new sign-ups), `active`, `past_due`, `canceled`. Existing tenants that already have a live pilot/number are migrated to `active` on their current plan so nothing breaks.

Preview state — what a tenant CAN do: open every page, view leads, open a lead, upload/import leads (CSV), read business settings, messaging, automation, team, bookings.
Preview state — what is blocked (shows the Upgrade pop-up instead): editing or status-changing leads, sending texts, the Co-work assistant (chat disabled with upgrade prompt), saving business/availability/services, messaging changes and top-ups, automation and campaigns, team changes, booking changes. Blocked both in the UI and on the server, so nothing slips through.

Setup: after sign-in, tenants without a configured business are always routed to `/setup` until they finish or explicitly skip; returning tenants are never sent there.

## 4. Upgrade and billing surfaces

- "Upgrade" button pinned in the tenant sidebar (visible in preview state) and a "Plan & billing" item in the account menu.
- Upgrade pop-up: two tier cards, monthly/annual toggle, feature list per tier, embedded Stripe checkout (same pattern as today's top-up). Reused on the public Pricing page for signed-in users.
- Locked features show a small "Pro" tag; clicking opens the same pop-up on the Pro tier.
- Plan & billing page (`/settings/billing`): current plan, renewal date, status, credits (included used / purchased remaining), top-up button, "Manage billing" (Stripe customer portal for card, invoices, cancel), change tier.
- Top-up stays where it is (Messaging page) and is also reachable from the Upgrade button and low-credit banner.

## 5. Credits: allocation, usage, reminders

- On payment: monthly included credits reset each billing period (from Stripe's period dates); annual plans still reset monthly. Purchased credits never expire and roll over.
- Every send: included allowance first, then purchased credits are actually deducted (fixes the current gap), then blocked with a clear "top up" message.
- Reminders (in-app banner + owner notification + email where enabled): 80% of included credits used, included credits exhausted, purchased credits below 50, payment failed (past_due), subscription canceled. Each fires once per period.
- Past due: 7-day grace with a banner; after that the tenant drops to preview restrictions until payment succeeds. Cancel: access until period end, then preview.

## 6. Stripe — what I need from you

Nothing right now. Stripe test mode is already connected and I create/modify everything in test mode:
- Reuse the four existing plan prices (amounts already correct).
- Reprice the three credit packs to 6c (same price IDs, so live sync stays clean).
- Retire the $99 paid-pilot product from tenant-facing flows (kept for history).
- Webhook already exists; I add the subscription events it does not handle yet.

To go live, you (only you) complete the Payments go-live steps in Lovable (claim your Stripe account, connect the live account) — test products and prices then sync to live automatically on publish. Until then the app stays in test mode; I add a single environment switch so live is a one-line flip.

## 7. Order of work

1. Data: subscription fields on businesses, plan values (900/1,500, 6c), credit-pack repricing, credit deduction fix, migration of existing paying tenants to `active`.
2. Stripe subscription checkout + webhook handling + customer portal + environment switch.
3. Access gate: one shared server check used by every mutating action; UI Upgrade pop-up, sidebar button, locked-feature tags; assistant blocked in preview.
4. Tier gating: team limit, campaigns, automation customisation, reactivation.
5. Reminders and Plan & billing page.
6. Tests for gate/tier/credit maths, Playwright run of the full journey (sign up -> setup -> preview -> upgrade -> top-up), cleanup of test data.

## 8. Technical details

- `businesses`: add `subscription_status`, `billing_interval` (exists), `stripe_customer_id`, `stripe_subscription_id`, `current_period_start/end`, `cancel_at_period_end`, `past_due_since`. `plan_id` default changes from `pro` to `essentials` and only matters once status is `active`.
- New `src/lib/access.server.ts`: `requireActiveSubscription(ctx)` and `requireTier(ctx, feature)`; called after `requireAppContext` in all write server functions (app, owner-actions, owner-assistant, team, reactivation, automation, csv-import commit stays allowed, bookings, tenant-account, messaging-account). Feature keys: `reactivation`, `campaigns`, `automation_custom`, `team_unlimited`. Assistant tool calls that map to gated features return the upgrade message instead of executing.
- `src/lib/billing.server.ts`: add `createSubscriptionCheckout` (plan + interval -> price lookup key, embedded checkout, metadata businessId/planId), handle `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`; period resets `sms_usage_periods` keyed by business (not pilot). `stripeEnv()` reads one config value instead of the hard-coded `"sandbox"`.
- `commercial.server.ts` `authorizeLiveSend`: read subscription from `businesses` (pilot rows only for legacy), and call a new `spend_credits` SQL function (atomic decrement, fails when insufficient).
- `plans` table: `included_segments` 900/1500, `overage_cents` 6, add boolean feature flags `campaigns_enabled`, `automation_custom_enabled`.
- `credit-packs.ts`: 3000/9000/30000 cents; `payments--create_price` with the existing price IDs.
- Reminders: extend existing hourly cron route with a credits/billing sweep writing `notifications` rows and owner email/SMS via existing owner-notification path.
- UI: `UpgradeDialog`, `PlanBadge`, `useSubscription` hook (from `getMyPlan` extended with status), `AppShell` sidebar button, `/settings/billing` route, `pricing.tsx` CTA wiring.
- All checks are per tenant via `business_id`; no tenant is special-cased.
