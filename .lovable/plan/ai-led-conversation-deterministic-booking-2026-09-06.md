# AI-led conversation, deterministic booking

Goal: the chat listens and answers like a person, while every business fact and every booking stays server-controlled. Rolled out per tenant, Glocast first.

## What changes for the customer

- A message can carry several details at once and all of them are kept, in any order, with typos.
- A question gets an answer, then the chat asks only for what is still missing.
- "I need something else", "not sure", "you tell me" bring up the service list instead of being filed as the service.
- Replies stay one or two sentences.

## What does not change

Approved services, service area, available times, prices, consent, booking creation, confirmation messages, owner alerts and tenant separation stay exactly as they are today. Nothing the model says can book, price, or promise a time.

## Phase 1 — Understanding contract (no visible change)

Widen the interpretation output from "fields only" to five signals:

- `fields` — values understood in the message
- `question` — the customer asked something, plus its topic
- `uncertainty` — they are stuck choosing
- `correction` — explicit change intent
- `unsupported` — outside what we handle

Dropped from the original spec: the 12-intent enum (collapsed to the five above), `acknowledgement`, `response_guidance`, `confidence`. Confirmation, consent and time selection stay fully deterministic and are never classified by the model.

Also: a single understood field now counts (today it is discarded unless two or more arrive), and routing is decided by message shape, not word count, so short-but-loaded messages like "auburn ta" or "i need something else" still get understood.

Nothing is rendered from this yet. Behind flag, off.

## Phase 2 — Deterministic answerer

A server-side answerer that replies only from facts already on file:

- which services are approved, and their descriptions if present
- whether a suburb is in the service area
- what is still needed, and what happens next
- how to pick a time, what consent means, what to confirm

No fact on file means a short honest deflection, never a guess. Symptom-to-service suggestions are allowed only when they resolve to exactly one approved service; otherwise the customer is asked to describe what needs attention.

## Phase 3 — Reply assembly

One reply per turn, composed by the server in a fixed order: brief acknowledgement of what landed, the answer if a question was asked, then the single next missing requirement. Passes through the existing guard that strips prices, dates and availability claims. Any model-drafted wording is treated as untrusted input to this step, never as the reply.

## Phase 4 — Failure behaviour

Malformed, empty, contradictory or slow interpretation: keep existing state, advance nothing, book nothing, send nothing, fall back to the current question, log internally.

## Phase 5 — Flag and canary

Per-tenant flag, default off. Enable for Glocast only, walk the eleven transcripts below on the live quote page, then decide on wider rollout.

## Verification

Transcripts demonstrated end to end: button-selected service, typed service, "I need something else", "not sure what I need", a question containing a suburb, a full multi-field message, an explicit correction, an ambiguous service, a typed time, consent, final confirmation.

Tests added for: uncertainty phrases never becoming a service, questions answered, fields preserved alongside questions, multi-detail extraction, corrections, a confirmed service never re-resolved, ambiguity staying unresolved, valid state never cleared by empty output, no repeated questions, exactly one interpretation call per eligible message, malformed/empty/timeout safety, typed times matching only live server slots, consent and confirmation never inferred, no booking/SMS/alert/lead side effects, tenant isolation and idempotency intact.

Then full suite, typecheck, production build.

## Expected outcome

Fewer abandoned conversations because the chat stops re-asking and starts answering. Same booking guarantees as today. If the interpretation layer fails or is flagged off, behaviour falls back to exactly the current step machine.
