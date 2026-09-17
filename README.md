# BookedSecure

# SMS Lead Recovery Micro-App MVP

## 1. Product Summary

Build a reusable SMS lead-response and follow-up micro-app for Australian mobile detailing businesses, starting with **Glocast**, a Sydney mobile detailing business.

The app should help businesses respond to new enquiries quickly, collect the information needed for a quote, follow up with leads who do not respond, and convert more enquiries into **completed detailing jobs**.

The first version should be a **controlled smart quote form with SMS follow-up**, not a generic SaaS platform or an uncontrolled AI chatbot.

### Recommended MVP direction

1. Lead enters through a website form, Meta lead form, hosted quote page, or embed widget.

2. The lead receives an immediate SMS acknowledgement.

3. The system asks a small number of structured questions:

   - Vehicle type

   - Suburb

   - When the vehicle was last cleaned

   - Main concerns

   - Service intent

4. The business receives a lead summary and suggested next action.

5. If the lead does not respond, the system sends carefully timed follow-ups.

6. The business can reply manually or approve an AI-suggested response.

7. The system records whether the lead became a **completed job**, not merely a scheduled booking.

AI chat can be added later as a constrained enhancement after the smart-form workflow is working reliably.

---

## 2. Current Baseline

Glocast currently receives approximately:

- **120–150 total enquiries per month**

- Approximately **70–100 Meta leads per month**

- Additional website enquiries

- Approximately **15% of all enquiries become completed jobs**

- Average completed job value: approximately **$350**

- Response time can be as long as **24 hours**

- The owner generally asks:

  - When was the vehicle last cleaned?

  - What are the customer’s main concerns?

- The owner already texts leads who do not answer and is willing to pay for a system that improves this process.

### Approximate current monthly outcome

At 120–150 enquiries and a 15% completed-job rate:

- **18–22.5 completed jobs per month**

- Approximately **$6,300–$7,875 gross completed-job revenue per month before costs**

These figures are approximate, based on the supplied baseline. They are **not a forecast or guarantee**. The system must collect reliable baseline and pilot data before claiming that faster response or SMS follow-up caused an improvement.

### Important measurement distinction

The system must separately track:

- Meta leads

- Website enquiries

- Hosted quote page leads

- Manual leads

- Other future channels

It must not combine channels when reporting performance. Meta and website leads may have different intent, quality, and conversion rates.

---

## 3. Problem

Glocast can lose potential jobs because:

- A lead may wait up to 24 hours for a response.

- The customer may contact another detailer first.

- Website and Meta leads may not receive consistent follow-up.

- The owner has limited time to ask qualification questions and continue conversations.

- A lead who does not answer the first message may never be contacted again.

- It is difficult to distinguish:

  - New lead

  - Waiting for customer reply

  - Ready for quote

  - Quote sent

  - Scheduled

  - Completed

  - Lost or opted out

- The current process may not clearly measure completed-job revenue by source.

The product should reduce avoidable lead loss without pretending to replace the business owner’s judgement.

---

## 4. Objective

Create a simple, reusable application that:

- Responds to new leads quickly.

- Collects useful vehicle and service information.

- Sends compliant, controlled SMS follow-ups.

- Helps the business owner prioritise engaged leads.

- Suggests replies using only approved services and rules.

- Tracks the complete journey through to completed job and revenue.

- Supports multiple detailing businesses with secure account separation.

- Can be installed across common website platforms without rebuilding the product for each platform.

### Primary outcome

**More completed jobs and completed-job revenue.**

### Supporting outcomes

- Faster first response

- Fewer leads lost because of no follow-up

- More complete information before the owner replies

- Better visibility into Meta versus website performance

- Less repetitive manual texting

---

## 5. Success Metrics

The MVP should measure results rather than claim them.

### Operational metrics

- Median time from lead creation to first SMS

- Percentage of leads receiving an SMS within five minutes

- SMS delivery rate

- Customer reply rate

- Percentage of leads completing the smart form

- Follow-up completion rate

- Opt-out rate

- Number of conversations requiring manual intervention

### Commercial metrics

- Completed jobs by source channel

- Completed-job rate by source channel

- Completed-job revenue by source channel

- Average completed job value

- Leads marked lost

- Time from lead creation to completed job

- Revenue per enquiry

### Pilot comparison

Before activating automated follow-up, record at least several days of baseline data where possible:

- Number of leads

- Response time

- Replies

- Completed jobs

- Completed-job revenue

- Source channel

During the pilot, compare the same metrics. Do not claim causation unless the data supports it. Changes may be influenced by seasonality, lead quality, advertising changes, capacity, pricing, or business follow-up behaviour.

---

## 6. User Roles

### Business owner

Can:

- View leads and conversations

- Configure business details

- Configure approved services and pricing rules

- Review AI summaries and suggested replies

- Send manual SMS messages

- Mark lead stages

- Record completed jobs and revenue

- Manage opt-outs

- View analytics

### Staff member

Can, depending on permissions:

- View assigned leads

- Reply to conversations

- Update lead status

- Record notes

- Mark jobs as completed

Staff should not automatically access provider credentials, billing settings, or another business’s data.

### Platform administrator

Can:

- Create and manage business accounts

- Troubleshoot integrations

- View technical logs

- Disable an account

- Manage provider configuration

Platform administrators should not casually view customer message content unless needed for support and permitted by the business.

### Lead/customer

Can:

- Submit an enquiry

- Receive SMS messages

- Reply by SMS

- Complete the quote questions

- Opt out of marketing or follow-up messages

---

## 7. Exact Customer Workflow

### Workflow A: Website, hosted page, or widget enquiry

1. Customer submits the quote form.

2. The app validates:

   - Name

   - Mobile number

   - Suburb

   - Vehicle type

   - Main concern

   - Desired service or service intent

   - Consent or acknowledgement appropriate to the communication type

3. The app creates a lead with:

   - Business account ID

   - Source channel

   - Campaign or form identifier, if available

   - Timestamp

4. The app sends an immediate SMS:

> Hi {{first_name}}, thanks for contacting Glocast. We’ve received your detailing enquiry. To help us understand what your vehicle needs, reply with the vehicle type and your main concern. Reply STOP to opt out.

5. The system sends a guided question sequence, either:

   - On the web form before submission, or

   - By SMS after submission

6. The owner sees:

   - Lead details

   - Conversation

   - AI-generated summary

   - Readiness classification

   - Suggested next reply

7. The owner approves or edits a response.

8. The lead progresses through the status workflow.

9. When the job is actually completed, the owner records:

   - Completed date

   - Final job value

   - Service performed

   - Source channel confirmation

### Workflow B: Meta lead

1. Meta sends a lead to the app through an approved integration, webhook, connector, or imported lead process.

2. The app stores the source as **Meta** and records campaign or form identifiers when available.

3. The app sends a compliant SMS only where the business has an appropriate basis and consent to contact the lead by SMS.

4. The system begins the same guided follow-up sequence.

5. If Meta integration is not practical for the first pilot, use a secure webhook or manual CSV/import fallback, but preserve the source as Meta.

### Workflow C: Customer replies

1. SMS provider sends an inbound webhook to the app.

2. The app verifies the webhook where supported.

3. The message is stored against the correct business and lead.

4. The conversation status changes to **Customer replied**.

5. AI extracts structured information if present.

6. AI generates:

   - A short summary

   - Missing information

   - Suggested reply

   - Readiness classification

7. The owner receives an in-app alert or email notification.

8. The system must not send an AI-generated reply automatically in the MVP unless the rule is explicitly approved and deterministic.

### Workflow D: Customer does not reply

Use a conservative sequence configured per business:

- **Immediately:** acknowledgement message

- **After approximately 4–6 hours:** one useful follow-up question

- **After approximately 24 hours:** final non-aggressive follow-up

- Then stop automated follow-up unless the customer replies or the owner manually reopens the conversation

Example:

> Hi {{first_name}}, just checking whether you still need help with your vehicle. If you reply with the vehicle type and your main concern, the Glocast team can point you in the right direction. Reply STOP to opt out.

Avoid excessive messages. The business should be able to change timing and disable follow-ups.

### Workflow E: Completed job

A booking is **not** counted as a conversion merely because it was scheduled.

A lead becomes a completed job only when the owner explicitly marks:

- Job completed

- Completed date

- Final amount collected or job value

- Service performed

The dashboard must use completed jobs for primary conversion and revenue reporting.

---

## 8. Lead Statuses

Use a small, clear status set:

- New

- Contacted

- Waiting for customer

- Customer replied

- Ready for quote

- Quote sent

- Scheduled

- Completed

- Lost

- Opted out

- Invalid

The application should prevent automated SMS from being sent when the lead is:

- Opted out

- Invalid

- Completed, unless a separate approved message is being sent

- Manually paused

---

## 9. MVP Scope

### Must be built now

#### Lead capture

- Hosted smart quote page

- Embeddable form or iframe option

- Webhook endpoint for external forms

- Source channel field

- Meta and website source tracking

- UTM and campaign fields where available

#### Lead management

- Lead list

- Lead detail page

- Conversation timeline

- Status management

- Notes

- Owner/staff assignment

- Completed-job recording

#### SMS

- Outbound SMS

- Inbound replies

- Delivery and failure statuses

- Opt-out handling

- Follow-up scheduling

- Manual reply from the app

- Provider abstraction

#### AI assistance

- Extract:

  - Vehicle type

  - Suburb

  - Last-clean date

  - Main concerns

  - Service intent

- Summarise the conversation

- Classify readiness

- Identify missing information

- Suggest replies using approved rules

#### Business configuration

- Business name

- Service area

- Approved services

- Approved service descriptions

- Price ranges or fixed prices, if the owner chooses to provide them

- Opening hours

- Follow-up timing

- SMS signature

- Staff accounts

#### Reporting

- Leads by source

- Reply rate

- Completed jobs

- Completed-job rate

- Completed-job revenue

- Average completed job value

- Response time

- Opt-outs and delivery failures

---

## 10. Explicitly Excluded from MVP

Do not build these in the first release:

- Generic chatbot that answers anything

- Automatic negotiation

- AI-generated discounts

- AI-generated availability promises

- AI-invented prices

- Complex booking-calendar synchronisation

- Payments and deposits

- Invoicing

- Full CRM replacement

- Email marketing automation

- Voice calling

- Review-request automation

- Customer login portal

- Native iOS or Android apps

- Multi-country compliance

- Large agency white-label system

- Automated ad campaign optimisation

- Advanced attribution claims

- Automatic AI replies without approval

- Deep integrations with every website platform

The MVP should prove the core workflow first: **capture → respond → follow up → qualify → complete job → measure revenue**.

---

## 11. Data Model

Use Lovable’s database with a relational structure such as Supabase/Postgres, where available through the Lovable project.

### `businesses`

- `id`

- `name`

- `timezone`

- `phone_number`

- `service_area`

- `opening_hours`

- `default_sms_provider`

- `created_at`

- `status`

### `users`

- `id`

- `business_id`

- `name`

- `email`

- `role`

- `active`

- `created_at`

### `leads`

- `id`

- `business_id`

- `name`

- `mobile_number`

- `email`

- `suburb`

- `vehicle_type`

- `last_cleaned_at`

- `main_concerns`

- `service_intent`

- `source_channel`

- `source_campaign`

- `source_form`

- `utm_source`

- `utm_campaign`

- `status`

- `readiness_classification`

- `consent_record`

- `opted_out_at`

- `created_at`

- `updated_at`

### `conversations`

- `id`

- `business_id`

- `lead_id`

- `status`

- `last_message_at`

- `next_follow_up_at`

- `automation_paused`

- `created_at`

### `messages`

- `id`

- `business_id`

- `lead_id`

- `conversation_id`

- `direction`

- `body`

- `provider_message_id`

- `delivery_status`

- `error_code`

- `sent_at`

- `received_at`

### `services`

- `id`

- `business_id`

- `name`

- `description`

- `price_guidance`

- `included_items`

- `excluded_items`

- `active`

### `jobs`

- `id`

- `business_id`

- `lead_id`

- `service_id`

- `scheduled_at`

- `completed_at`

- `completed_value`

- `completion_status`

- `notes`

### `automation_rules`

- `id`

- `business_id`

- `rule_type`

- `delay_minutes`

- `message_template`

- `active`

### `ai_outputs`

- `id`

- `business_id`

- `lead_id`

- `summary`

- `extracted_fields`

- `missing_fields`

- `readiness`

- `suggested_reply`

- `approved_by`

- `created_at`

### `audit_events`

- `id`

- `business_id`

- `user_id`

- `event_type`

- `entity_type`

- `entity_id`

- `metadata`

- `created_at`

---

## 12. Multi-Tenant Isolation

Each business account must be isolated from every other account.

### Required controls

- Every business-owned table includes `business_id`.

- Every authenticated user is linked to one business account.

- Database row-level security must restrict records to the user’s `business_id`.

- Server-side functions must verify business ownership before reading or writing data.

- Provider credentials must never be exposed to the browser.

- AI requests must include only the relevant business and lead data.

- Test accounts must not see Glocast’s records.

- Audit logs should record sensitive administrative actions.

Do not rely only on frontend filters. A user must not be able to change an ID in a browser request and access another business’s leads.

---

## 13. Lovable Architecture

Build the MVP in Lovable using its app interface, database, storage, server-side functions, AI integration, and hosting where practical.

### Suggested components

#### Frontend

- Dashboard

- Lead list

- Lead detail and conversation view

- Smart quote form

- Business settings

- Services and rules editor

- Analytics page

- User and role management

#### Database and storage

- Store structured lead, conversation, message, service, and job records in the database.

- Store uploaded images only if image upload is included later. Image upload is not required for the first MVP.

- Do not store SMS provider secrets in frontend-accessible storage.

#### Server-side functions

Use server-side functions for:

- Sending SMS

- Receiving inbound SMS webhooks

- Receiving delivery status webhooks

- Scheduling or processing follow-ups

- Calling the AI provider

- Validating webhook signatures

- Applying opt-out rules

- Recording provider errors

- Handling provider-specific request formats

#### Hosting

Use Lovable hosting for:

- The app

- Hosted quote pages

- Webhook endpoints, if supported

- Public widget assets, if supported

Do not introduce Railway or Fly.io unless Lovable genuinely cannot support a required server-side function, webhook, scheduled process, or deployment requirement.

### Provider abstraction

Create an internal interface such as:

```text

sendMessage()

handleInboundMessage()

handleDeliveryStatus()

checkBalance()

formatProviderError()

```

The rest of the application should call this internal interface rather than Twilio-specific code.

This allows the business to change from Twilio to ClickSend later without rebuilding lead management, conversations, analytics, or AI features.

---

## 14. Website and Installation Options

The customer website may remain hosted on GoDaddy.

The product should eventually support:

- GoDaddy

- WordPress

- Wix

- Squarespace

- Webflow

- Shopify

- Custom websites

### MVP installation priority

1. **Hosted quote page**  

   Fastest option. The business links to a Lovable-hosted page from ads, website buttons, QR codes, or social profiles.

2. **Iframe embed**  

   Suitable where the website platform permits iframe embeds.

3. **Portable JavaScript widget**  

   A small script loads the quote form and sends submissions to the app. Test restrictions carefully on Wix, Squarespace, Shopify, and other platforms.

4. **Existing-form webhook**  

   External forms can POST lead data to a secure endpoint.

5. **Platform-specific connectors**  

   Add later only where there is proven demand.

The first pilot does not need a perfect universal widget. It needs one dependable installation method for Glocast plus a portable path for future businesses.

---

## 15. Onboarding Flow

A beginner-friendly onboarding wizard should collect:

1. Business name and contact details

2. Business timezone

3. Service suburbs or service radius

4. Approved services

5. Service descriptions

6. Price guidance, if available

7. Opening hours

8. Follow-up timing

9. SMS provider credentials

10. Sending number

11. Website or hosted-page choice

12. Source-channel setup

13. Test lead

The owner should preview:

- Initial SMS

- No-response follow-up

- Opt-out behaviour

- AI-suggested reply

Require a test message before activating automation.

---

## 16. SMS Conversation Logic

### Initial acknowledgement

Keep it short and accurate:

> Hi {{first_name}}, thanks for contacting {{business_name}}. We’ve received your detailing enquiry. Reply with your vehicle type and main concern so we can help. Reply STOP to opt out.

### Guided questions

Ask one question at a time where possible:

1. “What type of vehicle is it?”

2. “When was it last professionally or thoroughly cleaned?”

3. “What are your main concerns—interior, exterior, stains, odour, paint, pet hair, or something else?”

4. “Which suburb is the vehicle located in?”

5. “Are you looking for a quote, a recommendation, or to arrange a service?”

Avoid asking for information already supplied in the form.

### Follow-up rules

- Stop follow-ups when the customer replies.

- Stop follow-ups after opt-out.

- Pause automation when the owner takes over.

- Do not send messages outside configured operating preferences unless the owner explicitly enables it.

- Record every scheduled, sent, failed, and cancelled message.

- Use idempotency keys to prevent duplicate SMS after retries.

### Delivery status handling

Track:

- Queued

- Sent

- Delivered

- Failed

- Undelivered

- Unknown

Show delivery problems to the owner without repeatedly retrying a potentially invalid number.

---

## 17. AI Guardrails

The AI is an assistant, not the decision-maker.

### AI may

- Extract vehicle type

- Extract suburb

- Identify last-clean date

- Identify concerns

- Identify service intent

- Summarise the conversation

- Classify readiness:

  - New

  - Needs information

  - Quote-ready

  - High intent

  - Unclear

  - Not suitable

- Identify missing information

- Suggest a reply based on approved business content

### AI must not

- Invent prices

- Invent discounts

- Promise availability

- Confirm a booking without business approval

- Recommend services not configured by the business

- Make unsupported claims about outcomes

- Provide safety, mechanical, or insurance advice

- Pretend a human has reviewed the lead

- Send unapproved messages automatically in the MVP

### Approved knowledge source

Each business should have a controlled service catalogue containing:

- Service name

- What is included

- What is not included

- Price or price range, if approved

- Service-area rules

- Relevant conditions

- Approved wording

If the information is missing, the AI should say that the owner needs to confirm it.

### Suggested-response format

The AI should return structured output:

```json

{

  "summary": "Customer has a medium SUV in Marrickville with pet hair and odour concerns.",

  "readiness": "quote_ready",

  "missing_fields": [],

  "suggested_reply": "Thanks, we can help with the pet hair and odour concerns. I’ll confirm the suitable service and pricing with you shortly.",

  "needs_human_review": true

}

```

Validate this output before displaying it. Do not place raw AI output directly into an SMS send function.

---

## 18. Australian Compliance Considerations

This is an implementation checklist, not legal advice. Confirm the final process with an Australian privacy and marketing professional.

The system should account for:

- Spam Act requirements for commercial electronic messages

- Appropriate consent or other lawful basis for SMS contact

- Clear sender identification

- A functional unsubscribe mechanism

- Prompt processing of opt-outs

- Privacy Act obligations where applicable

- Australian Privacy Principles

- Secure handling of mobile numbers and message content

- Data retention and deletion requests

- Disclosure of relevant third-party providers

- Appropriate handling of overseas data processing

- Provider rules for Australian long-code or business messaging

### Practical requirements

- Include “Reply STOP to opt out” in appropriate automated messages.

- Recognise common opt-out terms, including STOP, UNSUBSCRIBE, CANCEL, and QUIT, while allowing the business to review edge cases.

- Once opted out, block automated and marketing SMS unless the customer clearly re-consents.

- Store the opt-out timestamp and source message.

- Provide a privacy-policy link on the quote form.

- Do not pre-tick consent boxes.

- Separate service-related communication from promotional follow-up where appropriate.

- Maintain an audit trail of consent, messages, and opt-outs.

- Avoid sending sensitive information by SMS.

---

## 19. SMS Provider Comparison and Test Plan

### Twilio

**Default choice for the first pilot.**

Strengths:

- Strong documentation

- Mature API

- Inbound webhooks

- Delivery-status callbacks

- Broad reliability and ecosystem

- Easier initial technical integration

Items to verify:

- Australian sending number availability

- Local messaging costs

- Sender identity rules

- Opt-out handling

- Number registration requirements

- Message throughput and support

### ClickSend

**Evaluate for Australian pricing and support.**

Strengths may include:

- Australian market familiarity

- Potentially attractive local pricing

- SMS support options

Items to verify through a real test:

- Exact two-way SMS API

- Inbound webhook reliability

- Delivery receipts

- Number provisioning

- Australian sender options

- Support response times

- API consistency

- Opt-out handling

### Texto

Do not select until confirming:

- Exact API documentation

- Two-way SMS support

- Inbound webhook capability

- Delivery statuses

- Australian number and sender support

- Authentication and security model

- Pricing

- Reliability and support

### Provider test plan

For each candidate:

1. Send a test SMS to an Australian mobile number.

2. Reply to the message.

3. Confirm the inbound webhook arrives.

4. Confirm the reply is linked to the correct lead.

5. Test delivery and failure callbacks.

6. Test an invalid number.

7. Test STOP and other opt-out terms.

8. Test duplicate webhook delivery.

9. Test provider timeout and retry behaviour.

10. Compare actual cost per message.

11. Record setup difficulty and support response.

12. Confirm credentials remain server-side.

Select the provider based on reliability, two-way functionality, compliance support, documentation, Australian economics, and ease of switching—not price alone.

---

## 20. Analytics and Dashboard

The first dashboard should show:

### Funnel

- Total enquiries

- Leads contacted

- Customers who replied

- Quote-ready leads

- Quotes sent

- Scheduled jobs

- Completed jobs

- Lost leads

### Source comparison

For each source:

- Lead count

- Median response time

- Reply rate

- Completed-job rate

- Completed-job revenue

- Average completed job value

At minimum, display:

- Meta

- Website

- Hosted quote page

- Manual

- Unknown

### Revenue reporting

Use:

```text

Completed-job revenue = sum of completed_value for jobs marked completed

```

Do not count scheduled or quoted jobs as completed revenue.

Include filters for:

- Date range

- Source

- Status

- Staff member

- Service

---

## 21. Fourteen-Day Pilot Plan

### Days 1–2: Prepare

- Create Glocast business account.

- Configure services and approved wording.

- Connect the selected SMS provider.

- Set up the hosted quote page or embed.

- Create Meta and website source mappings.

- Add privacy and opt-out wording.

- Import or connect a small test lead source.

### Days 3–4: Test internally

Test:

- New lead creation

- Immediate SMS

- Inbound reply

- Delivery callback

- No-response follow-up

- STOP handling

- Duplicate webhook

- AI extraction

- Manual approval

- Completed-job recording

- Source attribution

- Multi-user access

### Days 5–7: Limited live use

- Activate for a controlled portion of new leads.

- Keep the owner reviewing every suggested reply.

- Record issues and false AI extractions.

- Compare response times with the prior process.

- Confirm no duplicate or late messages.

### Days 8–10: Improve

- Adjust questions that customers misunderstand.

- Remove unnecessary SMS.

- Correct service rules.

- Improve lead prioritisation.

- Fix source tracking.

- Review opt-outs and delivery failures.

### Days 11–14: Evaluate

Compare baseline and pilot data:

- Leads received

- Time to first response

- Reply rate

- Completed jobs

- Completed-job revenue

- Results by Meta versus website

- Owner time spent

- Customer complaints or opt-outs

Decide whether to:

- Continue the pilot

- Change follow-up timing

- Improve the form

- Test another SMS provider

- Add the scoped AI chat enhancement

---

## 22. Acceptance Criteria

The MVP is ready for pilot when:

- A new lead can be created from the hosted form.

- The source channel is stored correctly.

- An immediate SMS is sent from a server-side function.

- An inbound SMS reply appears in the correct conversation.

- Delivery status is stored and visible.

- STOP prevents future automated follow-ups.

- Follow-ups stop when the lead replies.

- The owner can pause automation.

- The owner can send a manual reply.

- AI extracts the required fields without inventing missing information.

- AI suggestions require human approval.

- The system never sends an AI-generated price, discount, availability promise, or unsupported claim.

- A lead can be marked completed only through an explicit completed-job action.

- Completed-job revenue is calculated from completed jobs only.

- Meta and website leads appear separately in reports.

- Two test business accounts cannot access each other’s leads.

- Provider credentials are not exposed in browser code.

- Duplicate webhook events do not create duplicate messages or leads.

- The system works through at least one reliable installation method for Glocast.

- The owner can disable automation without developer assistance.

---

## 23. Risks and Mitigations

### AI gives an incorrect suggestion

**Mitigation:** Human approval, approved service catalogue, structured output, clear “needs review” state.

### SMS costs become excessive

**Mitigation:** Limit follow-up sequence, stop on reply, show message usage, configure monthly limits.

### Customers receive messages without valid consent

**Mitigation:** Review lead-source consent, store consent evidence, use compliant wording, obtain legal advice.

### Provider cannot support reliable two-way SMS

**Mitigation:** Test inbound webhooks before selection and maintain the provider abstraction.

### Website platform blocks embeds

**Mitigation:** Use a hosted quote page or existing-form webhook as the fallback.

### Duplicate SMS is sent

**Mitigation:** Idempotency keys, provider message IDs, event de-duplication, retry logs.

### Owner does not use the dashboard

**Mitigation:** Keep the interface focused on today’s leads, replies needing attention, and follow-up actions.

### Conversion results are misinterpreted

**Mitigation:** Track completed jobs separately from scheduled jobs, preserve source channels, and compare against baseline.

### Customer data is exposed across businesses

**Mitigation:** Database row-level security, server-side authorisation, tenant tests, and audit logging.

---

## 24. Pricing and Validation Approach

Do not begin by building a broad SaaS pricing system.

For Glocast, validate willingness to pay using a pilot arrangement that covers:

- Setup

- SMS provider costs

- Platform access

- Reasonable support

- Any agreed implementation work

Potential commercial models to test after the pilot:

- Monthly platform fee plus SMS usage

- Monthly fee with an included message allowance

- Higher tier for multiple staff or multiple locations

- Optional setup fee

Avoid charging purely per “lead recovered” until completed-job attribution is reliable. The business outcome is a **completed job**, not an SMS sent, form submitted, or appointment scheduled.

Ask during validation:

- Is the faster response valuable?

- Does the owner trust the suggested replies?

- Does the workflow save time?

- Which source produces the most completed-job revenue?

- What monthly fee feels reasonable relative to the gross value of additional completed jobs?

- Would the owner continue using it without the founder’s involvement?

Do not promise a specific number of extra jobs or a guaranteed return.

---

## 25. Post-MVP Roadmap

Only add these after the core workflow is reliable:

### Phase 2

- Carefully scoped AI chat form

- Customer image upload for vehicle-condition context

- Better service recommendation rules

- Calendar availability integration

- Saved reply templates

- Team assignment and response SLAs

- More detailed campaign attribution

- ClickSend provider option

### Phase 3

- WordPress plugin

- Improved JavaScript widget

- Shopify and Webflow integrations

- CRM integrations

- Review-request workflow after completed jobs

- Deposits and payment links

- Quote and invoice integrations

- Multiple locations

- Customer conversation search

### Phase 4

- Broader Australian detailing-business templates

- Agency or reseller controls

- Advanced reporting

- Controlled automated replies for narrowly defined scenarios

- Additional communication channels, subject to compliance review

The guiding rule is to improve **completed-job conversion, completed-job revenue, response speed, and follow-up consistency** before adding broad automation or complex integrations.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://bookedsecure.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/32747b7a-7d60-4b57-a38a-e5b710c823bb).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
