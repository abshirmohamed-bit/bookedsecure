# Cleaner setup, clearer prices, simpler imports, and an assistant that can update jobs

## 1. Stop sending set-up tenants back to the website step

- After sign-in, owners go straight to their Home; the website step only opens when the business has no services yet.
- The "Your website" panel disappears from Home once services are saved, with a small "Set up from my website again" link kept for owners who want to re-read their site.
- Staff never see the website step at all.

## 2. Fix prices like "$119.99$189.99SAVE 37%"

The website reader is pasting the sale price, the old price and the discount badge together as one blob. Fix at the reading step so every place (setup preview, cards, quick check, texts) shows one clean price:

- Split a run-on price blob into amounts, drop "SAVE x%" wording, and keep the amount the customer actually pays (the sale price).
- Keep ranges ("$250 to $320") and "from $250" exactly as the tenant wrote them.
- Where a price can't be read as an amount it stays as the tenant's own words — nothing invented.
- Existing saved services with a run-on price get tidied the same way when the owner next reads their site.

## 3. Add-ons and totals in the selection

- Picking a service keeps its card visibly selected and adds it to "Your selection"; the selection block stays on screen while browsing other groups (nothing disappears).
- Underneath the selection, the extras available for the chosen services are listed with their prices, each one tick-on/tick-off.
- The selection block shows a running list of prices per service and extra plus a combined total, using the same rule already used in the quick check: a total appears only when every chosen item has a single plain amount; otherwise those items read "price on enquiry" and no total is faked.
- The Continue button reflects services + extras chosen.

## 4. Nothing hidden on the quote page

- The chosen services, extras, totals and Continue button remain reachable without side-scrolling or zooming on mobile.
- Cards size to their content so nothing is stretched or clipped; long names wrap.
- Only the card row scrolls sideways and only the conversation scrolls down; the message box and Send button stay pinned.
- Verified on a small phone width and desktop with screenshots.

## 5. Import page becomes "upload your old customers"

Remove the advanced import experience entirely. What remains:

- One page: choose a CSV, see what was read, save the contacts into the lead inbox, and a link to the inbox.
- A short plain-language note if some rows can't be saved (missing name, unusable phone), with the option to save the rest.
- No rollout modes, canary/idempotency panels, dry-run, commit simulation, staged-row editors, phone-repair tools, activity feeds or jump links.
- Uploading still never sends messages.

## 6. What a CSV brings in

Kept: name, mobile, email, source, created date. Added: street address, suburb, and previous/last service requested (plus notes), so an imported customer arrives with the details a detailer actually needs. Extra columns are still stored quietly against the lead rather than being lost.

## 7. Assistant can complete jobs and re-book — with your confirmation

You'll be able to type or dictate to your assistant in plain words, e.g. "Andrew's detail is done today, he paid $340, book him in again Tuesday 21st at 2pm".

- The assistant finds the matching customer in your leads, works out the amount paid, marks the job completed, and works out the next date/time from natural wording ("tomorrow 6pm", "two weeks from now", "Dec 22 2pm").
- It then shows one confirmation card: which customer, amount, completed, and the new booking date/time. Nothing is saved until you tap Confirm.
- If more than one customer matches, or the date/amount is unclear, it asks you to pick or clarify instead of guessing.
- Confirming updates that customer's record and adds the booking to your calendar; the change is logged. No text is sent to the customer by this action.

## Technical notes

- Setup gating: `getSetupState.needsSetup` decides redirects; `/setup` redirects owners with services to `/dashboard`, `auth.tsx` routes to `/dashboard` and lets `/setup` self-gate; `SiteOnboardingPanel` in `dashboard.tsx` renders behind the same flag.
- Prices: new pure helper in `src/lib/site-onboarding.ts` (unit-tested) normalising scraped price text; applied in `proposeServices`/`proposeAddons`. No schema change.
- Selection UI: `src/components/quote/ServiceChooser.tsx` — persistent selection panel, per-service extras list, price lines reusing the existing `chosenPricing` rule from `src/lib/web-chat.ts` (exported for client reuse). Encoding `sel:<services>|<addons>` and the server state machine stay unchanged.
- Layout: `AiQuoteChat.tsx` + `src/styles.css` — `100dvh` shell, `overflow-hidden`, contained horizontal track, `min-w-0`, safe-area padding.
- Import: replace `src/routes/import.tsx` with the lite flow only; delete `ImportSectionNav.tsx`, `CanaryResultCard.tsx`, `ImportActivityPanel.tsx`, `ImportSummarySection.tsx`, `StagedRowEditor.tsx` and the advanced-only branches; keep server-side `csv-import.server.ts` commit path plus its safety gates. Remove now-dead advanced-only server fns and their tests.
- CSV: extend `FIELD_ALIASES`/normalised payload in `src/lib/csv-import.ts` with `address`, `suburb`, `last_service`/`notes`, mapped onto existing lead columns; tests for aliases and mapping.
- Assistant actions: `src/lib/owner-assistant.ts` gains a pure intent parser (customer match, amount, completion, next booking date/time in the tenant timezone) returning a proposed-change object; new confirm-only server fn applies it via existing job/lead update paths with tenant `business_id` scoping and an `audit_events` row. `OwnerAssistant.tsx` renders the proposal card with Confirm/Cancel. Reads stay tenant-scoped; no message sending.
- Verification: `bunx tsgo`, full Vitest suite, build check, and Playwright passes on the quote page (mobile + desktop) and the import page.
