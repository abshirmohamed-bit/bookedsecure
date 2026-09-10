# Quote page funnel: three workstreams, in order

Three separate problems, fixed in the order that gives reliable evidence first.

## 1. Measurement first — know where every conversation stops

Nothing about the chat experience changes. We only start recording what already happens.

- Record when the quote page is opened, including where the visitor came from (ad campaign, source, referrer), so an ad click that bounces is distinguishable from a chat that stalls.
- Record the furthest stage each conversation reached (service, vehicle, suburb, name, mobile, review, consent, booking) and the time of the last activity.
- Mark a conversation as abandoned once it has been quiet past a set period, instead of leaving it "active" forever.
- Add a funnel view under Operational Details: opened, first reply sent, details started, mobile given, finished intake, booked — with abandoned counts and stage of drop-off.
- Correct the misleading count: finished intake and booked are reported separately, and bookings are counted from confirmed jobs, never from the conversation record.
- Flag obvious test conversations so they stop polluting the numbers.

## 2. Partial prospects — visible without being contacted

- New **Unfinished** list, separate from the leads inbox: anyone who gave a mobile number but did not finish.
- Each entry shows name (if given), mobile, suburb, services they were looking at, how far they got, and when they went quiet.
- View only — no texts, no automation, no campaigns can reach these entries. Calling them is a manual decision you make outside the app.
- If someone returns and finishes, their entry becomes a normal lead and leaves the Unfinished list automatically.
- If someone declines consent, they are excluded from the list entirely and their details are retained no longer than a set window.
- Tenant-isolated: each business sees only its own unfinished prospects, owner access only.

## 3. First screen — get more visitors to interact

Built only after the funnel numbers above are live, so the effect is measurable.

- Reduce the opening wall of text to one short question with an obvious next tap.
- Show services immediately as tappable cards instead of requiring a typed reply.
- Fix the mobile card problems found in the audit: cards stretched by long extras lists, hidden descriptions, tiny Details control, no swipe hint or arrows.
- Keep the pinned composer and single-scroll behaviour already in place.

## 4. Conversational logic — last

Only after the above, using the recorded stage data to see which questions actually lose people. No changes to pricing, availability, booking safety or AI guard rails.

## Technical notes

- New table for quote-page open/attribution events (`business_id` scoped, RLS, service-role writes from the public quote route).
- Add stage/last-activity/abandonment columns to `web_conversations`; a scheduled sweep marks stale rows abandoned.
- Unfinished list reads through an owner-gated server function; the messaging and automation paths explicitly exclude these records, covered by tests.
- Funnel metrics computed server-side from conversations + confirmed `booking_offers`/`jobs`, not from `collected.booking_confirmed`.
- No changes to `commit_web_chat_booking`, availability computation, provider config, or the AI reply guard.
