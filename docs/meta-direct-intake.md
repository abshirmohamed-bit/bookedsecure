# Direct Meta Lead Ads intake

This route replaces Make for **new** Facebook/Instagram Instant Form submissions.
It does not import historical submissions or send a customer SMS. It verifies
Meta's callback signature, fetches answers from Graph API, creates or updates
the Booked Secure lead and conversation, and emits the existing owner alert.
The current form has not been verified to capture explicit SMS consent, so
`consent` remains false and the acknowledgement path is disabled.

## Form wording and evidence

Put the contact permission on the Instant Form itself, visible before Submit,
with Glocast identified. A proposed enquiry-specific choice is:

> I agree that Glocast Mobile Auto Detailing may call or text me at the number
> provided about my detailing quote request. I can ask Glocast to stop texting
> me at any time.

If Glocast wants to send later promotional offers, use a separate optional
choice that names those messages. Ad copy or a privacy-policy link alone does
not prove that a particular lead selected a choice. Store the exact form
version and wording, lead ID, submission time, checkbox response if available,
and withdrawal/STOP history. Map `consent: true` only for a verified response
from the exact approved form; do not infer it from a phone number or the
business owner's authorization. Review the wording and form setup before
enabling an SMS rule.

## Deployment configuration

Configure these server-only environment variables in the deployment; do not
put their values in Git or a browser bundle:

| Name | Purpose |
| --- | --- |
| `META_WEBHOOK_VERIFY_TOKEN` | Random shared token entered in Meta Webhooks setup |
| `META_APP_SECRET` | Meta app secret for `X-Hub-Signature-256` validation |
| `META_PAGE_ID` | Glocast Facebook Page ID |
| `META_PAGE_ACCESS_TOKEN` | Page token permitted to retrieve Lead Ads answers |
| `META_GRAPH_API_VERSION` | Supported Graph API version such as `vXX.X` |
| `META_BUSINESS_ID` | Glocast business UUID in Booked Secure |

Create a Meta Business app with Lead Ads access and a Page webhook subscribed
to `leadgen`. Set the callback to
`https://bookedsecure.com/api/public/meta/leads` and use the verification token
above. Grant the app lead access to the Page and verify the required Meta app
permissions. This connection is a separate Meta CRM integration; it does not
remove the existing HubSpot lead sync.

## Verification before enabling customer messaging

1. Deploy the route and secrets, and complete Meta's callback verification.
2. Submit a test lead with a phone and email owned by the business through
   Meta's Lead Ads Testing Tool. Check that one new lead appears in Booked
   Secure with source `meta` and the form answers in source metadata.
3. Redeliver the same event and confirm no second lead, conversation, owner
   alert or customer message appears. Confirm a second Page cannot write a lead.
4. Review the exact Meta form's SMS consent language and response field. Only
   then implement a verified consent mapping and enable an acknowledgement rule.
   Keep replies and opt-outs in Booked Secure's existing Texto conversation.

The route requires a valid signature and configured Page ID. It uses the
Meta `leadgen_id` as the durable event key and the existing webhook ledger to
claim retries. A Graph API or database failure returns a retryable error.
