# Fix booking times, live messaging figures, lead search and text settings

## 1. Booking time is saved in the wrong timezone (confirmed)

You set 9:00 am tomorrow for Iesha Yatim. The saved booking is `2026-09-18 09:00 UTC`, which is 7:00 pm Sydney — exactly what your calendar shows. The time you type is being stored as if it were UTC instead of your business time.

Fix:
- Interpret the date/time you type in the business timezone (Australia/Sydney for Glocast) before saving.
- Show the existing booking time back in the business timezone when the form loads, so it matches what you set.
- Repair Iesha's existing booking so it reads 9:00 am Friday 18 Sept, and check for any other bookings saved with the same offset before reporting back.
- Add tests covering entry, redisplay and daylight-saving dates so this can't drift again.

The lead correctly becomes Booked when you save the booking, and stays a returning customer once the job is completed — no status change needed there, as you confirmed.

## 2. "Texts going out / Credits left" should show the real provider state

Right now that panel reads our own records only. Our records say 5,000 credits; the messaging provider says 0 credits for Glocast's account, and the number `+61480023769` is live. So the panel is currently misleading.

Fix:
- Read the live provider state (number, status, credit balance) when the page loads, and show that.
- If the provider is slow or unreachable, fall back to our own figures and label them plainly as "last known".
- Show the number's real status from the provider rather than a generic "Ready".
- Keep the plan line accurate (Founder plan, $15/month) and make "Credits left" clearly the provider balance, with "Top up credits" beside it.
- Flag when our records and the provider disagree, so a mismatch is visible instead of silent.

## 3. Searching a lead by name returns nothing

Searching "Iesha" matches the row directly in the database, so the query itself works; the on-screen search returned nothing. Before changing anything, reproduce the search in the running app with the exact term to see what the page actually sends, then fix what that shows. Likely culprits are a capital-I / lowercase-l mix-up in the typed term or the term not reaching the query. In either case the search becomes more forgiving: match on any word of the name, ignore case and accents, and tolerate near-miss letters, plus a test for the exact term.

## 4. "How your texts look" settings

- Remove the "Quote subject options" box and its help text.
- Plainer labels and help text, tidier two-column layout.
- Small live preview of a sample text with the sign-off applied.
- Keep the "Send at any time (no quiet hours)" switch as is.

## Technical notes

- `src/lib/app.functions.ts` `scheduleJob` currently does `new Date(data.scheduled_at).toISOString()`, which reads a naive `datetime-local` value as UTC. It will parse against the tenant's `businesses.timezone`; the input prefill in `src/routes/leads.$leadId.tsx` will format from UTC into that zone instead of `slice(0, 16)`. One shared helper, used by both, plus the same treatment for the completed-job date.
- Data repair for existing wrongly-offset jobs runs as a one-off statement limited to jobs created through the manual form, reported before and after.
- Messaging panel: a new owner-authenticated server function reads `GET /account/{id}` and `GET /account/{id}/numbers` for the tenant's own sub-account, with a short timeout and cached fallback to `texto_accounts`; `MessagingOverviewCard` renders live-vs-stored state. No provider writes.
- Lead search: `applyPredicates` in `src/lib/lead-query.server.ts` gains normalised/tokenised matching; reproduction first via the signed-in app.
- Settings: `src/components/settings/sections.tsx` and `src/routes/settings.messaging.tsx`. The stored quote subject options field stays in the database (the quote flow still uses it); only this editor block is removed.
