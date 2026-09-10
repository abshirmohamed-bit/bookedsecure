# Audit: the AI-led quote page

This is an audit only — no changes yet. It covers what happens today, in what order, what the customer sees on each device, and what you are (and are not) told when someone from your Facebook ad clicks the link.

## 1. What actually happens when someone clicks your ad link

The link opens a full-screen chat for that one business. Everything is decided on your server, from your saved data. The conversation walks a fixed list of steps, in this order:

service → optional extras → vehicle → suburb → address → concerns → name → mobile → email → quick check → consent → pick a time → confirm

Steps are skipped when they don't apply: extras only appear if the chosen service has any, and the time-picking steps only appear if you have availability switched on.

## 2. Where the services and times come from

- Services and extras are read live from your saved list, alphabetically, and only ones marked active are shown. There is no separate "approved" tick — active is the gate. Your own group headings are used as-is for the card labels.
- Extras only show if they are still linked to an active service.
- Times come from your availability settings (working windows, lead time, how far ahead, how long an offer stays valid) plus the length saved on the chosen service. Already-booked jobs and held offers are excluded.
- If you have not switched availability on, no times are offered at all — that is the current default for a new business.
- A time is re-checked against live availability at the moment of booking, and each booking is keyed so a double-tap can't create two jobs.
- The AI never invents a price, a date, a time or a booking. It only reads the customer's message and suggests wording; a filter then strips any sentence containing a dollar amount, day, time, "available", "booked" or "guarantee" before the customer sees it.

## 3. The honest problem: you are blind until the very end

A customer record is only created at the consent step, right at the end. Everything before that — service picked, suburb, name, even their mobile number — is stored on the conversation only and is not shown anywhere in your account. No notification, nothing in the leads inbox.

Your live numbers today (250 conversations since 2 Sep):

```text
conversations started            250
got as far as picking a service  117
gave a suburb                     85
gave a mobile number              77
reached consent                   42
were offered times                28
finished / booked                 23
```

So around 130 people opened the chat and vanished, and 54 people handed over a mobile number without ever appearing in your inbox. There is also no record of a click that never becomes a conversation, and a half-finished chat just sits marked "active" forever with nothing flagging it.

## 4. The cards, and how they behave

- Services appear as a sideways-swiping row of cards inside the first chat bubble, with your group name and a count above, a dropdown to switch group when you have more than one, and a thin progress bar underneath.
- Cards are about 132px wide on a phone and 240px on a computer. Arrows to move the row exist only on desktop — on a phone there is nothing telling the customer the row can be swiped.
- On a phone the service description is hidden entirely, so the only way to compare two services is to open each one's details.
- Tapping a card selects it (multiple can be selected) and reveals that service's extras inside that card. Because the card is narrow and probably scrolls out of view, comparing extras across two chosen services means swiping back and forth.
- "Details" replaces the whole card row with a full panel — what's included, what's not, extras, price, length — with "Go back" and "Keep this service".
- "Your selection" and the Continue button sit below the whole row, so after tapping a card at the far right nothing moves to show that it registered beyond a small tick.
- All cards in the row stretch to the height of the tallest one, so one service with many extras makes every card unnecessarily tall.
- "Details" and the extra toggles are ~10px text with a single line of padding — smaller than a comfortable thumb target.

## 5. Scrolling: is the page pinned?

Yes. The chat is locked to the height of the screen, the header and the message box never move, and only the conversation area scrolls. Sideways page movement is blocked in three places, and form text is forced to 16px so tapping the message box can't zoom the screen and push Send out of view. Bottom notch/home-bar spacing is respected.

The one weak point is that the sideways card row is a scrolling area inside a scrolling area, with no gesture-axis locking — a slightly diagonal swipe near the cards can be grabbed by the wrong direction.

## 6. What I'd fix next, in priority order

1. Capture the person the moment they give a mobile number, not at consent, and surface unfinished conversations somewhere you can see them. This is the money leak, not a design issue.
2. Record that a conversation started, so ad spend can be judged against opens, not just bookings.
3. Rework the cards for phones: wider cards showing the description, a visible hint that the row swipes, bigger tap targets, equal card heights, and extras shown in a place that doesn't scroll away.
4. Keep the selection summary and Continue in view while choosing.
5. Lock the swipe axis on the card row.

## Technical notes

- Front end: `src/components/AiQuoteChat.tsx` (fixed `100dvh` shell, `use-stick-to-bottom` transcript, pinned composer), `src/components/quote/ServiceChooser.tsx` (snap carousel, multi-select, extras, detail panel), `src/lib/service-groups.ts`, `src/styles.css` overflow/zoom guards.
- Step machine: `src/lib/web-chat.ts` (`nextStep`, `sel:<serviceIds>|<addonIds>` encoding, review copy), `src/lib/web-chat.server.ts` (turn persistence, `expectedStep` replay guard), state in `web_conversations.collected`, transcript in `web_conversation_messages`.
- Tenant data: `src/lib/quote-form.server.ts` (`resolvePublicTenant`, `active=true` filters, add-on link filtering).
- Availability/booking: `src/lib/availability.server.ts`, `src/lib/web-chat-booking.server.ts`, `commit_web_chat_booking` RPC with a deterministic conversation+offer idempotency key.
- AI: `src/lib/web-chat-ai-extraction.server.ts` via Lovable AI Gateway, output constrained by `WebChatAiExtractionSchema`, wording filtered by `guardConversationalReply` in `src/lib/web-chat-conversation.ts`.
- Lead creation: `captureLead` in `src/lib/lead-engine.server.ts`, called from the consent step only. `web_conversations` is surfaced in the UI solely on the lead detail page, joined by `lead_id`.
