# Assistant that actually does the work

## What went wrong

Your assistant is not one system — it is a keyword matcher in front of a read-only answering model.

Every request first passes through hand-written phrase patterns. If a pattern matches, you get a Confirm card. If nothing matches, the request falls through to a model that has been explicitly told "you are read-only, you cannot book jobs, never claim you will" — so it politely refuses instead of saying "I didn't understand that".

Your Samantha message fell through for two small reasons:
- The customer name is only recognised with a straight apostrophe (`Samantha's`). Phone keyboards insert a curly one, so nothing matched.
- When the name appears only in possessive form and the sentence says "book **her** in", no other pattern catches it.

That is why the same instruction worked when phrased "the detail for Samantha" and failed when phrased "Samantha's detail".

## What we build instead

Replace the keyword matcher with a real tool-using assistant. The model no longer guesses phrasing — it reads the request, picks the right operation, fills in the details, and runs it. Per your decision, it acts straight away and reports what it did, rather than showing a Confirm card.

Capabilities (all of them, as you asked):

- **Bookings and jobs** — create, move, cancel a booking; mark a job completed; record what was paid.
- **Customer records** — find, summarise, create and update a customer's name, mobile, email, suburb, address, vehicle, service, notes and status.
- **Services and extras** — add, rename, reprice, regroup services and add-ons; link or unlink extras.
- **Messages and campaigns** — send a text to one customer and approve a win-back campaign.

Safety kept where it protects you, not where it slows you down:

- Everything is locked to your own business. The assistant cannot see or touch another tenant's records — enforced server-side, never from the request.
- Before acting, it must look the customer up. Nothing is created against a name it cannot find; two possible matches means it asks which one.
- Texts still respect consent, opt-outs, quiet hours, your credit balance and daily caps. If a message is blocked, it says so rather than pretending it sent.
- Deleting a customer stays a request, not an instant action, so records cannot be destroyed by a misread sentence.
- Every action is written to your audit log with what changed and who asked for it.
- The assistant reports exactly what it did, and the Bookings page, leads inbox and performance figures refresh straight after.

Conversation history stays as it is today: saved to your account, per conversation.

## Technical detail

- New `src/lib/assistant-tools.server.ts`: AI SDK `tool()` definitions with Zod inputs, each one a thin wrapper over existing server logic (`bookings.server.ts`, `owner-lead-actions.server.ts`, `catalog-actions.server.ts`, `reactivation.server.ts`, `agent-executor.server.ts` for sends). `businessId`/`userId` are closed over from the authenticated middleware context and are never tool inputs.
- New booking write helpers in `bookings.server.ts`: `createBooking`, `rescheduleBooking`, `cancelBooking`, `completeJob` (writing `jobs.scheduled_at`, `completion_status`, `completed_at`, `completed_value`) plus lead-status sync mirroring `commit_web_chat_booking`.
- Rewrite `handleOwnerRequest` (`owner-actions.server.ts`) as a `streamText` agent loop over the Lovable gateway (`google/gemini-3.8-flash`), `stopWhen: stepCountIs(50)`, consuming server-side and returning final text plus a structured list of executed actions. Keep the existing snapshot as system context so read questions stay factual.
- Replace the read-only system prompt in `owner-assistant.ts`: state the real capabilities, ban invented names/prices/dates, require a lookup before a write, require a plain-English report of what was done. Rework `BANNED_ANSWER_PATTERNS` so "I booked…" is allowed only when a booking tool actually ran, and refusal phrasing is no longer produced.
- Retire the regex intent parsers as the primary path (`owner-lead-actions.ts`, `parseOwnerRequest`, `parseCatalogRequest`); keep them as a deterministic fallback used only when the gateway is unavailable, so the assistant degrades to today's Confirm-card behaviour instead of failing.
- Persist executed actions alongside each assistant turn in `assistant_messages` (reuse the existing `proposals` column shape, tagged as executed) so history shows what happened.
- `OwnerAssistant.tsx`: render executed-action summaries as completed items rather than Confirm buttons; keep Confirm rendering for the fallback path; invalidate bookings/leads/snapshot queries after any action.
- Tests: tool-input validation, tenant scoping, ambiguous-name handling, booking create/move/complete/payment, consent- and cap-blocked sends, fallback path. Then a live end-to-end run of the exact Samantha instruction plus several paraphrases, verified against the database and the Bookings page.

No schema change is required for bookings, jobs, leads or services. If persisting executed actions needs a column, that migration will be raised separately for your approval.
