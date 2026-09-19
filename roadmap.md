# Roadmap

- [x] Fix mobile chat keyboard layout by tracking the iPhone visible viewport and hiding footer copy while typing.
- [x] Clip service and selected-service card content inside stable mobile card rows.
- [x] Keep short quote conversations anchored above the composer without a focus-triggered page jump.
- [x] Remove the app-controlled bottom gap while the mobile quote input is focused.

- [x] Build the approved tenant home with compact product discovery, full Cowork, and unchanged Operational Details.
- [x] Collapse dashboard performance into one Operational Details button and simplify the opened view.

- [x] Add Select all and tenant-safe bulk editing for personalised campaign drafts.

- [x] Present the Balanced Briefing BookedSecure dashboard visual.
- [x] Apply the approved light command-centre design system.
- [x] Rebuild the desktop shell with a persistent operations rail.
- [x] Restyle the real metrics, campaign review, controls, and lead inbox.
- [x] Add a mobile navigation drawer and verify desktop/mobile layouts.
- [x] Complete final automated checks and preview verification.
- [x] Extend the approved design across all non-dashboard internal pages and forms.
- [x] Redesign the customer quote and AI booking conversation with balanced tenant/BookedSecure branding.
- [x] Align the sign-in, marketing, pilot, privacy, and public fallback pages.
- [x] Verify all redesigned pages on desktop and mobile without changing workflows.

- Fix signup: new accounts must create their own business as owner, not join the first business as staff.
- [x] Replace the separate Assistant and Performance views with the approved Assistant-centred Home layout.
- [x] Add tenant-account conversation history with a default ongoing chat, separate conversations, and deletion.
- [x] Reduce Performance to truthful operational signals with details hidden by default.
- [x] Verify the unified Home experience on desktop and mobile.
- [x] Build the approved two-rail BookedSecure and tenant workspace around real tenant content.
- [x] Integrate Assistant conversation history into the tenant rail without changing behavior.
- [x] Verify rail collapse and responsive navigation across tenant pages.

## Upgrade journey — behind the scenes (approved plan)
- [x] Correct Texto live endpoints to the published spec (accounts, credits, numbers, daily_limit).
- [x] Sync parent-held numbers from Texto into the pool; atomic claim on activation.
- [x] Switch a tenant's old sender off only once a Texto number is assigned; retry on activation.
- [x] Sub-account creation behind TEXTO_SUBACCOUNT_PROVISIONING=live (off by default).
- [x] Expire abandoned credit top-ups after 24h (hourly sweep).
- [x] Platform-admin page /admin/messaging-numbers: sync, waiting tenants, retry, manual add.
- [x] Flip TEXTO_ACCOUNT_PROVISIONING=live and TEXTO_SUBACCOUNT_PROVISIONING=live; live sync verified (account holds 0 numbers, API healthy).
- [x] Grant platform_admin to info@glocast.com.au (admin pages reachable).
- [ ] Blocked on you: in the Texto sub-account setup screen, pick "Allocate credits to each sub-account" and Save settings (API still returns hierarchy_disabled until saved). Then fund the parent balance once (or switch on Texto auto-recharge) so numbers/credits can be issued.

## Hands-off numbers & credits (approved plan)
- [x] Auto-buy a dedicated number from Texto (POST /numbers/purchase) on plan activation; no spare-pool babysitting. $15/mo is inside the $200/$300 plan — no separate Stripe product. (Live contract unverified — do not send real purchases until tested against Texto.)
- [x] Cancel/downgrade path: portal cancel releases the number back locally at period end; no manual overseeing.
- [ ] Auto top-up on saved card when balance drops below tenant's threshold (default $5-worth), with guard rails.
- [ ] Live segment/credit counter under the message composer.

## Provider costs, your cut, and what tenants see (approved plan)
- [x] Private cost ledger per tenant per month (number rental, credits, included-allowance texts).
- [x] Settlement on every paid subscription invoice and credit top-up; idempotent on the Stripe id.
- [x] Monthly statements derived from the ledger (revenue, provider cost, profit, texts) + CSV export.
- [x] Low provider-balance alert with the exact shortfall.
- [x] Nothing tenant-facing changed; the tables have no client read access.
- [ ] Blocked on the provider: no API to add funds to the balance — funding stays manual until they expose one.

## Approach A — platform as carriage provider (approved plan)
- [x] Business identity record per tenant (private table, owner-only writes, admin read).
- [x] Identity form on the Messaging page, shown before the number step.
- [x] Hard gate: no complete identity record, no number bought or connected.
- [x] Admin list of identity records with the numbers they stand behind.
- [ ] Blocked on the provider: first card registration must be done once in their own dashboard.

- [x] Stop the quote chat re-asking the same detail: count asks, add an example, then let optional details go.
- [x] Replace the landing page with the approved copy only (no pilot application form).
- [x] Rebuild the mobile Quote Page with tenant-selectable Focused list, Compact grid, and Guided conversation service displays.
- [x] Align landing-page calls to action on mobile and remove the floating duplicate button.
- [x] Verify the uploaded mobile landing-page screenshots against the corrected button layout.
