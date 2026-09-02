Phase 4 canary: server-computed booking in the public AI chat

Adds a booking step at the end of the AI quote conversation for the Glocast + Full Detail pilot. The server generates slots from tenant availability, revalidates the customer's selection, and commits the booking with transactional integrity. No SMS on this path.

Scope guard

Before implementation, inspect the actual tenant resolution behind `/quote/glocast` and identify the canonical Glocast tenant record. Do not assume that the public route slug is the database tenant slug. Pilot eligibility must use the verified tenant identity.

Pilot eligibility is evaluated server-side. If any condition is false, skip booking and complete the conversation exactly as it does today:

- The resolved tenant is the verified Glocast tenant. Confirm its canonical database identity rather than relying only on the public route slug.
- The lead has an `approved_service_id` pointing to an active service whose name matches `Full Detail`, case-insensitive.
- Availability is active and at least one valid slot is returned.

Flow

- Existing chat runs unchanged through review, consent granted, and lead creation with `captureLead`, using `channel: "web"`.
- After lead creation, if the pilot is eligible, call `generateBookingOffers`, set `collected.booking_offered = true`, and persist `collected` together with the server-generated offer ID snapshot on the web conversation row in `collected.pilot_offers`. The conversation stays active and is not completed.
- The server returns a new prompt of kind `booking` with `options = [{ value: offerId, label: slotLabel }]`, plus a `"None of these work"` opt-out.
- The client renders slot buttons. On click, it sends `answer = offerId` and `expected_step = "booking"`.

Server handler for the booking step: `handleBookingSelection`

- Reload the tenant, lead, offer, and conversation from the server.
- Verify tenant, lead, conversation, and offer alignment.
- Reject the answer if it is not one of the currently offered offer IDs stored in `pilot_offers`.
- Run `isSlotStillAvailable` against a fresh occupied set.
- On conflict, regenerate offers, preserve the customer's selection bubble, return fresh options with an explanatory assistant line, and continue without restarting the conversation.
- On success, commit the booking with real transactional integrity. Do not implement this as “atomic-ish.”
- Use a real database transaction or a server-side database function for the complete booking commit. The commit must safely perform the following sequence:
  - Validate the winning offer and current availability.
  - Create the scheduled `jobs` row.
  - Confirm the winning offer with the job ID.
  - Withdraw peer offers only after the winning booking can commit.
  - Set the lead status to `"scheduled"`.
  - Complete the web conversation only after the booking commit succeeds.
- The system must never leave:
  - An accepted offer without a corresponding scheduled job.
  - A confirmed offer without its job ID.
  - A scheduled lead without a confirmed booking and scheduled job.
  - Withdrawn peer offers when the winning booking failed.
- If the current Supabase architecture cannot perform the full sequence transactionally, implement an explicit, idempotent compensation and recovery path. A failed booking must remain safely retryable without requiring the customer to restart.
- Use the idempotency key:
  `webchat_booking:{conversation_id}:{offer_id}`
- Replaying the same request must return the existing result and create no additional lead, job, offer, SMS, usage event, or automation job.
- No `sendSms`, no SMS `messages` row, no `ai_usage_events`, no `automation_jobs`, and no provider call. The booking confirmation may be appended only to `web_conversation_messages` as part of the web transcript.
- On successful booking, mark the web conversation as completed, set `collected.booking_selected = offerId`, and append server-composed confirmation text from `buildBookingConfirmationMessage` to `web_conversation_messages`.
- If the customer picks `"None of these work"`, set `collected.booking_declined = true`, preserve the selection in the web transcript, complete the conversation with a normal handoff message, keep the lead captured, create no job, and send no SMS.

Files

`src/lib/web-chat.ts`:

- Add `booking` to `WEB_CHAT_STEPS`.
- Add `pilot_offers`, `booking_offered`, `booking_selected`, and `booking_declined` to `WebChatCollected`.
- Extend `nextStep` to require booking when booking has been offered but no selection or decline has been recorded.
- Add pure `promptFor("booking", ...)` with kind `"choice"`.
- Make `applyAnswer("booking", ...)` validate that the offer ID exists in `pilot_offers` or equals `"__none__"`.

`src/lib/web-chat.server.ts`:

- After `captureLead`, call the new helper `maybeOpenBookingStep(tenant, leadId, collected, conversationId)` imported from `web-chat-booking.server.ts`.
- The helper returns either `{ offered: true, offers, prompt }` or `{ offered: false }`.
- If offered, persist `collected` with `pilot_offers` and return a state with the booking prompt instead of completing the conversation.
- Add a new branch that runs when `step === "booking"` and calls `handleBookingSelection` from `web-chat-booking.server.ts`.
- Ensure the reply loop uses the returned booking state.

`src/lib/web-chat-booking.server.ts`:

- Add pilot detection.
- Add `openBookingStep`, which calls `generateBookingOffers`.
- Add `handleBookingSelection`, which reloads and validates all records, revalidates availability, commits the booking transactionally or through an explicit recovery path, handles conflicts, and sends no SMS.

`src/components/AiQuoteChat.tsx`:

- Render the booking prompt with the assistant intro line: `"Pick a time that suits. I'll book you in on the spot."`
- Render one accessible button per slot label.
- Render one `"None of these work"` button.
- On successful completion, make no extra UI changes. Existing completed handling should continue to apply.

Tests

Add `src/lib/web-chat-booking.test.ts` covering:

- Canonical tenant resolution behind `/quote/glocast`.
- Pilot eligibility for the verified Glocast tenant.
- Sydney timezone correctness.
- Lead-time exclusion.
- Booking horizon exclusion.
- Working-window boundaries.
- Appointment duration fitting inside a working window.
- Existing-job exclusion.
- Full-Detail-only pilot scope.
- Other services skipping booking.
- Expired offer rejection.
- Already-booked offer rejection.
- Cross-tenant rejection.
- Cross-lead rejection.
- Offer ID substitution rejection.
- Replay idempotency.
- Conflict returning fresh offers.
- Latest corrected lead values being used.
- No SMS or usage side effects.

Safety verification

- Import `sendSms` from `lead-engine.server` and spy on it. Assert zero calls across the booking path.
- Assert that the booking selection creates no SMS `messages` row, no `ai_usage_events` row, no `automation_jobs` row, and no provider call.
- Assert that the booking confirmation is written only to `web_conversation_messages`.
- Assert only one `jobs` row exists for the lead after replaying the same offer ID twice.
- Assert booking selection rejects an offer ID belonging to a different lead or tenant.

Transactional failure-injection tests

Inject failures at each booking commit stage:

- Before the transaction begins.
- After winning-slot validation.
- After job creation.
- After offer confirmation.
- After lead status update.
- Before web conversation completion.

For every injected failure, verify that the system either rolls back completely or enters a safe, explicitly recoverable state.

Verify all of the following:

- No accepted offer exists without a corresponding scheduled job.
- No confirmed offer exists without its job ID.
- No scheduled lead exists without a confirmed booking and scheduled job.
- Peer offers are not withdrawn when the winning booking fails.
- A retry uses the existing lead and conversation.
- A retry creates no duplicate lead, job, booking, offer, SMS, usage event, or automation job.
- The customer does not need to restart the quote conversation.

Out of scope

Manual mode, SMS pipeline, follow-up automation, reminders, cancellation, rescheduling, non-Full-Detail services, non-Glocast tenants, and dashboard changes.