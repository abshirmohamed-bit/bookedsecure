# Campaign editing fixes, compact draft review, service images from your website, and bookedsecure.com links

Four items, in the order they will be built.

## 1. "Edit on the campaign page" goes to the wrong page

The cowork's campaign card links to the Import contacts page. The campaign drafts actually live on the Leads inbox page (the "Win back dormant leads" panel). The link will point there instead and scroll straight to that panel so the owner lands on the drafts, not the top of the inbox.

## 2. Compact draft review (the selected container)

Today every draft renders as a full card with the whole message expanded, so ten drafts fill the screen on desktop and go on forever on mobile. New layout:

- The panel header stays as is (count, offer field, Draft/Redraft).
- Below it, a short summary line: offer text, "10 awaiting approval", and a "Review drafts" toggle. The list is collapsed by default after drafting and remembers the open state while on the page.
- The draft list becomes one compact row per lead: name and mobile, a one-line preview of the message (truncated), status chip, and an expand chevron. Expanding a row shows the full message, Edit, Skip and "Send this one" for that lead only.
- The list scrolls inside a fixed-height area (about 40 percent of the screen height on desktop, a little less on mobile) instead of growing the page.
- The permission checkbox and the "Approve and send all" / "Discard campaign" buttons sit in a sticky footer under the list so they are always reachable without scrolling to the bottom of ten cards.
- Copy, safety rules (permission checkbox, approve gate, guard rails) and all server behaviour stay unchanged.

## 3. Website reader: pull service images into the price cards (confirming your request)

Confirmed understanding: when a tenant's website shows a picture next to a service or price, the reader should capture that picture and the customer quote page should show it on that service's card, visible without pressing Details, and larger inside Details. Services with no picture keep the current card. Nothing here touches the business logo.

What changes:

- Each service (and each add-on) gets an optional image.
- The website reader asks for the image belonging to each service/price block and returns its address with the rest of the service details.
- The setup preview shows the found picture as a small thumbnail on each proposed service so the owner can see it before saving.
- On save, each picture is copied into the tenant's own file storage (the same way the logo is copied today) rather than linking to the tenant's site, so cards do not break if the tenant changes their website. Oversized or non-image files are skipped with a note.
- Quote page cards: a small image strip at the top of the card when an image exists; the Details sheet shows it larger. The compact three-column mobile grid is kept; cards with an image are slightly taller and rows still align.
- Settings services list: shows the current picture and lets the owner replace or remove it (upload from device), so tenants without a usable website can still add pictures.

## 4. Links move from bookedsecure.lovable.app to bookedsecure.com

- The platform's public address setting is currently `https://bookedsecure.lovable.app`. It will be changed to `https://bookedsecure.com`, and every fallback in code that still says lovable.app will be updated to bookedsecure.com.
- Every personal link is built at send time from that setting, so all new texts (campaign links like `/b/<token>`, quote-page links, booking confirmations, payment return pages, follow-up reminders) will use bookedsecure.com automatically for every tenant.
- Existing drafts that are still awaiting approval were rendered with the old address; they will be re-rendered once so their message text shows the bookedsecure.com link before anyone approves them.
- Old lovable.app links already sent to customers keep working (same app), so nothing breaks for texts already delivered.

## Technical details

- Item 1: `src/components/home/OwnerAssistant.tsx` campaign proposal link `to="/import"` becomes `to="/leads"` with `hash: "reactivation"`; `ReactivationPanel` section gets `id="reactivation"`.
- Item 2: `src/components/ReactivationPanel.tsx` only (presentation). Row component with local expanded state; list container `max-h-[40vh] overflow-y-auto`; sticky footer inside the panel. No changes to `reactivation.functions.ts` or server code.
- Item 3:
  - Migration: `services.image_url text null`, `services.image_storage_path text null`, same two columns on `service_addons`. No new tables, so no grant changes; existing RLS applies.
  - `src/lib/site-onboarding.server.ts`: extend `EXTRACTION_SCHEMA` / prompt with `imageUrl` per service and add-on; also request Firecrawl `links`/`images` where available to resolve relative addresses against the site URL. New `copyServiceImage` reusing the logo download and validation limits, writing to the existing tenant storage bucket under a per-service path, called per new service inside `applySiteOnboarding`.
  - `src/lib/site-onboarding.ts`: `ProposedService`/`ProposedAddon` gain `imageUrl`; proposal warnings note skipped images.
  - `src/components/settings/SiteOnboardingPanel.tsx`: thumbnail in the preview cards.
  - Quote reads that build service cards (`ServiceChooser` option/card mapping and its server source) pass `imageUrl` through; `src/components/quote/ServiceChooser.tsx` renders the strip and the Details image with lazy loading and alt text from the service name.
  - Settings services editor: upload/replace/remove image via a new owner-gated server function that reuses the logo upload validation; deletion removes the storage object.
  - Tests: extraction mapping with and without images, image copy skip cases, proposal snapshot.
- Item 4: update the `PUBLIC_APP_URL` secret to `https://bookedsecure.com`; replace the string fallback in `reactivation.server.ts`, `subscription.functions.ts`, `pilot-checkout.functions.ts`, `messaging-account.functions.ts`; update the matching test fixtures. One data update re-renders `reactivation_drafts` rows with `status = 'draft'` via the existing render path (not a raw text replace), keeping guard rails applied. Stripe return URLs and Texto webhook URLs are then confirmed to use the new domain.
