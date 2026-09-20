# Owner mode: what your workspace is for, and how tenants arrive

## First, why you're seeing tenant pages at all

When your owner account was created, the app also created a private business for it
("BookedSecure Platform"). So you are signed in wearing two hats at once, and the sidebar
is showing the tenant hat. That's why you see a "choose a plan" bar and "Get set up! 0 of 6"
in your own account — both belong to a customer, not to you.

What each item is actually good for **to you**:

| Item | Relevance to you as platform owner |
| --- | --- |
| Home (Cowork) | Your assistant. Useful — ask it about your own numbers and tenants. Keep. |
| Bookings, Lead inbox, Unfinished prospects | Only meaningful for a real trade business. For you: a sandbox to see exactly what a tenant sees. |
| Import data | Same — a sandbox, plus the place you'd help a tenant load their old list. |
| Business settings, Messaging, Automation | Sandbox / support: reproduce a tenant's problem, test a quote page, test the AI agent. |
| Team access | Adding your own staff/operators later. |
| Plan & billing | Not for you. You don't pay yourself. |
| Control room | **This is your real screen**: money, profit, work queues, tenants. |

So nothing is wrong with the pages — the problem is that your account presents itself as a
customer instead of as the platform, and there is no funnel view for tenants arriving from ads.

## What to change

### 1. Make the owner hat explicit
- Sidebar header reads **Platform owner** (not "Tenant workspace") for your account, with the
  BookedSecure mark instead of the "B" tile.
- Control room moves to the **top** of the sidebar for platform admins, and signing in keeps
  landing there.
- In your own admin workspace: hide the "choose a plan" bar and the "Get set up!" checklist
  (they are tenant onboarding, and you are exempt from billing already).
- Tenant pages stay reachable, grouped under a clearly labelled **Sandbox (what tenants see)**
  section so you know you're wearing the other hat.

### 2. A tenant funnel you can point ads at
- A public **Start free setup** page (`/start`) that accepts `?ref=` / campaign tags, records
  where the signup came from, and drops the new business straight into the 6-step journey:
  trade → website scrape → check details → compliance → subscribe → import + first campaign.
- Store the source on the business row so every tenant is attributable to a campaign.
- An **invite link** in the control room you can paste into ads, emails or a partner page.

### 3. A pipeline view in the control room
A new "Tenants arriving" panel above Businesses:
- signups this week/month, and where they came from
- which step each unconverted signup is stuck on (no trade, no website, no compliance, no plan)
- conversion: signups → subscribed, and days to subscribe
- one-tap actions: nudge by email, open their workspace read-only, mark as lost

### 4. Fix the noise in the screenshot
- Preview/billing bar and setup checklist suppressed for platform admins.
- Sidebar mark and title corrected.

## Technical notes

- Reuse `getPlatformAccess` / `isPlatformAdmin` (already on the session) to branch the shell;
  no new access rules.
- `AppShell.tsx`: owner header, nav ordering, sandbox label. `OnboardingJourney` and
  `SubscriptionBanner` return `null` when `isPlatformAdmin`.
- Migration: `businesses.signup_source text`, `businesses.signup_ref text` (nullable, no default),
  plus grants unchanged; written by the public signup path only.
- `/start` is a public route (SSR on, no auth gate) that hands off to the existing auth +
  `/setup?step=trade` flow, persisting the campaign tags through sign-up.
- `owner-console.server.ts` gains a `pipeline` section (signup counts, stuck step derived from
  the existing `buildOnboardingSteps` logic, subscribed conversion) rendered in `admin.overview.tsx`.
- Glocast Founder entitlements, tenant isolation and the manual number/top-up queues are untouched.
