# Swipeable service cards on the quote page

Right now customers see services as collapsible headings with small stacked cards inside a boxed panel. This replaces that with the "Kinetic Glass Carousel" direction you picked: one row of cards you swipe sideways, one card at a time on a phone, two and a bit on a computer, with arrows and a slim progress bar.

## What the customer sees

- A quiet heading above the row showing the current group name (the business's own wording — Interior, Exterior, Packages, whatever their site says) with a count.
- If the business has more than one group, a single row of group chips above the cards; tapping a chip swaps which services are in the carousel.
- Each card: group tag, service name, one-line description, price and rough length side by side at the bottom, and one action button — "Select service".
- Tapping a card makes it the active one: it lifts, gets a highlighted border, and the button row splits into "Unselect" and "View details".
- "View details" opens the full detail inside the same panel: what's included, what's not, optional extras, price and length, then "Continue" and "Go back".
- "Something else or not sure" stays as a quiet option under the row, and typing a request still works.
- Arrows on the left/right appear on wider screens; on a phone you just swipe. The progress bar under the row shows where you are.

## Behaviour that does not change

- The panel stays clipped to its own height — only the card row moves sideways, the page itself never scrolls sideways and the Send button stays pinned.
- Choosing a service sends exactly the same value it sends today, so booking, pricing and the conversation logic are untouched.
- No prices, groups or wording invented anywhere; everything shown comes from the business's own saved services.
- Star ratings and location lines from the mockup are dropped — we don't hold that data per service.

## Technical notes

- Rewrite `src/components/quote/ServiceChooser.tsx`: replace the accordion with a `snap-x snap-mandatory` horizontal track (`overflow-x-auto`, hidden scrollbar, `overscroll-x-contain`), card widths `min-w-[85%]` on mobile and `md:min-w-[45%]`, active-card state held locally, arrow buttons using `scrollBy`, and an `onScroll`-driven progress bar. Detail view stays an in-place state as today, with Continue calling the existing `onChoose`.
- Keep group filtering via existing `groupItems` / `hasMeaningfulGroups` from `src/lib/service-groups.ts`; chips only render when more than one group exists. Drop the now-unused `Chip` duplication by using one chip component.
- Adjust the wrapper in `src/components/AiQuoteChat.tsx` (line ~304): drop `overflow-hidden` clipping that would cut the card row, widen to full transcript width, and remove the vertical max-height cap now that the row scrolls horizontally instead.
- Styling uses existing semantic tokens (`card`, `border`, `primary`, `muted-foreground`) rather than the mockup's literal zinc/blue hex values, so it stays on the BookedSecure dark theme.
- Add a hidden-scrollbar utility in `src/styles.css` via `@utility no-scrollbar` if one is not already present.
- Tests: extend the existing ServiceChooser tests — every service still renders across groups, selecting shows the split row, Continue submits the same option value, a service with no group falls under "Other".
