# One $100 plan, tenants get their own number and credits at Texto

## Audit — what exists today (verified)

- **Plans in the database:** Essentials $200/mo ($2,000/yr, 900 texts), Pro $300/mo ($3,000/yr, 1,500 texts), plus a hidden Founder plan $15/mo with 0 texts. Overage 6c (Founder 3c).
- **Stripe:** real embedded Checkout for subscriptions (`subscription-billing.server.ts`) and credit packs (`credit-topups.server.ts`); live signed webhook at `/api/public/payments/webhook` feeding `billing.server.ts`.
- **Credit packs:** two price sets — standard 500/$30, 1,500/$90, 5,000/$300 and a 3c founder set. Purchases add credits locally and allocate to the tenant's Texto sub-account when live.
- **Numbers:** the Messaging page has a "Your own number" panel that lists provider numbers, buys them over Texto's API (charging the platform card) or connects a number pasted by hand. Provisioning on paid invoices tries the same purchase and queues on failure.
- **Texto sub-accounts:** create, credit allocate/recall, number assign/recall and reporting are all already implemented; there is no funding or credit-purchase API, so the parent balance must be topped up manually.
- **Nothing today points tenants at your Texto sign-up link.**

The gap versus what you now want: the number is bundled and bought on your card, pricing is two tiers, and there is no self-serve path for a tenant to get their own number or top up at Texto.

## What changes

### 1. One plan

- Retire Essentials and Pro (hidden, existing tenants untouched until they move).
- New single plan: **$100 a month**, everything included — win-back campaigns, bulk campaigns, custom automation, unlimited team. **No texts and no phone number included.**
- Annual option at the same 10-months-for-12 ratio unless you say otherwise ($1,000/yr).
- Founder stays exactly as it is for Glocast.
- Pricing page and billing panel show one plan and say plainly that the number and texts are bought separately.

### 2. Number: tenant buys it at Texto, we detect it

- Remove the "Your own number" panel (available-number list, claim, and manual connect) entirely.
- Replace it with a short "Get your texting number" card: what it costs at Texto ($15/month + GST), and a button to your sign-up link `https://app.texto.com.au/signup?r=bookedsecure`, which creates them as your sub-account automatically.
- After they buy, BookedSecure detects it: on page load and on a "I've bought my number" button, we read your Texto accounts and their numbers, match the sub-account to the tenant, store the number and switch it on as their sending number. Existing Telnyx numbers stay active so old replies keep arriving.
- Automatic purchase-on-your-card is switched off, so your card is never charged for a tenant again.

### 3. Credits: tenant's choice

- **Buy through BookedSecure** — the existing credit packs stay, and on payment we allocate those credits into their Texto sub-account from your parent balance (this is where your margin lives). This requires you to hold a credit balance at Texto; the existing low-balance alert covers it.
- **Buy at Texto** — same card the tenant already used for the number, with Texto's own automatic top-up. A second button on the credits card links them there. No margin on these.
- Both paths show the same live balance, so a tenant topping up at Texto sees it in BookedSecure.

## What tenants see

One $100/month plan for the platform. A card telling them to get their $15/month number at the provider, and a credits card where they can buy packs from us or top up at the provider themselves. No manual step for you, ever.

## Technical notes

- `plans` row insert for the new `platform` plan (all feature flags on, `included_segments = 0`, `team_member_limit` null) plus `is_offered = false` on essentials/pro; Stripe products/prices `platform_monthly` / `platform_annual` created via the payments tools in sandbox and live.
- Delete `DedicatedNumberPanel.tsx` and its `listNumbersForPurchase` / `claimNumberForBusiness` usage; keep the server helpers used by admin tooling.
- New `TextoSignupPanel` + a `linkTextoSubAccount` server fn that walks `GET /accounts`, `GET /account/:id/numbers` and writes `texto_accounts` / `texto_numbers`, matching by sub-account email or slug reference.
- `provisionMessagingForBusiness` no longer calls `purchaseNumberFromTexto`; it links an already-purchased number or leaves the tenant in `queued_no_number` with a self-serve prompt.
- Credit-pack payment path unchanged; it already allocates into the sub-account. Provider-cost ledger keeps recording rental and text cost per tenant.
