# Bulk-edit personalised campaign drafts

## What will change

- Add checkboxes to every pending campaign draft, plus Select all / Clear selection controls.
- Add one bulk campaign-text editor that updates every selected draft at once.
- Keep each recipient's greeting, lead name, private booking link, tenant signature, and opt-out wording automatically generated and protected from bulk edits.
- Show a live example of the final personalised message before saving.
- Preserve individual editing, skipping, approval, consent, quiet-hour, credit, and sending safeguards.

## Technical details

- Add a tenant-scoped bulk-update server function accepting a campaign ID, selected draft IDs, and the editable middle copy.
- On the server, reload the campaign, business, and selected leads; regenerate each complete message with its own name and tokenised URL plus the tenant's stored signature.
- Apply existing campaign content guards and the 320-character SMS limit before updating draft rows.
- Update the campaign review screen with selection state, bulk editor, save feedback, and selected-only approval support.
- Add focused tests for protected personalization and tenant-safe selected updates, then verify desktop and mobile campaign review.
