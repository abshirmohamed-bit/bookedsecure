# Grouped service cards — for owners and for customers

Right now services are one flat alphabetical list, both in the owner's settings and in the customer chat. Sites like the one in your screenshots group services (Interior, Exterior, Interior + Exterior, Paint, Premium, Maintenance) and sell add-on extras on top. That grouping is currently thrown away when we read a website.

Two things get built.

## 1. Owner side — a visual catalogue

After the website read (and any time from settings), owners see their services as cards, grouped:

- Filter chips across the top: All, then one chip per group found on their site, with a count.
- Each card: group tag, service name, price, duration if known, short description, and the extras that apply to it.
- An "Extras" section under the services showing each add-on, its price, extra time, and which services it attaches to.
- Cards stay editable exactly as today (edit/remove), nothing about approval or AI limits changes.

Groups come from the website when we read it. Owners can change a service's group or type a new one; a service with no group falls under "Other".

## 2. Customer side — pick a service without a wall of text

The quote page opening step changes from 14 stacked buttons to:

- One line of intro, then group chips (All / Interior / Exterior / …) that filter the cards.
- A compact card per service: name, price from, rough time.
- Tapping a card opens its detail in place: what the service includes, what it doesn't, how long it takes, price, and any extras that can be added.
- On that detail card, two buttons: **Continue** (locks that service in and the conversation moves on to vehicle details) and **Go back** (returns to the cards).
- "Something else or not sure" stays as the last option, and typing a free-text request still works.

Nothing about the booking logic changes: prices shown are the owner's own listed prices, times are still live, and the assistant still cannot invent a price or a service.

## Visual direction

Cards follow the existing dark BookedSecure look — same panel surface, border and radius as the current chat bubbles, with the group tag in the muted accent, price in the primary accent, and one primary button (Continue) plus one quiet button (Go back). Two columns on desktop, one on mobile. I can render two or three design options for the card and detail view before building if you'd like — say the word and I'll show them.

## Technical notes

- Migration: add nullable `category` to `services` and `service_addons` (text), no default, no backfill beyond what the scraper writes. Existing rows read as "Other".
- `src/lib/site-onboarding.server.ts`: extend the extraction schema/prompt to capture the group label per service and per add-on, and persist it on insert. Existing services are still never overwritten.
- Owner UI: new grouped card view in `src/components/settings/sections.tsx` (ServicesEditor + AddonsEditor) plus the confirmation card in `SiteOnboardingPanel.tsx` showing group counts.
- Customer UI: the `service` step in `src/lib/web-chat.ts` gains `category`, `price`, `duration_minutes`, `included_items`, `excluded_items` and linked add-on names per option; `src/components/AiQuoteChat.tsx` renders chips + cards + an in-place detail panel with Continue / Go back. Continue submits the same option value the current buttons submit, so the server state machine is untouched.
- Tests: extraction keeps group labels; option payload carries group and detail; selecting via Continue produces the same collected service as today; a service with no group renders under Other.
