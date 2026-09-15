# Provider costs, your cut, and what tenants see

## The money flow, confirmed

1. A tenant pays your Stripe: $200 or $300 a month, or a credit top-up.
2. The moment that payment clears, the system works out the provider's share of it:
   $15 for their number that month, plus 3c for every credit the payment buys them.
3. That share is spent with the provider straight away — their number renewed, their
   credits loaded — from your provider balance.
4. Everything left over is your cut and stays in your Stripe.
5. Repeats automatically each month while the subscription is active, and on every top-up.

The provider never charges a tenant's card; there is one provider account (yours) and
tenants have no login or card there. Their card is charged once, by your Stripe.

## What tenants see

Unchanged and deliberately plain: "$200/month" or "$300/month", their number, how many
texts are left, and a Top up button. No provider name, no $15 line, no 3c figure, no
cost or margin anywhere. Glocast keeps seeing their $15 Founder price and 3c credits.

## What you see

Every month, per tenant: texts sent, number cost, credit cost, total provider cost,
what they paid you, and the profit. Stored in the database and pulled on request — ask
me for "last month's costs and profit" and you get a spreadsheet. No admin screen.

Plus a warning when your provider balance drops below a level you set, so tenant texts
can never stop because the supplier balance ran dry.

## What gets built

**1. A cost ledger**
Every provider charge the platform incurs is written down against the tenant that caused
it: number rental for the month, credits bought, and the 3c-per-text cost as texts go
out. Each row records the tenant, the month, what it was for, and the amount.

**2. Automatic settlement on every payment**
When a subscription payment or a top-up settles, the system splits it: provider share
spent immediately with the provider, remainder recorded as your margin. Runs once per
payment even if the payment notification arrives twice, so nothing is double-spent or
double-counted.

**3. Monthly number rental**
On each renewal, each tenant holding a dedicated number gets the $15 recorded against
them and paid to the provider. Tenants who cancel stop being charged the moment their
number is released.

**4. Provider balance funding and alerts**
The system tops your provider balance up automatically if the provider's API allows it.
If it doesn't, each tenant's share is still reserved and reported, and you get an alert
when the balance falls below your threshold — with the exact amount needed.

**5. The monthly statement**
One record per tenant per month: revenue, provider cost, profit, texts sent. Exportable
as a spreadsheet for your accountant.

## Technical notes

- New tables: `provider_costs` (business_id, month, kind: `number_rental` | `credits` |
  `message`, quantity, amount_cents, source reference, created_at) and
  `tenant_month_statements` (business_id, month, revenue_cents, provider_cost_cents,
  margin_cents, segments_sent, generated_at), both with GRANTs, RLS restricted to
  platform admin/service role — tenants have no read path.
- Cost rates live in config, not in code: `PROVIDER_NUMBER_COST_CENTS` (1500) and
  `PROVIDER_CREDIT_COST_CENTS` (3), so a supplier price change is one value, tenant-agnostic.
- Settlement hooks into the existing payment webhook path
  (`src/routes/api/public/payments/webhook.ts` → `subscription-billing.server.ts` and
  `credit-topups.server.ts`), keyed on the Stripe event id for idempotency, so a replayed
  event can never spend twice.
- Provider funding attempted through the provider API; probe first, and fall back to a
  reserved-but-unfunded state plus an alert when the endpoint isn't available (the
  `/numbers/purchase` route already showed the published spec is incomplete).
- Balance alerts reuse the existing operator alert path in `texto-accounts.server.ts`.
- Statement generation runs on the existing cron route pattern under
  `src/routes/api/public/hooks/`, plus an on-demand rebuild so a mid-month pull is accurate.
- Nothing in tenant-facing components changes; the split is server-side and admin-only.
- Tests: settlement split across both plan prices and every credit pack, replayed webhook
  idempotency, cancelled tenant stops accruing rental, zero-included Founder pricing at 3c,
  and a check that no tenant-facing query can read the cost tables.

## Still needs you

- Funding your provider balance if the provider has no API for it — I'll report the exact
  amount and whether automatic funding worked.
