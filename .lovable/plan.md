# Two-tier pricing, built on what BookedSecure actually does

## What the platform already does for a detailing business

Audited from the live system. Every item below exists today.

**Wins the job**
- Public quote page per business, on their own branding and web address
- AI conversation that asks the right questions, handles corrections, and never invents a price (prices come only from their own service list and add-ons)
- Instant text acknowledgement to every new enquiry, day or night
- Real availability check, booking offers, booking links, change requests, confirmation texts
- Duplicate and returning-customer detection so nobody gets messaged twice

**Chases the job**
- Automatic follow-up sequence (immediate, 4-6 hours, 24 hours) with owner approval
- Reactivation campaigns for dormant past customers, with drafts the owner approves
- Quiet hours, consent checks, STOP handling and opt-out records built in

**Runs the business**
- Lead inbox with statuses, notes, history and pagination
- Their own dedicated Australian mobile number; replies and delivery receipts land in their inbox only
- Import of an existing customer list from a spreadsheet, cleaned and de-duplicated, with phone repair
- Services, add-ons, durations, prices and opening hours set up automatically from their website
- Team access, notifications, reporting on leads, bookings, texts sent, delivery and spend
- Safety caps, spend limits and a hard stop so a runaway loop can never happen
- Full audit trail and per-business data isolation

That is a receptionist, a follow-up chaser, a booking system and a marketing list — running 24/7.

## The two plans

Nothing is itemised to the customer. They see one price, everything included.

| | **Essentials — $200 / month** | **Pro — $300 / month** |
|---|---|---|
| Dedicated Australian number | Included | Included |
| AI quoting and conversation | Included | Included |
| Texts included each month | 800 | 1,500 |
| Follow-up sequences | Included | Included |
| Reactivation campaigns | Not included | Included |
| Customer list import | Included | Included |
| Team members | 2 | Unlimited |
| Extra texts | 9c each | 8c each |
| Annual (pay upfront) | $2,000 (2 months free) | $3,000 (2 months free) |

## The money behind it

| | Essentials | Pro |
|---|---|---|
| Texts at 3c | $24 (800) | $45 (1,500) |
| Number | $15 | $15 |
| AI | $10 | $15 |
| **Total cost** | **$49** | **$75** |
| Price | $200 | $300 |
| **Kept** | **$151 (75%)** | **$225 (75%)** |

Extra texts: sold at 8-9c against a 3c cost, so overage stays at 62-67% kept.
Annual upfront: $2,000 against $588 of cost (70% kept), $3,000 against $900 (70% kept).
AI is billed inside the plan at $10-15 of real cost; a heavy month is absorbed by the margin, and the existing spend cap stops it running away.

## What changes in the product

1. **Two plans instead of one.** The commercial settings row becomes a plan table: `essentials` and `pro`, each with price, included texts, overage rate, and which features are on. Existing pilots keep the terms they signed up under.
2. **Payment options.** Monthly and annual-upfront prices for both plans in the payment provider, so the owner picks at checkout.
3. **Per-plan feature gates.** Reactivation campaigns and unlimited team members switch on for Pro only; Essentials sees an upgrade prompt instead of a locked screen.
4. **Overage instead of a hard wall.** Today sending stops dead at the included allowance. It becomes: allowance runs out, extra texts bill at the plan's rate from the credit balance, and the existing hard cap stays as the safety net far above the allowance.
5. **Top-up packs re-priced to the plan rate** (9c Essentials, 8c Pro) so the price never contradicts itself.
6. **Owner-facing messaging page** shows plan name, texts used out of the included amount, the extra-text rate, credit balance, their number and sending state — never the cost of the number or the AI.
7. **Public pricing page** presenting both plans by outcome (enquiries answered in seconds, follow-ups that never get forgotten, past customers brought back), with the annual option.

## Technical notes

- New `plans` table (id, name, price minor units, billing interval, included segments, overage cents, feature flags) plus `businesses.plan_id`; `commercial_config` keeps the defaults for new invitations and `CommercialTermsSnapshot` gains `planId` and `overageCents` so accepted pilots stay immutable.
- Payment prices to create: `essentials_monthly` $200/mo, `essentials_annual` $2,000/yr, `pro_monthly` $300/yr→$300/mo, `pro_annual` $3,000/yr. `paid_pilot_monthly` stays for existing pilots.
- Send gate order stays consent → quiet hours → allowance → credit balance → daily cap; only the allowance step changes from "block" to "bill from credits".
- Feature gate read from one helper so every surface (reactivation panel, team settings, server functions) uses the same check — no per-tenant hardcoding.
- Tests: allowance-to-overage rollover, overage billing at each rate, feature gates per plan, annual checkout, grandfathered pilots unaffected.

## Open question

Annual upfront at "2 months free" is my recommendation ($2,000 / $3,000). Say the word if you want it steeper or milder.
