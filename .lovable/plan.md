# Move the pilot to $300/month with 1,000 texts included

## What changes for the customer

Today a pilot is **AUD $99/month with 250 text segments** for 30 days (that is what the price record and the included-allowance setting currently say, and the checkout panel prints it).

New offer, one flat price:

| What they get | Included |
| --- | --- |
| Their own dedicated Australian number | Yes — no extra charge |
| Text messages | 1,000 per month |
| AI replies, quoting, follow-ups, reactivation | Included |
| Lead inbox, booking links, reporting, team access | Included |
| Price | **AUD $300 / month** |

## The money behind it

| Line | Monthly cost |
| --- | --- |
| 1,000 texts at 3c | $30 |
| Dedicated number | $15 |
| AI | $10 |
| **Total cost** | **$55** |
| Price | $300 |
| **Left over** | **$245 (about 82%)** |

Extra texts beyond the 1,000 are bought as top-up packs, which already exist on the Messaging page. To keep the story simple and margins consistent, the packs get re-priced to a flat 5c per text:

| Pack | Now | New |
| --- | --- | --- |
| 500 | $25 | $25 (unchanged) |
| 1,500 | $65 | $75 |
| 5,000 | $195 | $250 |

Every pack stays profitable (3c cost, 5c sold). Say the word if you'd rather keep the volume discounts as they are.

## What happens when the 1,000 run out

Sending stops cleanly at 1,000 for the month (this is how the allowance already behaves — a hard stop, never a surprise bill). The owner sees a clear message on the Messaging page with the top-up buttons right there. Replies and opt-outs keep being recorded either way.

## Businesses already on the old price

Anyone already paying keeps the terms they signed up under — each pilot stores its own frozen copy of price and allowance at invite time, so the change only applies to new invitations. Nothing re-bills, nothing changes mid-month for existing pilots.

## Work to be done

1. **New price record** — create a $300/month AUD price under the existing pilot product, reusing the current price key so it replaces the old amount cleanly for new checkouts.
2. **Update the pilot terms** — set price to $300 and included texts to 1,000 in the single commercial settings row, and bump its version so new invitations snapshot the new terms.
3. **Fix the wording everywhere it's printed** — the admin checkout panel currently hardcodes "AUD $99.00 / month · 250 SMS segments"; make it read the real configured price and allowance instead of a hardcoded string, so this never drifts again.
4. **Re-price the top-up packs** — one shared list feeds both the buttons the owner sees and the amount checked after payment, so it changes in one place; new Stripe amounts created for the two packs that move.
5. **Align the safety cap** — the monthly safety cap defaults to 2,000 texts while the plan includes 1,000; set the default to match the plan so the two limits can't contradict each other.
6. **Owner-facing summary** — show "1,000 of 1,000 texts included this month" and the plan price on the Messaging page next to the credit balance, so what they bought and what they've used sit side by side.
7. **Checks** — update the tests that assert the 250 allowance and $99 amount, plus a test that a pack's Stripe amount must match the shared list before credits are added.

## Technical notes

- Price/allowance live in the singleton `commercial_config` row (`pilot_price_minor_units`, `included_sms_segments`, `configuration_version`); accepted pilots keep an immutable `CommercialTermsSnapshot`, so grandfathering is automatic.
- Stripe price created via the payments tool with the existing lookup key `paid_pilot_monthly` under product `bookedsecure_paid_pilot` (amount 30000, aud, month, qty 1–1). New amount takes over the same lookup key.
- Hard cap already enforced atomically by `reserve_sms_segments`; `withinSegmentCap` mirrors it. No change to enforcement logic, only to the included number.
- Pack changes in `src/lib/sms/credit-packs.ts`; amounts re-verified against Stripe in `credit-topups.server.ts` before allocation, so the two must be updated together.
- `usage_limits` default `monthly_segment_cap` 2000 → 1000 in `src/lib/usage.server.ts` (existing rows left alone unless you want them reset).
- Number cost stays an internal platform cost — no tenant-facing number purchase, matching the current platform-managed number pool.

## Still true regardless of pricing

Live texting stays switched off until Texto approves the BookedSecure registration, and real card payments only start once Stripe go-live is finished. Everything above can be set up and verified in test mode before then.
