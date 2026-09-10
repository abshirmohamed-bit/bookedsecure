# Final Forensic Audit Prompt — BookedSecure Quote Page

**Paste this entire prompt into Lovable Plan Mode.**

---

## Role and operating mode

You are performing a **read-only forensic audit** of the BookedSecure quote-page and conversation funnel for an **Australia-only mobile detailing business**, within the **Glocast tenant-scoped architecture**.

This prompt **replaces the old audit report**. Do not implement, refactor, “fix,” clean up, migrate, backfill, or modify anything.

Your task is to determine exactly what happened to all **250 conversations**, why only **23 are currently reported as finished or booked**, and whether that figure represents one population or two different populations.

### Absolute prohibitions

Do **not**:

- Modify UI, styling, responsive behavior, or components.

- Modify analytics, tracking, event collection, or reporting logic.

- Modify lead capture, consent, opt-out, follow-up, or abandonment logic.

- Modify database schemas, migrations, indexes, triggers, RLS, functions, or policies.

- Modify AI prompts, AI guards, model behavior, routing, or fallback behavior.

- Modify booking, availability, provider, calendar, or confirmation logic.

- Send SMS, alerts, emails, notifications, or follow-ups.

- Make live AI calls.

- Make provider or calendar calls.

- Create, cancel, alter, or claim any booking.

- Insert, update, delete, soft-delete, merge, deduplicate, or backfill records.

- Change tenant data or cross-tenant visibility.

- Run destructive or write-capable SQL.

- Create temporary tables, persistent views, materialized views, files, exports, or migrations unless the platform guarantees that the action is strictly non-persistent and read-only.

- Treat an inferred event as a persisted event.

- Treat an absent record as proof that the event did not happen.

Use only **read-only inspection and read-only queries**. If a query might write, lock, trigger, call an external service, or mutate state, do not run it.

---

## Audit objective

Produce a defensible, evidence-based explanation of the complete funnel:

> Ad click or quote-page open → service selection → customer details → mobile capture → consent → AI/intake conversation → time selection → confirmation → booking attempt → booking result → lead and attribution records → abandonment or recovery

The audit must reconcile:

- **250 total conversations**

- **23 reported as finished or booked**

- **54 records with a mobile captured but no lead**

- Approximately **130 apparent drop-offs**

- All associated **conversations, leads, bookings, messages, events, attribution records, UTM values, and activity/state records**

Do not merely repeat existing aggregate funnel numbers. The central deliverable must explain **every conversation row by row**.

---

## First: establish the actual technical surface

Before making conclusions, inspect the actual repository, database definitions, server functions, client components, route handlers, queries, policies, and configuration used by the BookedSecure quote page and Glocast tenant architecture.

Identify the exact relevant:

- Files

- Components

- Hooks

- Server actions

- API routes

- Edge/server functions

- Database tables

- Views

- SQL functions

- Triggers

- RLS policies

- Queries

- Type definitions

- AI prompt and guard code

- Booking/provider integrations

- Analytics/event code

- Attribution and UTM handling

- Consent and opt-out handling

- Lead creation and promotion logic

- Responsive service-card code

- Conversation state-machine code

For every conclusion, cite the **exact file path, function/component name, table/view name, query, policy, or relevant line range** where possible.

If a named file or table does not exist, explicitly say so. Do not infer its existence from expected architecture.

---

# Required final report

The final audit report must contain these sections in this order:

## 1. Executive answer

Answer clearly and directly:

- What happened to all 250 conversations?

- Why are only 23 reported as finished or booked?

- Does “23 finished/booked” mean:

  - one combined population,

  - two separate populations,

  - overlapping populations,

  - or an ambiguous/incorrect metric?

- How many conversations are:

  - booked,

  - completed without booking,

  - confirmation reached but booking failed,

  - time offered but not selected,

  - consent declined,

  - consent not reached,

  - mobile captured but no lead,

  - incomplete intake,

  - customer-abandoned,

  - technically failed,

  - duplicate/test,

  - unknown or unreconciled?

- How many records remain unexplained after reconciliation?

- What is the strongest evidence for each conclusion?

- Which conclusions are certain, probable, inferred, or unresolved?

Do not use vague explanations such as “users probably dropped off.” Distinguish actual persisted evidence from assumptions.

---

## 2. Scope, definitions, and population reconciliation

Define precisely:

- What counts as one conversation?

- What is the canonical conversation identifier?

- Are anonymous sessions, browser sessions, quote attempts, chat threads, leads, or booking intents being counted?

- Can one customer create multiple conversations?

- Can one conversation produce multiple leads or booking attempts?

- Are test, preview, internal, duplicate, deleted, soft-deleted, or cross-tenant records included?

- What time zone is used?

- What date range is being audited?

- Is the count of 250 based on conversation rows, UI analytics, event rows, or another query?

- Is the 23 count based on a status field, lead count, booking count, dashboard metric, or an inferred funnel stage?

- Are all metrics tenant-scoped to the correct Glocast tenant?

- Are any records excluded by RLS, UI filters, date filters, status filters, or joins?

Create a reconciliation table showing at minimum:

| Population | Count | Definition | Source query/table | Overlap with other populations | Evidence quality |

|---|---:|---|---|---|---|

Mathematically reconcile:

- Total conversations

- Unique conversation IDs

- Unique customer/mobile identifiers, where legally and technically appropriate

- Leads

- Bookings

- Booking attempts

- Messages

- Persisted events

- Inferred transitions

- Duplicates/tests

- Unreconciled records

Show the arithmetic explicitly. Every row must either belong to a defined outcome category or be listed as unresolved with a reason.

---

## 3. Row-level outcome ledger for all 250 conversations

Create a row-level audit ledger covering **every conversation**, not a sample only.

Use a safe, redacted export where permitted. Do not expose unnecessary personal information. Prefer stable redacted identifiers, hashes, or last-four/partial values where appropriate.

Each conversation row must include:

| Field | Required content |

|---|---|

| Conversation ID | Canonical ID and any aliases |

| Tenant ID | Redacted if necessary, but prove tenant scope |

| Created timestamp | Source and time zone |

| Updated timestamp | Source and time zone |

| Last activity timestamp | Source and calculation |

| Last persisted state | Exact stored value and source |

| Last customer-visible state | What the customer could see, based on rendered/UI logic or persisted state |

| Current step | Exact step/status, not a paraphrase |

| Final outcome category | One primary category |

| Secondary flags | Booking attempt, consent, lead, duplicate, technical issue, etc. |

| Customer-visible last action | Last known customer action |

| Last customer message | Redacted text or safe classification |

| Last assistant/system message | Safe classification or redacted text |

| Message count | Customer, assistant, system, and total |

| Transcript availability | Complete, partial, absent, or contradictory |

| Canonical collected fields | Service, vehicle, location/postcode, mobile, name, email, date/time, notes, etc. |

| Field timestamps | When each field was first and last persisted |

| Consent status | Accepted, declined, not reached, unknown, contradictory |

| Consent timestamp/evidence | Exact source |

| Opt-out status | Status and evidence |

| Lead status | No lead, partial lead, completed lead, promoted lead, duplicate, unknown |

| Lead ID(s) | Related identifiers |

| Booking status | None, attempted, held, confirmed, failed, cancelled, unknown |

| Booking ID(s) | Related identifiers |

| Availability evidence | Offered, selected, rechecked, unavailable, unknown |

| Attribution source | Exact persisted value or absent |

| UTM values | Source, medium, campaign, term, content |

| Ad/click/session evidence | Persisted, inferred, or absent |

| Activity status | Active, stale, abandoned, completed, unknown |

| Duplicate/test flag | Reason and evidence |

| Technical failure flag | Error, timeout, exception, failed request, or absent evidence |

| Final classification confidence | Certain, probable, inferred, unresolved |

| Evidence references | Files, tables, queries, event IDs, timestamps |

### Required primary outcome categories

Assign every conversation to one primary outcome:

1. **Booked**

2. **Completed without booking**

3. **Confirmation reached but booking failed**

4. **Time offered but not selected**

5. **Consent declined**

6. **Consent not reached**

7. **Mobile captured but no lead**

8. **Incomplete intake**

9. **Customer abandonment**

10. **Technical failure**

11. **Duplicate/test**

12. **Unknown/unreconciled**

If a conversation qualifies for multiple categories, document:

- The primary classification rule.

- Secondary flags.

- Why the categories overlap.

- Whether the aggregate totals use mutually exclusive categories.

Do not classify a record as “customer abandonment” merely because there is no later activity. Confirm whether abandonment is actually defined and persisted.

---

## 4. Reconcile the 23 “finished/booked” records

Audit the exact source of the 23 figure.

Determine:

- Which query or code produces 23.

- Whether it counts conversations, leads, completed leads, booking attempts, bookings, or a join.

- Whether it uses `COUNT(*)`, `COUNT(DISTINCT ...)`, status filters, or inner joins.

- Whether a join silently excludes records.

- Whether one conversation can be counted more than once.

- Whether a lead can exist without a conversation.

- Whether a booking can exist without a lead.

- Whether completed conversations without bookings are included.

- Whether bookings include failed, cancelled, held, test, or stale records.

- Whether “finished” and “booked” are separate populations.

- Whether the populations overlap.

- Whether the dashboard label is misleading.

Provide the exact query or code path and a corrected interpretation without changing the code.

---

## 5. Investigate the 54 mobile-captured/no-lead records

For all 54 records, determine:

- When the mobile number was first captured.

- Whether it was captured before or after consent.

- Whether the number was normalized and validated.

- Whether the number was persisted to the conversation, a partial lead, a completed lead, or only client memory.

- Why no lead exists.

- Whether lead creation was blocked by consent, missing fields, validation, duplicate handling, tenant scope, a failed request, an exception, or a state-machine branch.

- Whether a lead existed and was later deleted, merged, soft-deleted, or filtered out.

- Whether a customer could have reasonably understood that the mobile had been retained.

- Whether the record should be considered a partial lead under the proposed lifecycle.

- Whether any follow-up would be legally and operationally permitted in Australia.

- Whether the mobile belongs to a duplicate/test record.

- Whether the mobile was captured in a multi-field message or correction.

- Whether the UI displayed a successful save despite persistence failure.

Create a subtable for all 54 records with the exact reason for no lead, or mark the reason unresolved.

---

## 6. Investigate the approximately 130 apparent drop-offs

Do not assume these are real drop-offs.

For each apparent drop-off, determine whether it is:

- A genuine customer abandonment.

- A conversation that is still technically active forever.

- A conversation whose state was not surfaced in reporting.

- A conversation with a persisted state but missing event.

- A duplicate or test record.

- A technical failure.

- A consent decline or consent-not-reached case.

- A mobile-captured partial lead.

- An incomplete intake that was never defined as abandoned.

- A browser refresh, back-navigation, or leave/return case.

- A transcript or event persistence failure.

- A record excluded by a query, tenant filter, join, or date boundary.

- An unreconciled record.

For each category, provide counts and evidence. Explain the exact abandonment definition currently implemented, if any, including:

- Timeout duration.

- Last-activity calculation.

- Whether customer and system activity are distinguished.

- Whether “active” records remain active indefinitely.

- Whether refresh or return behavior changes timestamps.

- Whether failed requests update activity.

- Whether abandoned records are persisted or inferred only in analytics.

---

## 7. Conversation, lead, booking, message, and event reconciliation

Compare all relevant data sources:

- Conversations

- Conversation states

- Leads and partial leads

- Bookings and booking attempts

- Messages/transcripts

- Event tables

- Error logs

- Attribution/session records

- UTM records

- Activity records

- Consent records

- Provider responses

- Availability snapshots or offers

- Audit logs, if any

For each source, document:

- Primary key.

- Foreign keys and relationship direction.

- Tenant-scoping columns.

- Created/updated timestamps.

- Soft-deletion behavior.

- Status fields and allowed values.

- Whether records are append-only or mutable.

- Whether records can be missing.

- Whether records are generated client-side or server-side.

- Whether the source is authoritative or derivative.

Identify contradictions such as:

- Booking exists but conversation says no booking.

- Lead exists but conversation has no mobile.

- Consent exists in the transcript but not in a consent table.

- “Completed” status exists with no completed intake fields.

- Time was shown but no availability event exists.

- Booking failure is visible to the customer but not persisted.

- A conversation is active after a confirmed booking.

- A conversation has multiple tenants.

- UTM values differ between session, conversation, and lead.

- Message count differs across UI, database, and event records.

Provide a contradiction table with:

| Record | Contradiction | Sources | Likely cause | Confidence | Read-only evidence |

|---|---|---|---|---|---|

---

## 8. Event and state-transition audit

Audit the complete transition path:

1. Ad click or quote-page open

2. Session creation

3. Quote-page load

4. Service selection

5. Vehicle/location/intake fields

6. Conversation creation

7. First customer message

8. Mobile capture

9. Consent presentation

10. Consent accepted or declined

11. Lead creation or partial-lead creation

12. Service/time availability request

13. Time offer displayed

14. Time selected

15. Availability recheck

16. Confirmation request

17. Booking attempt

18. Booking success or failure

19. Confirmation displayed

20. Follow-up or abandonment state

21. Recovery or return visit

For every transition, state whether it is:

- **Actually persisted**

- **Only inferred from another record**

- **Client-only**

- **Logged only in an error/console channel**

- **Absent**

- **Contradictory**

Create a transition observability matrix:

| Transition | Persisted event/table | Inferred source | Client-only evidence | Absent? | Tenant-scoped? | Reliable? |

|---|---|---|---|---|---|---|

Audit whether events are:

- Idempotent.

- Ordered.

- Timestamped consistently.

- Associated with the canonical conversation ID.

- Associated with the tenant ID.

- Safe from duplicate emission.

- Lost on refresh, navigation, timeout, or failed requests.

- Written before or after the corresponding user-visible action.

State clearly which missing events prevent definitive classification.

---

## 9. Proposed partial-lead lifecycle audit — do not implement

Audit the proposed partial-lead lifecycle without changing it.

Assess:

### Mobile capture timing

- When should a mobile become a partial lead?

- Is capture before consent permitted?

- Is consent required before storing or using the mobile?

- Is the mobile stored in the conversation, a lead record, or both?

- Is the customer told what is being retained?

### Consent and opt-out

- What consent is required for quote processing?

- What consent is required for SMS, calls, or marketing follow-up?

- How are declined consent and no-response distinguished?

- How is opt-out recorded?

- Can an opt-out be overridden?

- Are follow-ups legally and operationally blocked where required?

- Is consent immutable, versioned, timestamped, and tenant-scoped?

### Promotion to completed lead

- What fields are required?

- What event promotes a partial lead to a completed lead?

- Is promotion idempotent?

- Can a partial lead be promoted after a booking failure?

- Can a completed lead exist without a booking?

- Can a lead be created without a conversation?

### Duplicate handling

- What constitutes a duplicate?

- Is matching based on normalized mobile, email, conversation ID, tenant, time window, or another key?

- Could two real customers be incorrectly merged?

- Could one customer create multiple partial leads?

- Are test/preview records isolated?

### Abandonment and recovery

- How is abandonment defined?

- When can a partial lead be recovered?

- What evidence is required before sending a recovery message?

- How are consent and opt-out rechecked?

- How are stale, soft-deleted, or suppressed records handled?

### Tenant isolation

- Confirm that partial leads cannot cross Glocast tenants.

- Confirm all reads, writes, deduplication, recovery, and promotion paths are tenant-scoped.

- Identify any query or function that lacks tenant enforcement.

Provide risks and recommended design decisions only. Do not implement them.

---

## 10. AI reply guard audit

Audit the existing AI reply guard without modifying it or making live AI calls.

Determine:

- Where the guard is implemented.

- Whether it uses exact matching, normalized matching, token matching, substring matching, regex, embeddings, or model judgment.

- Whether matching is case-sensitive.

- How whitespace, punctuation, apostrophes, Unicode, accents, emojis, repeated text, and spelling variations are handled.

- Whether it distinguishes customer text from assistant text.

- Whether it can produce false positives for ordinary customer language.

- Whether it can miss exact-risk phrases due to normalization differences.

- Whether it runs before or after AI generation.

- Whether a blocked response is persisted.

- Whether the customer sees a fallback response.

- Whether guard decisions are logged.

- Whether the guard can accidentally interpret a customer’s quote, correction, or multi-field message as a prohibited instruction.

- Whether the guard can be bypassed through message structure.

- Whether the guard can incorrectly trigger on booking, availability, consent, SMS, or alert language.

Use static code inspection and existing persisted data only. Clearly separate:

- Exact behavior verified from code.

- Behavior inferred from outputs.

- Behavior that cannot be tested safely without changing or calling the system.

---

## 11. Responsive service-card audit

Audit the actual service-card implementation and report, without changing it.

Use actual measurements and screenshots or equivalent rendered evidence for:

- Small mobile

- Standard mobile

- Large mobile

- Tablet

- Desktop

Record:

- Viewport dimensions.

- Card dimensions.

- Text wrapping.

- Price and duration layout.

- Button dimensions and tap targets.

- Multi-select behavior.

- Selected/unselected/disabled states.

- Overflow, clipping, and scrolling.

- Keyboard and screen-reader concerns where observable.

- Whether all services are visible and selectable.

- Whether service order is stable.

- Whether services come from a database, configuration, provider, tenant settings, or hardcoded list.

- Whether service IDs are stable and tenant-scoped.

- Whether groups and add-ons are represented correctly.

- Whether duration and price are authoritative or display-only.

- Whether availability calculations use the selected service IDs, group IDs, add-ons, duration, and price.

- Whether displayed services can differ from services sent to booking or availability.

- Whether inactive, unavailable, or deleted services remain selectable.

- Whether multi-select intent survives refresh, back navigation, or repeated Continue.

- Whether the UI shows a service that the booking provider cannot fulfil.

Include screenshots or measurement evidence where available. If browser rendering cannot be performed without changing the application or making external calls, state that limitation precisely and provide the static code evidence instead.

---

## 12. Full state-machine audit

Map the actual state machine and its priority order.

Show every state, transition, guard, side effect, persistence point, and customer-visible result.

Explicitly audit behavior for:

- Button clicks.

- Typed input.

- Questions.

- “Something else.”

- Uncertainty.

- Multi-field messages.

- Corrections.

- Empty messages.

- Repeated messages.

- Refresh.

- Double-click or double Continue.

- Browser back.

- Leaving and returning.

- Service selection.

- Time offers.

- Time selection.

- Consent.

- Consent decline.

- Opt-out.

- Confirmation.

- Booking failure.

- Provider timeout.

- AI failure.

- Network failure.

- Partial persistence failure.

- Invalid or conflicting fields.

Determine the priority order when multiple interpretations are possible. For example:

1. Explicit button action

2. Structured selection

3. Exact known answer

4. Multi-field extraction

5. Correction

6. Question

7. “Something else”

8. Uncertainty

9. Fallback

Do not assume this order is correct; report the actual order found in code.

For each state and transition, identify:

- Trigger.

- Guard.

- State update.

- Database write, if any.

- Event write, if any.

- External call, if any.

- AI call, if any.

- Customer-visible output.

- Failure behavior.

- Idempotency behavior.

- Tenant-scope enforcement.

- Evidence of actual execution.

---

## 13. Booking safety audit

Confirm, using exact code and query evidence, whether:

- Availability is generated server-side.

- Availability is authoritative and tenant-scoped.

- The customer-facing time offer is tied to a specific service, duration, location, and tenant.

- Availability is rechecked immediately before booking.

- Booking uses a server-generated or server-validated slot identifier.

- Booking is idempotent.

- Double Continue cannot create duplicate bookings.

- Browser retries cannot create duplicate bookings.

- A stale time cannot be booked.

- A failed booking cannot be reported as confirmed.

- A held slot cannot be treated as a confirmed booking.

- Provider failures are persisted distinctly from customer abandonment.

- Booking confirmation is based on authoritative provider response.

- AI cannot create bookings.

- AI cannot claim that a booking exists.

- AI cannot create or claim availability.

- AI cannot create or claim consent.

- AI cannot send SMS or alerts.

- AI cannot invoke provider actions indirectly through uncontrolled tool access.

- Tenant isolation exists in every availability, booking, confirmation, and recovery path.

- Provider credentials and identifiers cannot cross tenants.

List any safety gap as **verified**, **not verified**, or **contradicted by evidence**. Do not fix the gap.

---

## 14. Missing observability and data lifecycle

Identify what cannot currently be known because the system does not persist enough evidence.

For every missing signal, state:

- What happened that cannot be distinguished.

- Which records or events would be needed.

- Whether the absence is historical and unrecoverable.

- Whether the outcome can only be inferred.

- What future lifecycle decision is required.

- Whether the issue affects reporting, customer follow-up, consent, booking safety, or tenant isolation.

Audit the lifecycle of:

- Conversations

- Messages

- Partial leads

- Completed leads

- Bookings

- Booking attempts

- Events

- Consent records

- Attribution records

- UTM values

- Errors

- Soft-deleted records

- Duplicate/test records

- Abandoned records

Document:

- Creation.

- Updates.

- Promotion.

- Deduplication.

- Soft deletion.

- Retention.

- Recovery.

- Cross-table references.

- Orphan records.

- Records that can remain active forever.

- Records that disappear from reporting without being deleted.

---

## 15. Implementation priorities — recommendations only

This section must contain recommendations, but **no implementation**.

Prioritize findings by:

1. Booking safety and incorrect confirmations.

2. Tenant isolation and data exposure.

3. Consent, opt-out, and follow-up legality.

4. Incorrect lead or booking reporting.

5. Loss of row-level observability.

6. Partial-lead lifecycle ambiguity.

7. AI safety and false-positive/false-negative risks.

8. State-machine inconsistencies.

9. Responsive service-card and service-data issues.

10. Attribution and UTM gaps.

For each recommendation, include:

- Problem.

- Evidence.

- User/customer impact.

- Data/reporting impact.

- Risk level.

- Proposed owner area.

- Dependency.

- What must be decided before implementation.

- How success would be verified later.

Do not write code or propose a patch in this section.

---

## 16. Unresolved questions and stop conditions

List all unresolved questions explicitly.

For each unresolved item, include:

- Why it cannot be answered from current read-only evidence.

- Which file, table, query, log, or historical snapshot is missing.

- Whether it affects the 250/23 reconciliation.

- Whether it affects booking safety, consent, tenant isolation, or legal follow-up.

- The minimum evidence required to resolve it.

Stop and report rather than guessing if:

- The 250 records cannot be tenant-scoped confidently.

- The canonical conversation identifier is ambiguous.

- A query would require a write or external call.

- A provider call is needed to verify historical availability.

- A live AI call is needed to reproduce behavior.

- Historical data is unavailable.

- A source table has contradictory or incomplete timestamps.

- The 23 figure cannot be reproduced.

- Row-level export would expose unnecessary personal information.

- The result depends on unavailable logs or deleted records.

---

## 17. Evidence appendix

Include:

### A. Exact read-only queries

Provide every query used, with:

- Query purpose.

- Tables/views referenced.

- Tenant filter.

- Date/time-zone assumptions.

- Redaction logic.

- Whether the query is guaranteed read-only.

- Expected row count or result shape.

Do not include write statements, migrations, temporary mutations, or provider calls.

### B. File and function index

List:

- File path.

- Function/component/query name.

- What it proves.

- Relevant line range.

- Whether the evidence is authoritative or inferential.

### C. Aggregate reconciliation tables

Include all supporting aggregate tables and arithmetic.

### D. Row-level redacted export or safe sample

Provide the complete 250-row redacted ledger if permitted. If a complete export is not safe or technically possible, provide:

- The exact query that would produce it.

- A safe redacted sample.

- Counts by every classification.

- A list of unresolved record identifiers in redacted form.

- The reason the complete export cannot be included.

### E. Contradictions

Include every material contradiction between tables, UI, state, messages, events, leads, bookings, and provider records.

### F. Screenshots and measurements

Include responsive service-card evidence for all requested viewport classes, or explain why rendering evidence could not be collected safely.

### G. Confidence rules

Define how you distinguish:

- Verified.

- Strongly supported.

- Inferred.

- Contradicted.

- Unknown/unreconciled.

---

## Required conclusion format

End the report with this exact summary structure:

### Final reconciliation

- Total conversations:

- Booked:

- Completed without booking:

- Confirmation reached but booking failed:

- Time offered but not selected:

- Consent declined:

- Consent not reached:

- Mobile captured but no lead:

- Incomplete intake:

- Customer abandonment:

- Technical failure:

- Duplicate/test:

- Unknown/unreconciled:

- Sum of mutually exclusive categories:

- Does the sum equal 250?:

- Explanation of any difference:

### Meaning of “23 finished/booked”

- Exact source:

- Exact population:

- Finished count:

- Booked count:

- Overlap:

- Why the existing label is accurate or misleading:

### Most important finding

State the single most important verified finding.

### Most dangerous unresolved risk

State the most dangerous unresolved risk involving booking, consent, tenant isolation, reporting, or customer communication.

### Immediate decision required

State the one decision that must be made before any implementation begins.

Remember: this is an **audit only**. Do not alter BookedSecure, Glocast, the quote page, tenant data, analytics, leads, AI, booking, providers, SMS, alerts, or messaging.