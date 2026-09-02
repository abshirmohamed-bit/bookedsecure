# Phase 4 canary: server-computed booking in the public AI chat

Adds a booking step at the end of the AI quote conversation for the Glocast + Full Detail pilot. Server generates slots from tenant availability, revalidates the customer's pick, and books atomically. No SMS on this path.

## Scope guard

Pilot eligibility (evaluated server-side; falsy → skip booking, complete as today):
- Tenant slug matches Glocast (`glocast-detailing`).
- Lead has an `approved_service_id` pointing to an active service whose name matches `Full Detail` (case-insensitive).
- Availability is active and at least one valid slot is returned.

## Flow

1. Existing chat runs unchanged through review → consent(granted) → lead created (`captureLead`, `channel: "web"`).
2. After lead creation, if pilot-eligible, call `generateBookingOffers` and set `collected.booking_offered = true`; persist `collected` and the offer id list snapshot on the web conversation row (in `collected.pilot_offers`). Conversation stays `active`, not `completed`.
3. Server returns a new `prompt` of kind `booking` with `options = [{value: offerId, label: slotLabel}]` plus a "None of these work" opt-out.
4. Client renders slot buttons; on click, sends `answer = offerId, expected_step = "booking"`.
5. Server handler for the booking step (`handleBookingSelection`):
   - Re-loads tenant, lead, offer; verifies tenant + lead + offer alignment.
   - Rejects if the answer isn't one of the currently offered offer ids.
   - Runs `isSlotStillAvailable` against fresh occupied set.
   - On conflict: regenerates offers, keeps customer bubble, returns fresh options and an explanatory assistant line, no restart.
   - On success: atomic-ish book — set offer `accepted` → withdraw peers → insert scheduled `jobs` row → update offer `confirmed` with job id → set lead `status = "scheduled"`, all guarded by conditional updates so a replay is a no-op. Idempotency key: `webchat_booking:{conversation_id}:{offer_id}`.
   - No `sendSms`, no `messages` row, no usage recorded.
   - Marks web conversation `completed`, `collected.booking_selected = offerId`, appends server-composed confirmation text (from `buildBookingConfirmationMessage`) to `web_conversation_messages`.
6. If customer picks "None of these work", record decline in `collected.booking_declined = true`, complete conversation with a normal handoff message.

## Files

- `src/lib/web-chat.ts`: add `booking` to `WEB_CHAT_STEPS`, add `pilot_offers`, `booking_offered`, `booking_selected`, `booking_declined` to `WebChatCollected`, extend `nextStep` to require booking when offered-and-unselected, add `promptFor("booking", …)` (kind `"choice"`), pure. `applyAnswer("booking", …)` validates offerId is in `pilot_offers` or `"__none__"`.
- `src/lib/web-chat.server.ts`:
  - After `captureLead`, call new helper `maybeOpenBookingStep(tenant, leadId, collected, conversationId)` (imported from `web-chat-booking.server.ts`) which returns either `{ offered: true, offers, prompt }` or `{ offered: false }`. If offered, persist `collected` with `pilot_offers` and return a state with the booking prompt instead of completing.
  - New branch that runs when `step === "booking"`: calls `handleBookingSelection` from `web-chat-booking.server.ts`; the reply loop uses its returned state.
- `src/lib/web-chat-booking.server.ts` (new): pilot detection, `openBookingStep` (calls `generateBookingOffers`), `handleBookingSelection` (revalidate + atomic book without SMS + conflict path).
- `src/components/AiQuoteChat.tsx`: render the booking prompt — assistant bubble with intro line "Pick a time that suits — I'll book you in on the spot." plus one accessible button per slot label and one "None of these work" button. On success completion, no extra UI change (existing completed handling covers it).
- Tests (`src/lib/web-chat-booking.test.ts`): timezone correctness (Sydney), lead-time exclusion, horizon exclusion, working-window boundaries, appointment duration fits inside window, existing-job exclusion, Full-Detail-only pilot scope (other services skip booking), expired slot rejected, already-booked slot rejected, cross-tenant rejection, replay idempotency, conflict returns fresh options, no SMS/usage side effects (spy on `sendSms` import), latest corrected values used.

## Safety verification (added to test file)

- Import `sendSms` from `lead-engine.server` and spy: assert zero calls across the booking path.
- Assert no row in `messages`, no `ai_usage_events`, no `automation_jobs` created by the booking selection call (test uses fake supabase counter).
- Assert only ONE `jobs` row for the lead after replaying the same offer id twice.
- Assert booking selection rejects an offer id from a different lead or tenant.

## Out of scope

Manual mode, SMS pipeline, follow-up automation, reminders, cancellation, rescheduling, non-Full-Detail services, non-Glocast tenants, dashboard changes.
