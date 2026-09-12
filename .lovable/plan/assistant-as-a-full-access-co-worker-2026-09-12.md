# Assistant as a full-access co-worker

## Where things stand

The assistant already runs real tools, but only 15 of them: find customers, list upcoming bookings, a numbers snapshot, list services, create/update customer, book/move/cancel/complete a job, add/edit a service, toggle add-ons, send one text, draft and approve a win-back campaign.

That is why your recent conversation went badly:
- Campaigns can only target dormant past customers, so "text 9 uncontacted leads" drafted zero every time and the assistant could only repeat the rule.
- It has no way to read your quote-page funnel, lead inbox breakdowns, message history, unfinished prospects, business settings, messaging account, automation or team — so it cannot answer or change any of that.
- It cannot take a file.

## What we build

One assistant that can read and change every area of your workspace, always locked to your own business. It acts immediately and tells you what changed; the only thing that waits for your OK is anything that sends a text.

### Ask anything (read)
- Bookings: upcoming, past, by customer, by day/week.
- Lead inbox: counts and lists by status (new, contacted, replied, quote ready, quote sent, booked, completed, lost, opted out, invalid), by source (Meta, website, import, SMS...), by delivery state (delivered, pending, failed, undelivered, suppressed, no reply after delivery).
- A customer in full: details, every text sent and received, jobs done, campaigns and follow-up sequences they were in, replies, current state.
- Operational details: the quote-page funnel for any window (opens, where people stopped, opens by source, SMS delivery, lead and messaging performance).
- Unfinished prospects: how far each enquiry got, who left a mobile, who stopped before.
- Business settings, quote page mode, messaging (number, credits, plan usage, paused or not, quiet hours), automation rules and sequence, team members and roles.
- Campaign comparison: results of any two campaigns or offers side by side (sent, delivered, replied, booked) with a plain-English read on what worked.

### Tell it to do things (write, immediate)
- Cancel or move any confirmed booking; complete and record payment.
- Update any customer field or status; put a lead on, take it off, or restart its follow-up sequence.
- Change business details, quote page mode (manual or AI chat), availability, service prices and add-ons.
- Pause or resume sending; change owner notification settings.
- Change automation rules and sequence timing.
- Team access: invite, remove, change role (owner only).

### Anything that texts a customer (confirm first)
- Single texts and campaigns are drafted and shown as a Confirm card with recipients and wording. Nothing goes out until you tap Send.
- New: outreach campaigns to any consented group — e.g. "9 imported leads never contacted" — not just dormant customers. Opt-outs, quiet hours, credits and daily caps still apply and blocked recipients are listed, not silently skipped.

### Upload a CSV in chat
- Attach a file to the assistant. It reads it, restructures it to your lead inbox shape (first/last name, mobile, email, source), repairs Australian numbers, drops rows without a usable mobile, spots duplicates, and shows you a summary. You say OK and it imports.

### Guard rails that stay
- Every tool is scoped to your business server-side; the model never supplies a business id.
- It must look a record up before changing it; two matches means it asks.
- Deleting customers, buying numbers and billing stay out of the assistant.
- Every change is written to your audit log and named in the reply; the affected pages refresh.
- If it cannot do something it says exactly what it needs, never "I am read-only".

## Technical detail

**Tools** (`src/lib/assistant-tools.server.ts`, split into per-area modules under `src/lib/assistant-tools/`): all thin wrappers over existing server logic, `businessId`/`userId`/`role` closed over from `requireSupabaseAuth` context.
- Reads: `query_leads` (wraps `queryLeadInbox` predicates: status, source, delivery, reply, date range), `customer_history` (leads + messages + jobs + reactivation_drafts + sequence_campaigns + agent_actions + consent_events), `list_bookings` (past/future/range), `quote_funnel` (`loadQuoteFunnel`), `unfinished_prospects` (`loadUnfinishedProspects`), `operational_metrics` (`computeMetrics`, `getSmsDeliverySummary`), `read_settings` (`getSettings`/`readTenantAccount`/`getSmsSetup`/texto account report/automation rules/team from profiles+user_roles), `compare_campaigns` (aggregates drafts/messages/jobs per campaign).
- Writes: `update_settings` (`saveBusinessSettings`, `saveQuotePageMode`, `saveAvailabilitySettings`, `saveOwnerNotificationSettings`), `set_sending_paused` (messaging-account pause), `update_automation_rule`, `set_lead_sequence` (pause/resume/restart via `setAutomationPaused` + `planLeadSequence`), `manage_team` (owner-only, existing profile/role helpers), plus the existing booking/customer/catalogue tools.
- Sends become proposals: `send_text`, `draft_campaign`, new `draft_outreach_campaign` return a `pending_send` proposal; a new `confirm_send` server function executes it through `sendSms`/`approveReactivationCampaign`. Outreach campaign: new `audience` option on `draftReactivationCampaign` (`dormant` | `uncontacted` | `status:<x>` | explicit lead ids) with consent/opt-out/suppression filters retained; the reactivation memory rule about dormant leads applies to the default audience only.
- CSV: composer accepts a file; contents parsed with existing `import-lite` + `phone-repair` + `import-save.server` path; `preview_import` tool returns summary + batch id, `confirm_import` runs `saveImportBatch`.
- Agent loop (`assistant-agent.server.ts`): keep gemini-3.8-flash, `stepCountIs(50)`, add role to context, return `proposals` alongside `executed`. Rewrite `buildAssistantSystemPrompt` in `owner-assistant.ts`: full capability list, "read before write", "sends need confirmation", ban refusal phrasing; remove the read-only guard patterns.
- UI (`OwnerAssistant.tsx`): render pending-send and pending-import cards with Confirm/Cancel; file attach button in the composer; invalidate bookings/leads/settings/funnel queries after any executed action.
- Persistence: proposals and executed actions saved on `assistant_messages.proposals` as today.
- Tests: per-tool tenant scoping, role gating, send-confirmation gate, outreach audience filters, CSV summary/confirm, campaign comparison maths; then a live run of your exact "9 uncontacted leads" request and a customer-history question.

No schema change expected; if the outreach audience needs a column on `reactivation_campaigns`, that migration will be raised for approval separately.
