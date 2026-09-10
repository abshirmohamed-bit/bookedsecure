# Cleaner quote cards and a shorter, more human conversation

## 1. Service cards: content must fit

- Give each card a fixed internal layout: name block (up to 3 lines), price, duration, then the Details control, with the card height set so all four always fit at mobile and desktop sizes.
- Keep the tick indicator out of the text flow, and let the name shrink one step when it needs the third line so nothing is cut off and Details is never pushed out of view.
- Details stays a full-width tappable control at the bottom of every card, at least the recommended touch height.
- Keep three columns on mobile, roughly 2.5 to 3 rows visible, contained vertical scrolling, no sideways movement.

## 2. Selected cards stay visible as the answer

- When the customer presses Continue, their reply in the conversation shows the chosen services as compact cards (name, price, extras), not a plain text line.
- The chosen selection stays rendered in the conversation history for the rest of the chat, so the customer can always see what they picked.

## 3. Mobile keyboard no longer distorts the page

- The chat frame will follow the visible screen area when the on-screen keyboard opens, instead of assuming the full device height.
- Result: the message box and Send stay just above the keyboard, the header stays put, and the page never shifts sideways or leaves a large empty gap.

## 4. One message per turn, plain punctuation

- Every turn becomes a single message: short acknowledgement plus the next question together, for example "Awesome, got the Toyota Camry. What's the address we should come to?"
- No long dashes anywhere in customer-facing text. The service echo becomes "BIKE DETAIL, $129.99." style wording.
- Warmer, simpler phrasing throughout, still only using the tenant's own service names, prices and wording.

## 5. Fewer steps to a booking

- Combine the pairs that belong together into one question each: name and mobile asked together; email folded into that same turn as optional.
- Address is asked in the same turn that acknowledges the suburb.
- Anything the customer already told us in their own words is never asked again.

## 6. Add-ons offered at the right moment, only when they exist

- The condition/concerns question also invites extras: "Anything we should focus on, and would you like any add-ons?"
- Add-on cards appear at that point only when the tenant actually has active add-ons attached to the chosen service. Tenants without add-ons never see the offer or the step.
- Extras remain optional and are validated server-side against that tenant's own catalogue.

## 7. Final check shown once

- Remove the duplicated plain-text summary. Only the editable summary card remains, with per-field Change and one confirm action.

## Technical notes

- `src/components/quote/ServiceChooser.tsx`: fixed card grid rows, name clamp with adaptive size, pinned Details control.
- `src/components/AiQuoteChat.tsx`: selection rendered as a card bubble; suppress the review text turn; keyboard-aware shell using the visual viewport height.
- `src/lib/web-chat.ts` and `src/lib/web-chat.server.ts`: single joined reply per turn, combined name/mobile/email and suburb/address prompts, add-on offer moved to the concerns turn and gated on active tenant add-ons, all customer text passed through the existing punctuation sanitiser.
- No changes to booking safety, pricing truth, tenant isolation, consent gating or lead-creation timing. Prices and availability stay server-computed.

## Verification

- Mobile 390 wide and short-screen: card content complete, Details visible, no sideways scroll, keyboard open with composer reachable.
- Full run of the quote flow: selection card persists, one message per reply, no long dashes, add-ons offered only for a tenant that has them, single final summary, booking confirmed correctly.
- Existing quote and booking test suites plus typecheck and build.
