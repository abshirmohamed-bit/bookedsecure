# Fix the mobile chat keyboard layout

## Changes
- Make the signed-in Assistant workspace and public quote chat use a true `100dvh` flex-column height chain, with `min-h-0` at every nested level.
- Remove the JavaScript pixel-height overrides that compete with the browser’s dynamic viewport sizing and cause the blank area.
- Keep headers and composers fixed-size with `shrink-0`; keep only the conversation transcript as `flex-1 min-h-0 overflow-y-auto`.
- Set both chat textareas to at least 16px (`text-base`) to prevent mobile browser auto-zoom.

## Verification
- Check the customer quote chat and signed-in Assistant at mobile width.
- Focus the composer and confirm the input remains immediately above the keyboard-sized viewport without horizontal overflow or blank space.
- Confirm the current build and focused checks remain clean.
