# BookedSecure — flow map

Three flows, each covered by its own test suite. All are tenant-neutral: no
business id, business name, price or offer appears in code.

| Flow | Suite | Tests |
| --- | --- | --- |
| Tenant | `src/lib/flow-tenant.test.ts` | 12 |
| System | `src/lib/flow-system.test.ts` | 32 |
| User | `src/lib/flow-user.test.ts` | 12 |

## 1. Tenant flow

What a business configures, and what the platform derives from it.

```text
business record (name, slug, quote mode, numbers, timezone)
  └─ approved services (name, price guidance, campaign eligible, duration)
       └─ public quote page   /quote/<slug>
            ├─ welcome copy        ← business name
            ├─ service list        ← approved services + price guidance
            ├─ campaign highlight  ← approved offer %, eligible services only
            ├─ customer callback   ← owner mobile, else business line
            ├─ owner alert         ← owner notification mobile (AU mobile only)
            └─ win-back link       ← tenant page + contact's private token
```

Guarantees asserted: an unknown slug or mode never resolves to another tenant's
experience; booking-only mode is the default for every tenant with no
configuration; a service with no price shows no price; a service marked
ineligible never shows a discount; owner alerts and confirmation send keys are
scoped per tenant and per booking, so two tenants can never collide.

## 2. System flow

The deterministic control layer. The conversation may propose; only this layer
commits or sends.

```text
customer confirms an offered slot
  └─ commit_web_chat_booking      (single idempotent transaction)
       ├─ booking offer → confirmed, job created, lead projection updated
       ├─ confirmation eligibility  (booking, replay, opt-out, suppression,
       │                             valid number, consent, callback number)
       ├─ send path                 new_lead_response | sequence_follow_up
       │     └─ quiet hours: follow-ups deferred to the tenant-local boundary
       ├─ owner alert               (committed booking + valid owner mobile)
       └─ follow-up planning        none in booking-only mode
```

Win-back for dormant contacts runs beside it: classify → AI-drafted offer →
owner approval → one message → one reminder after three days → stop.

```text
imported contact with no SMS, no chat, no booking, no enquiry details
  └─ eligible → draft (owner edits, owner approves)
       └─ send once  → 3 days → single reminder
            └─ any reply, chat, booking, STOP or suppression cancels it
```

Guarantees asserted: no message can leave without a committed booking or an
owner-approved campaign; every replay is suppressed by idempotency key; opt-out
and suppression win over everything; quiet hours are evaluated in the tenant's
timezone, never server UTC; win-back wording is stripped of any timing, booking,
money or guarantee promise; autonomous agent execution is off platform-wide
(`LIVE_EXECUTION_ENABLED === false`) and refuses to dispatch even with an
authorised plan.

## 3. User flow

```text
A. New visitor
   quote page → service (price shown) → vehicle → suburb → address →
   condition → name → mobile → email → review → consent →
   server-offered slots → explicit confirmation → booked
   • an unlisted request is recorded verbatim and routed to the owner
   • declining consent ends the conversation cleanly
   • no booking exists before the customer confirms a slot the server generated

B. Returning contact (win-back link)
   recognised by their private token → greeted by name → known details
   prefilled and never re-asked → new enquiry lands on their OWN record
   • placeholder names ("web visitor") are not prefilled
   • existing values are never overwritten; empty ones are filled

C. Unsure customer or a question
   "not sure" / "something else" / "how much is …?" is never stored as the
   service; the question is answered from tenant facts only, and any reply
   containing timing, price or guarantee promises is stripped
```

## Running the flows

```bash
bunx vitest run src/lib/flow-tenant.test.ts src/lib/flow-system.test.ts src/lib/flow-user.test.ts
bunx vitest run   # whole suite
```

Deeper end-to-end scenarios with recorded side effects live in
`src/lib/sandbox/` (tenant-scoped sandbox mode, zero provider calls).
