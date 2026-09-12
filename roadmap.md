# Roadmap

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
- [ ] Replace the separate Assistant and Performance views with the approved Assistant-centred Home layout.
- [ ] Add tenant-account conversation history with a default ongoing chat, separate conversations, and deletion.
- [ ] Reduce Performance to truthful operational signals with details hidden by default.
- [ ] Verify the unified Home experience on desktop and mobile.
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
- [ ] Blocked on you: flip TEXTO_ACCOUNT_PROVISIONING=live after buying numbers at Texto; assign a platform_admin role to reach admin pages; finish Stripe go-live in the Payments tab.
