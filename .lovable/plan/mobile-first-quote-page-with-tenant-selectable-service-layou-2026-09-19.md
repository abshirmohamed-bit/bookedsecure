# Mobile-first Quote Page with tenant-selectable service layouts

## What will change

- Rebuild the public AI Quote Page around the existing BookedSecure colour palette and current Outfit/Figtree typography.
- Keep the business identity and conversation header compact, make the transcript the only scrolling area, and keep the answer box reliably attached to the bottom of the visible mobile screen.
- Preserve the current quote flow, service prices, add-ons, quantities, review, consent, booking checks, conversation history, and tenant isolation.

## Three service layouts

Add an owner-controlled **Service display** setting with these choices:

1. **Focused list** — one full-width service per row with readable name, price, duration, selection state, and Details.
2. **Compact grid** — two cards per row on phones, with content safely contained and full details available separately.
3. **Guided conversation** — one prominent service at a time with previous/next controls, progress, Details, and selection without changing the underlying chat.

The saved choice applies only to that tenant’s public Quote Page. Existing and future tenants default to **Focused list**, so no business is hardcoded.

## Business Settings

- Extend the existing Quote Page settings card with visual radio choices for the three service displays.
- Save the owner’s choice through the existing authenticated, owner-only settings path.
- Show clear saved/loading feedback and keep staff access read-only.

## Data and safety

- Add a constrained tenant setting for `focused_list`, `compact_grid`, or `guided_conversation`.
- Return that setting through the public tenant resolver and Quote Page loader only; no private business data is exposed.
- Keep server-side service and add-on validation unchanged.

## Verification

- Test all three layouts with Glocast’s long service names and prices at phone and desktop sizes.
- Check selection, multiple services, quantities, add-ons, Details, Continue, typed answers, review, and keyboard-open behavior.
- Confirm one tenant’s setting cannot alter another tenant’s page.
- Run the relevant automated tests and confirm the current preview build is clean.
