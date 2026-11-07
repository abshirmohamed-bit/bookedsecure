# Roadmap: Facebook → Make lead import completion

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
