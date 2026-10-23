# Roadmap

## Full external-assistant action access
- [ ] Extend caller-scoped shared customer, booking, catalogue and automation actions; keep messaging/import approvals.
- [ ] Expose additional shared campaign/import and operational reads where existing permissions can be preserved safely.
- [ ] Test saved/readback actions using the signed-in account without changing real customer records; regenerate the MCP catalog.
- [ ] Update the connection page and capability coverage honestly; identify any remaining unsupported actions.

## Reuse owner AI actions through MCP
- [x] Audit 36 existing owner actions; share customer/service/add-on/settings mutations and text preparation, reuse the inbox query; generate 15 MCP tools without importing admin clients.
- [x] Pass 100 automated checks for shared actions, account isolation, confirmations and existing regressions; regenerate the catalog and check app compilation.
- [ ] Actual database rollback test and signed-in approval readback are blocked by diagnostic profile-write permissions and no matched requesting-user app account.
- [ ] Remaining owner actions (campaign drafting, imports, booking completion/cancellation, automation and team) need shared caller-scoped boundaries; existing privileged helpers cannot safely be exposed wholesale.
- [ ] External ChatGPT end-to-end verification requires republishing and an approved external connection.

## Guided ChatGPT connection test
- [x] Check current-account ChatGPT approval, run a bounded read-only customer lookup, and explain recovery steps without claiming external tool-call success.
- [x] Pass 38 diagnostic and MCP regression checks; confirm signed-out visitors return to sign-in without runtime errors.
- [ ] Signed-in guided-screen and real ChatGPT read verification await preview sign-in and a completed ChatGPT authorization; no requesting-user preview account is matched.

## External assistant capability coverage
- [x] Add customer/contact pagination, customer history, services, business counts, campaign reports and business settings reads with caller-scoped access.
- [x] Pass 28 checks for tenant scoping, paging, failed reads and existing mutation protections; regenerate the nine-tool external catalog.
- [ ] Real ChatGPT/provider tool discovery and account reads require a completed external OAuth connection and republishing.

## Tenant-owned AI accounts
- [x] Support OpenAI, Anthropic, Gemini and xAI through one key-entry form with provider/model selection; backup only after confirmed credit exhaustion.
- [x] Add encrypted, tenant-isolated key management and direct routing for Cowork, quote chat, extraction, lead analysis, snapshot answers and offer drafts.
- [x] Preserve permissions, confirmations, monthly safety caps and atomic bookings; prevent replay after agent tools start; pass 161 regression checks.
- [ ] Live key connection, provider tool continuation and signed-in backup flow await preview owner sign-in and a tenant-provided API key; no real provider key was supplied.

## External AI account connections
- [x] Activate protected OAuth and add caller-scoped MCP lead/booking reads, note updates and atomic booking saves.
- [x] Add consent, sign-in return handling, and an AI connections page with grant revocation and browser-local reading.
- [x] Run 16 checks, verify anonymous/invalid-token rejection and cross-origin blocking, preserve sign-in/signup return URLs, and extract the four-tool integration catalog.
- [ ] Real-account approval/denial and cross-tenant end-to-end checks require preview sign-in; the requesting user has no matched preview account.
- [ ] Hosted external-client connection awaits republishing and a compatible client account; ChatGPT, Claude and Grok availability is not verified.

## Deleted-lead booking conflicts
- [x] Release scheduled slots when a lead is deleted, preserving job history.
- [x] Repair existing deleted-lead slot blockers for every tenant.
- [x] Reject failed scheduling with a clear error and verify deletion/rebooking regressions (80 checks plus rollback-only database flow).
- [ ] Signed-in browser verification: blocked because the requesting user's preview account could not be matched; requires preview sign-in.

- [x] Add +61 466 907 824 as the customer-facing BookedSecure contact number.

- [x] Hide self-service subscription plans on the public site and inside tenant workspaces; direct access enquiries to BookedSecure.

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

## Five trades, one guided journey, owner control room
- [x] Trade presets for the five headline trades plus office cleaning and test-and-tag.
- [x] Trade picker on the setup page and in Business settings (owner only, audited).
- [x] Six-step guided journey derived from real saved state, shown on Home.
- [x] Paywall: saving imported contacts into the inbox now needs an active subscription.
- [x] Owner control room at /admin/overview: money, subscriptions, provider balance, work queue, businesses.
- [x] PRD for the control room saved to Files.
- [x] Collapse the Home setup journey into an expandable vertical checklist and verify every destination.
- [ ] Blocked on the provider: buying numbers and topping up credits stay manual until their API supports both.

## Detail Dynasty Sydney onboarding
- [x] Add an expiry-aware 14-day trial access state without provisioning a number or credits.
- [x] Create and confirm detail.dynastysydney@gmail.com as the owner of Detail Dynasty Sydney.
- [x] Assign the BookedSecure plan trial and verify full access, zero credits, and no assigned SMS number.
- [x] AI provider router + Control room switch (Cheaper Inference primary, Lovable standby)
- [ ] Save Cheaper Inference key, run health check, live action tests on a test business, then cutover (waits on key)
