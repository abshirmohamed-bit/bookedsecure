# Five trades, one hands-off journey — plus your owner control room

## What I verified in the app today

- New signups already create their **own** business and the person becomes owner (the old roadmap worry is no longer true). Staff only join when invited.
- Website scrape onboarding exists at `/setup` and fills in business details, services, prices and hours for review.
- The import page, campaign drafts, Cowork assistant, compliance record, plan/subscription engine, provider cost ledger and admin number pool page all exist.
- The app has **no notion of a trade/industry**, so every new business gets detailing-flavoured defaults.
- Nothing currently marches a new owner through the journey in order: setup → compliance → subscribe → import → first campaign. Each part is reachable, but the path is not enforced or signposted.
- There is no single owner-of-the-platform money screen; `/admin/*` covers numbers, identities, feedback and pilot applications only.

## What we build

### 1. Trade presets (five, plus two extras)

A trade is chosen during signup and stored on the business. It seeds service names, typical re-service cycle, quote questions and follow-up wording:

| Trade | Re-service cycle used for follow-ups |
| --- | --- |
| Auto & marine detailing | 4–6 weeks |
| Lawn & garden maintenance | 2–4 weeks summer / 6–8 weeks winter |
| Mobile pet grooming & hydrobathing | 4–6 weeks |
| Swimming pool servicing | 4 weeks year-round |
| Commercial & high-end window cleaning | 4–8 weeks |

Also available: commercial & office cleaning, test and tag. Existing businesses keep their current setup untouched; anything already filled in is never overwritten.

### 2. Guided onboarding, in order

A progress strip that follows the new owner until finished:

```text
1 Your trade      2 Your website    3 Your business details
4 Subscribe       5 Import old customers   6 First campaign
```

- Step 2 scrapes their website and pre-fills services, prices and hours for approval.
- Step 3 collects the compliance details we need for a number (business name, ABN, website, address, contact, declaration) — unchanged from what we collect today.
- Step 4 is a **hard paywall**: setup and scraping are free, but after that nothing opens — no importing, no campaigns, no sending — until the subscription is paid.
- Step 5 drops them straight on the upload page for their old customer list.
- Step 6 offers the two ways to start: pick leads themselves (one, several, or all), or ask Cowork on the home page to do it.

### 3. Campaigns from anywhere

- A single lead's page gets a "Start a campaign" action.
- The leads inbox gets select-all / select-many with one campaign action for the selection.
- Cowork on the home page can propose the same campaign for the same leads, still with your approval before anything sends.
All three paths end at the same drafts-for-approval screen, so wording, consent and tenant isolation rules stay identical.

### 4. Numbers and credits stay manual — but honest

Until provider automation is possible, the app says so plainly: after subscribing, the business sees "your number is being set up" and top-ups are requested rather than self-served. Both land in **your** work queue (below), and nothing pretends to be automatic.

### 5. Your owner control room — `/admin`

Money first, exactly as chosen:

- **Money**: monthly revenue, provider cost, profit, profit per tenant, credit-pack sales, subscriptions active / past due / cancelled, provider balance with the shortfall.
- **Work queue**: businesses waiting on a number, waiting on a top-up, compliance record incomplete, payment failed.
- **Tenants**: a list showing trade, plan, subscription state, number, credits, leads imported, messages sent, profit this month.
- Placeholders for the two options you want later: deeper tenant control switches, and an approvals view.

Everything here is platform-admin only and read-mostly at first: the actions are the ones you already do (mark a number assigned, record a top-up, retry provisioning).

## Audit, test and repair pass

Alongside the build I go through and fix, with tests:

- Signup → own business → owner role, on a real account.
- Scrape a real site for each of the five trades and check what comes back.
- Paywall: confirm importing, campaigns and sending are all closed before payment and open after.
- Compliance gate: no number issued without a complete record.
- Import a messy contact file end to end.
- Campaign from one lead, from many, and via Cowork — all requiring approval.
- Tenant isolation: no business can see another's leads, numbers, credits or money.
- Glocast's founder pricing and entitlements untouched throughout.

Findings that are broken get repaired in the same pass; anything that depends on the provider (number purchase, automatic top-up) is reported as blocked rather than faked.

## Technical notes

- Migration: `businesses.trade` (text, nullable, checked against the preset list) and an onboarding-step marker; grants and RLS follow the existing tenant pattern. No destructive change.
- New `src/lib/trades.ts` pure module: preset ids, labels, service seeds, re-service cycles, follow-up cadences, `resolveTrade()`.
- Trade seeds feed `site-onboarding.server.ts` (fill only empty fields) and the follow-up cadence resolution used by reactivation.
- Onboarding progress derived server-side in `site-onboarding.server.ts` from real state (services saved, identity complete, subscription active, imports present, campaign created) — no new client-held flags.
- Paywall enforced in server functions via the existing `requireActiveSubscription` on import commit, campaign creation and send paths; UI shows a subscribe prompt rather than a dead button.
- Campaign entry points reuse `reactivation`/campaign draft server functions; selection UI extends `LeadsWorkspace`; Cowork path uses the existing assistant proposal + approval gate.
- Owner control room: new `/admin/overview` route reading `provider_costs`, `tenant_month_statements`, `businesses`, `sms_usage_periods`, `import_automation_state` through platform-admin-only server functions (no client reads of private tables). CSV export reuses the existing statement export.
- Tests: new unit tests for `trades`, onboarding progress, paywall gates and campaign selection; Vitest, typecheck and build must pass; browser checks at phone and desktop size.

## PRD for the owner screen

I write `/mnt/documents/bookedsecure-owner-console-prd.md`: purpose, who it is for, the money definitions (revenue, provider cost, profit, credits), each panel and its data source, the work-queue rules, the actions allowed now, the two future control views, access rules, and what is deliberately out of scope until provider automation exists.
