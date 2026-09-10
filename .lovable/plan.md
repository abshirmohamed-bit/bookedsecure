# Assistant-centred Home with persistent conversations

## Goal
Replace the separate Assistant and Performance tabs with the selected **Floating Status Island** workspace: conversation history on the left, the Assistant as the dominant centre experience, and only a few useful performance signals floating above it.

## Experience
- Open Home directly into the tenant’s default ongoing conversation.
- Keep a compact conversation rail for the ongoing chat and any separately created conversations.
- Let owners create, reopen, and delete conversations; deletion requires confirmation.
- Give every conversation its own stable page address so refresh and direct links restore the correct history.
- On smaller screens, move conversation history and operational detail into dismissible drawers while keeping the transcript and composer fully visible.
- Keep “Set up from my website again” available as a secondary owner action without interrupting normal Home use.

## Minimal performance summary
- Show only three tenant-driven signals in the floating island:
  - enquiries moving through the funnel;
  - completed-job revenue;
  - SMS delivery health/failures.
- Retain the reporting-period control and truthful existing calculations.
- Keep provider acceptance separate from carrier delivery, source channels separate, pending receipts visible, and revenue limited to explicitly completed jobs.
- Move the full funnel, source breakdown, SMS trigger detail, re-check action, and explanatory note into one collapsed **Operational details** panel.
- Remove the standalone Performance tab and keep the old analytics address redirecting to Home.

## Persistent account history
- Add dedicated tenant-scoped Assistant conversation and message records rather than reusing customer SMS conversation tables.
- Every record includes `business_id`; access is restricted to the signed-in tenant with database rules and explicit authenticated/service grants.
- Store valid AI message structures and proposal/result state so confirmation cards survive refreshes.
- Save the user turn immediately and save the completed assistant turn only after completion; surface save failures rather than silently losing history.
- Preserve the existing approval requirement for lead updates, campaigns, status changes, and add-on changes.
- Use the active page conversation ID for loading, sending, saving, switching, and deleting so messages cannot bleed between conversations.

## Chat composition
- Rebuild the transcript and composer with the project’s installed AI Elements primitives.
- Render messages from their parts, keep assistant replies unboxed, retain a high-contrast user bubble, and show a clear working state before the reply arrives.
- Keep the composer focused initially, after sending, after completion, and after changing conversations.
- Keep upload and natural-language owner actions working.
- Preserve the existing BookedSecure typography and semantic colour system; use turquoise, blue, and coral only as small status accents.

## Technical details
- Add authenticated server functions for conversation list/create/read/delete and tenant-safe message persistence.
- Add the dedicated Assistant conversation route and make `/dashboard` resolve the tenant’s default conversation before navigation.
- Adapt the current owner request endpoint to accept the active conversation, return its completed message, and persist it without weakening action confirmation.
- Add migration coverage for tables, indexes, grants, row-level policies, update timestamps, and default-conversation uniqueness.
- Update navigation so Home remains active on conversation URLs.

## Verification
- Create two conversations, send a message in each, reload both URLs, and confirm each restores only its own messages.
- Confirm the default ongoing conversation persists, a separate conversation can be created, and deletion removes only the chosen conversation.
- Confirm one conversation cannot access another tenant’s records.
- Confirm Assistant actions still require approval and their proposal state survives refresh.
- Verify the selected composition on desktop and mobile, including pinned composer, drawers, no sideways page scrolling, and accessible controls.
- Run focused persistence/action tests, the full test suite, typecheck, build checks, and authenticated browser verification.
