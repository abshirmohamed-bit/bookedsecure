# Mobile-first compact service grid

## What will change

- Replace the sideways service carousel with a vertically scrolling, three-column grid on mobile.
- Keep the tenant-defined service-group dropdown so customers only browse the relevant group.
- Size the grid viewport to show roughly 2.5–3 rows before scrolling, while keeping scrolling contained inside the service area.
- Shrink each card to roughly one-half to two-thirds of its current height by removing descriptions, group tags, large spacing, carousel arrows, swipe messaging, and progress controls from the card grid.
- Show only the service name, price, duration, selection state, and a compact Details control on each card.
- Keep full descriptions, inclusions, exclusions, notes, and extras in the existing detail view.
- Preserve multi-service and optional-extra selection. Selected services remain highlighted while the customer browses groups or opens details.
- Keep one clear Continue action that submits all chosen services and extras together as the customer's response to the AI.
- Keep selected-service chips and totals visible outside the scrolling grid so the customer can review or remove choices before continuing.
- Remove “Something else or not sure? Tell us what you need.” from this chooser and remove its unused callback path.
- Make the surrounding service panel fit its visible controls and grid rather than retaining carousel-era empty space.

## Responsive behaviour

- Mobile is authoritative: three equal columns, compact readable cards, 44px-or-larger interactive targets, no horizontal page movement, and only the grid scrolls vertically when needed.
- Wider screens retain the same vertical-grid interaction, with columns/cards allowed to widen without returning to a carousel.
- Long service names, prices, and durations will wrap or clamp safely without stretching neighbouring cards or causing overlap.

## Behaviour preserved

- All services, groups, prices, durations, details, and extras remain tenant-provided and data-driven.
- Multiple services and extras remain encoded and validated through the existing quote conversation flow.
- Booking, pricing validation, AI guardrails, and tenant isolation do not change.

## Verification

- Check the quote flow at narrow mobile, short mobile, and desktop sizes.
- Confirm three mobile columns, approximately 2.5–3 visible rows, contained vertical scrolling, no horizontal overflow, readable card content, persistent selections across groups/details, extras, and one combined Continue response.
- Run the relevant service-selection tests and verify the project compiles successfully.
