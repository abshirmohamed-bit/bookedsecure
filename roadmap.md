# Roadmap: Facebook → Make lead import completion

## Glocast "one tool" plan: what's left
- [x] Phase 1: booking confirmation email and text on every new booking, with a per-booking switch and send log; tested live.
- [x] Phase 3: Facebook and Instagram drafts, approval, calendar and post figures; tested live.
- [x] Google Ads Basic access: design document written (docs/google/google-ads-api-design.pdf).
- [ ] Google Ads Basic access: owner submits the token application in Google Ads → API Center with the PDF attached; review takes about 2–5 business days.
- [ ] Google Ads: after approval, set GOOGLE_ADS_DEVELOPER_TOKEN, connect Glocast's account in Ad results, and check the figures against Google Ads.
- [ ] Competitor ads (to replace Adspirer): decide whether to build a competitor tracker with saved Facebook pages, one-click Meta Ad Library links and notes. Meta's Ad Library API only returns Australian ads that are political or about social issues, so competitors' ordinary ads can't be pulled in automatically.
- [ ] TikTok scheduling: owner creates a TikTok developer app and applies for the Content Posting API. Until TikTok audits the app, posts can only be private, for up to 5 accounts a day. The build reuses the social planner.
- [ ] Shared email inbox (to replace Outlook for customer email): only if Glocast asks; Replies already covers campaign replies.

## Project monitoring fixes
- [x] Give browser-rendered video frames valid durations and surface muxing failures.
- [x] Preserve dragged caption positions through preview and save validation.
- [x] Open Home's social review link on a network that has comments waiting.
- [x] Let sign-out finish when push-device cleanup fails.
- [x] Run 40 focused regression checks and verify the preview build; sandbox Chromium cannot decode H.264 or encode AAC for a full real-video render.

## ChatGPT customer-tools audit
- [x] Read-only diagnosis: live MCP repeatedly returned 401 invalid_token before list_leads/query_leads executed; OAuth discovery, signing keys, account grant, tenant RLS and data reads passed.
- [x] Verified Prashant (not Preshant) through base-lead and inbox reads, one message and no bookings; 53 focused tests passed without mutations or SMS.
- [~] External ChatGPT tool verification waits for the owner to reconnect BookedSecure in ChatGPT and retry the read-only test; no production code or security change is currently indicated.
- [x] 9 Nov retry: still 401 invalid_token on every call; no live ChatGPT sign-in session exists and no new approval since 23 Oct, so ChatGPT never actually re-signed in. Approval flow verified reachable.
- [ ] Save Prashant's 9 Nov internal note (no booking) after reconnect or on owner request.


## Faster installed app
- [x] Preserve existing installation and Firebase push; cache static app files only, excluding customer data, API responses and OAuth.
- [x] Verify 27 safety/push checks, clean app checks, no preview app-cache worker, unchanged install path and mobile offline screen.
- [ ] Measure published iPhone loading and cached-file reuse after deployment; real device required, and signed-in local testing unavailable because the requester has no matching app account.

## Browser push notifications
- [x] Verify existing Firebase credentials without recreating or replacing them.
- [x] Add owner-scoped device registration, messaging worker, immediate push and optional SMS fallback.
- [x] Verify 54 focused tests, signed-in owner settings, blocked-permission handling, worker activation and mobile layout.
- [ ] Confirm a real device receives foreground/background new-enquiry push after publishing and enabling on that device; sandbox browser push subscription is refused (permission denied).

## New-lead owner SMS
- [x] Send one immediate, tenant-scoped owner SMS for every genuinely new inbox lead; suppress duplicates and re-imports.
- [x] Cover quote, Facebook/Make, web-chat and manual lead paths, preference/credit/sender safeguards and focused tests without live SMS; historical bulk imports stay excluded.

## Direct Meta preview
- [x] Add isolated server transport and reuse run/checkpoint/enrichment importer without changing Make.
- [x] Keep direct access and scheduling blocked pending authorized configuration, genuine access test and owner election.
- [x] Run mocked isolation, pagination, dedup and credential tests; report live-access blocker without importing or publishing.

- [x] 1. Preserve whole enquiry: raw answers stored, mapped into existing lead fields
- [x] 2. Request type vs booking status: imports create quote/service enquiries only, never bookings
- [~] 3. Conversion tracking: enquiry→booking link exists via lead; no external booking-provider connection exists yet (bookings come from owner action or assistant booking tools only)
- [x] 4. Safe reimport enrichment: fill-only patch, "enriched" outcome distinct from "duplicate"
- [x] 5. Make payload contract unchanged (field_data passthrough); needs publish before live test
- [x] 6. Assistant tools: import status, runs, run items, full enquiry, owner-gated import trigger
- [~] 7. Unit tests pass (1,991); live import tests pending publish + Make run

## Automatic Make imports and onboarding audit
- [x] Verify and enable Glocast's backend Make check every five minutes, without frontend work when no lead changes; scheduler fired run 9e1d4844-63c0-4fdf-9104-79c9dacd1c92 at 11:30:02 UTC.
- [~] Test the automatic path end to end and confirm owner alerts only for genuinely new leads: 34 lead/alert checks passed, but Make had not called back after nine minutes; live completion waits on the external scenario.
- [x] Document the implemented signup, website extraction, owner setup, ChatGPT connection, Cowork and automation journey, including remaining gaps.
- [~] Sent Glocast on-demand import f3519c10-5dac-4091-b447-69aa8a0b6db8 at 11:42:28 UTC: Make accepted the trigger and automatic checks stayed on, but no callback or processed leads after three minutes; completion remains blocked on the external Make scenario.
- [x] Compared both uploaded Make blueprints (byte-identical) with the live contract; identified polling trigger, invented run ID, empty-run stop and field-mapping mismatches, and supplied a corrective Make prompt.
- [x] Replaced Glocast’s saved Make trigger with the new Custom webhook and verified the exact match without starting an import; automatic checks are deliberately paused until the rebuilt scenario is reviewed and activated.
- [~] Sent one manual test to the rebuilt webhook as run 274fcfed-b3a8-4904-9f40-194ab31b9ffb at 12:15:33 UTC: Make returned HTTP success, but no authenticated callback, run items or processed leads had arrived by 12:18:20 UTC; inspect Make's execution state before retrying.
- [~] At the owner's request, superseded that unanswered run and sent one updated-blueprint test as run 5206355b-1706-433e-9b8c-a080c38d21e8 at 12:20:09 UTC; Make accepted the trigger and the owner will provide the running-scenario screenshot.

## Social sign-in (Google + Apple)
- [x] Enable Google and Apple providers and add both buttons to the sign-in screen with Google/Apple branding rules.
- [x] Verify both buttons start the provider flow (browser reached /~oauth/initiate for each), branding values, and the /oauth-return waiting and failure states; 6 return-store tests passed.
- [ ] Apple's official logo artwork (SVG from Apple Design Resources) still missing — the Apple button shows its title alone until the owner supplies it.
- [ ] Real Google/Apple account sign-in unverified in the sandbox.

## Password reset
- [x] "Forgot your password?" on the sign-in card sends a reset link; /reset-password accepts the link, saves the new password and lands the owner on their dashboard.
- [x] Verified in the preview: the panel opens, a link is sent, "Back to sign in" returns, and both an absent and an expired link show "That link has expired" with a way to ask for a new one; 4 link-reading tests passed.
- [ ] Opening a real reset email and setting a new password end to end is unverified (needs an inbox).
- [ ] No sending domain is configured, so reset emails arrive from Lovable's default sender rather than bookedsecure.com.
