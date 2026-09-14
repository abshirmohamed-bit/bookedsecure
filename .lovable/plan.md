# Promo codes, Glocast's lifetime pricing, and a live buy-the-number test

## What you asked for, confirmed back

- A promo code feature in the platform. Glocast types **USAMAH** once and it sticks to their account **for life**.
- With that code applied, Glocast pays **$15/month** for their plan (everything Pro has, 1,500 included texts a month) and **3c per text credit** on top-ups, instead of 6c.
- The cheap pricing exists in the system but is **invisible to every other tenant** — nobody else sees it and nobody else can redeem the code.
- Everything stays self-serve for every tenant: they sign up, pay, and get their number without you.
- Then I log in as Glocast, apply the code, and press the real buttons to start the $15 plan and claim their number.
- Glocast's ABN **20 284 379 143** and website **https://glocast.com.au/** get saved on their business record.

## How it stays fair and safe

The promo code is a proper feature, not a Glocast shortcut hidden in the code. A code is a row you can create, expire, or switch off, with three limits on it:

- how many businesses may ever redeem it (USAMAH: exactly one),
- which business it is reserved for (USAMAH: reserved for Glocast, so even a leaked code is useless to anyone else),
- what it changes (the $15 plan and the 3c credit price).

Once redeemed, the discount is written to that business permanently — cancelling and re-subscribing keeps it. Any future code (a launch offer, a partner deal) uses the same machinery.

## What gets built

**1. Promo codes**
New records for codes and redemptions, plus a "Have a promo code?" box on Plan & billing that only the business owner sees. Enter a valid code and the page immediately shows the new prices; enter a wrong or already-used code and it says so plainly and changes nothing.

**2. The hidden $15 plan**
A plan called Founder: $15/month, all Pro features, 1,500 included texts, extra texts 3c. It is marked not-offered, so it never appears on the pricing page, the public plans list, or any other tenant's billing page. It only appears for a business holding a code that grants it.

**3. Discounted credit packs at 3c**
Alongside the normal packs (500/$30, 1,500/$90, 5,000/$300), a discounted set at 3c per credit (500/$15, 1,500/$45, 5,000/$150). Whichever set the business is entitled to is the one shown, the one charged, and the one automatic top-ups use — the price is checked again on the server after payment, so the UI can never buy the cheap pack for a full-price tenant.

**4. Glocast's record**
ABN and website saved against the business, shown on their business settings page.

**5. Proving it works**
I test the whole path with Stripe test cards (nothing charged): apply the code, start the $15 plan, confirm the plan turns on, then buy a 3c credit pack and confirm the credits land. I also check a second tenant sees only $200/$300 and 6c, and that the code is refused for them.

## Then the number

After payment activates, the platform automatically claims Glocast's dedicated Australian number. The number provider isn't switched on for real purchases yet, so as you chose, Glocast's request **queues** and the number is claimed automatically the moment the provider is live — no further work from you. Their existing sending number keeps working until then.

## What still needs you

- The **real** $15 live payment has to be pressed by you with a real card — I can only run test payments. Everything up to that point will be verified.
- The number provider still needs funding and switching on before a real Australian number can be bought.
- The two new Stripe items (the $15 Founder price and the three 3c credit packs) are created in test and go live when you publish.

## Technical notes

- Migration: `promo_codes` (code, plan_id override, credit price cents, max redemptions, reserved business, active, notes) and `business_promo_codes` (business_id + code, unique per business, applied_at/by) with GRANTs and owner-scoped RLS; `abn` and `website_url` columns on `businesses`. Seed row for `USAMAH` reserved to `11111111-1111-1111-1111-111111111111`, max 1 redemption, granting plan `founder` and 3c credits. Seed the `founder` plan row with `is_offered = false`, Pro feature flags, `included_segments 1500`, `overage_cents 3`, price keys `founder_monthly` / `founder_annual`.
- `src/lib/promo.server.ts`: `resolvePromoEntitlement(businessId)` → `{ planId | null, creditPackSetId }`, plus `redeemPromoCode`. `getPlanForBusiness` and `listOfferedPlans` (per-tenant variant) consult it, so `requirePlanFeature`, usage periods and seat gates need no change.
- `credit-packs.ts` becomes `packsFor(setId)` with `standard` and `founder_3c` sets; `createCreditTopupCheckout`, `auto-topup.server.ts` and `BillingPanel` all resolve packs through the entitlement, and settlement keeps re-validating the settled amount against the stored pack row.
- `createSubscriptionCheckout` already resolves the Stripe price by lookup key from the plan row, so the Founder plan needs no new checkout branch; `planFromPrice` picks up `founder_monthly` from the same table on webhook sync.
- Stripe objects created with the payments tool: `founder_plan` (`founder_monthly` $15/mo AUD, `founder_annual` $150/yr AUD) and `sms_credit_pack_500_founder` / `_1500_founder` / `_5000_founder`.
- Tests: promo redemption (valid, wrong code, reserved-to-another-business, already redeemed, lifetime persistence after cancellation), entitlement-driven plan and pack resolution, and a regression that a business with no promo still sees 6c packs and only Essentials/Pro.
- Verification: `tsgo`, full vitest, build, then authenticated Playwright as Glocast through `/settings/billing` — apply code, sandbox checkout with `4242 4242 4242 4242`, assert plan card shows Founder $15 and packs show 3c, buy the 500-credit pack, assert balance and `credit_topups` row, and read the provisioning audit event confirming the number is queued.
