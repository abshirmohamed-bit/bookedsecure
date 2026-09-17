# One payment from tenants, margin to you, Texto paid by the platform

## The decision

Keep **one** Stripe payment per tenant. Do not split it into three payments and do not let tenants pay Texto directly.

Reason: the moment a tenant pays Texto with their own card, they see Texto's prices ($15 number, 3c texts), your margin becomes visible, and you get two billing relationships, two dunning flows and two cancellation paths for the same customer. Of Texto's three funding modes, the only one that fits a bundled $200/$300 product is **"Allocate credits to each sub-account"**.

So the money flow is:

```text
Tenant  --$200/$300 (one Stripe subscription)-->  BookedSecure (your account)
BookedSecure --platform card / prepaid balance--> Texto  ($15 number + 3c texts)
Remainder stays in your Stripe balance = your margin
```

Your card at Texto is the only card in the chain. Tenants never see Texto.

## Why it felt broken

Nothing in the payment design is wrong. The one gap is that Texto's balance has to have money in it before the platform can buy a number or allocate credits, and Texto has no funding API yet. That is a Texto account setting, not something our code can fix. Until they enable auto-recharge or an invoicing arrangement, you keep a float in the Texto balance and top it up occasionally — that is one action a month, not one action per tenant.

Number purchasing itself is now unblocked: the card is registered on the Texto account, so the platform can buy numbers over the API from here on.

## What we build

1. **Texto sub-account per tenant** — created automatically on first paid invoice, funding mode "allocate credits", Sender ID/number sharing off, so each tenant has its own wallet and cannot spend beyond what we allocate.
2. **Automatic number purchase** — on first paid invoice, buy one Australian number through Texto's API and assign it to the tenant's sub-account. If the provider refuses (no balance, KYC, route), the tenant is queued and you get one alert; every subsequent paid invoice retries automatically.
3. **Automatic credit allocation** — each paid invoice allocates that month's included texts into the tenant's sub-account wallet. Credit-pack purchases allocate on top.
4. **Balance guard** — before any purchase or allocation, check the Texto balance. If it cannot cover the month ahead, alert you with the exact shortfall instead of failing silently.
5. **Private books** — the existing per-tenant cost ledger keeps recording $15 rental + text cost + GST against each tenant so revenue, provider cost and margin per tenant stay visible to you only.

## GST

Your retail prices should be stated GST-inclusive, since your tenants are Australian consumers of your service: $200 and $300 include GST (so $181.82 + $18.18 and $272.73 + $27.27). Texto's $15 + $1.50 GST is a cost to you and the GST on it is an input credit, not something to pass through as a separate line. Two changes needed: mark Stripe prices as tax-inclusive for AU, and record provider costs GST-inclusive at $16.50 so your margin figure is true.

## What tenants see

One line: their plan at $200 or $300 per month, GST included, with their own number and their texts included. No number line, no credit line, no Texto.

## Technical notes

- Stripe: enable AU tax behaviour `inclusive` on the plan prices and credit packs; no new checkout flows.
- Texto: turn on account hierarchy with slug `bookedsecure`, funding "allocate credits", sharing off, and confirm sub-account create/allocate/assign endpoints respond for our key.
- Provisioning stays in the invoice-paid path in `src/lib/subscription-billing.server.ts` calling into `src/lib/sms/texto-accounts.server.ts`; add sub-account create + credit allocate + balance precheck there.
- Cost ledger in `src/lib/provider-costs.server.ts` moves to GST-inclusive rates ($16.50 rental, 3.3c per text).
- Still waiting on Texto for auto-recharge / credit-purchase endpoint / monthly invoicing — any one of the three removes your monthly top-up entirely. Nothing else in this plan depends on it.
