# Compact, expandable setup journey

## Goal
Turn the large setup grid into a small **Get set up!** control that opens a clear vertical checklist, while ensuring every step takes the owner to the correct place.

## Verified today
- All six links resolve without browser or console errors.
- **Business details** opens Messaging, where the required identity form is shown.
- **Start your subscription** opens Plan & billing.
- **Add your old customers** opens the contact-import screen.
- **Run your first campaign** returns to Home, where Cowork can create it.
- Both **Tell us your trade** and **Add your website** point to Setup. For an already-configured tenant, Setup immediately redirects back to Home, so completed setup links cannot be revisited there.

## Changes
1. Replace the always-visible grid with one compact **Get set up!** button showing a checklist icon, progress, and expand/collapse indicator.
2. Keep the list collapsed initially. Pressing the button reveals all six steps as one vertical list; pressing it again closes the list.
3. Preserve real saved progress, current-step emphasis, completed ticks, subscription locks, and owner/staff visibility rules.
4. Make every row comfortably tappable on mobile and keep labels/details wrapping cleanly without widening the Home screen.
5. Correct the setup destinations so trade and website actions remain reachable instead of bouncing configured owners back to Home. Keep the remaining four destinations connected to their verified screens.
6. Add accessible expanded/collapsed state and keyboard operation to the trigger.

## Validation
- Test all six rows in a signed-in browser and confirm the expected destination and usable completion control.
- Test collapsed, expanded, completed, current, and subscription-locked states.
- Check desktop and iPhone-sized layouts for clipping, overlap, and scrolling.
- Run the onboarding tests and the project’s automated checks, then confirm the preview has no errors.
