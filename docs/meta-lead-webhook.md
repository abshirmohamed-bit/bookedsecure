# Direct Meta form intake for Glocast

This integration receives Meta Page `leadgen` webhook events, fetches each lead's form answers from the Graph API, and records it in Booked Secure's lead inbox. `captureLead` runs the existing owner alert and acknowledgement rules. HubSpot can keep its own independent Meta connection. No Make scenario or HubSpot paid workflow is needed.

## Server configuration

Set these on the Booked Secure deployment, never in the browser or the repository:

| Variable | Purpose |
| --- | --- |
| `META_APP_SECRET` | Meta app secret for the `X-Hub-Signature-256` webhook signature |
| `META_WEBHOOK_VERIFY_TOKEN` | A new random value entered in Meta's webhook subscription screen |
| `META_PAGE_ACCESS_TOKEN` | Page token with lead retrieval access for the Glocast Page |
| `META_PAGE_ID` | Exact Page ID subscribed to `leadgen` |
| `META_FORM_ID` | Exact lead form ID to accept |
| `META_GRAPH_API_VERSION` | Graph API version supported by the Meta app, such as `v23.0` |
| `META_BUSINESS_ID` | Glocast business UUID in Booked Secure |
| `META_SMS_CONSENT_FIELD` | Exact field name of an explicit SMS permission question on the Meta form |
| `META_SMS_CONSENT_VALUE` | Exact affirmative answer to that question |

The last two settings are optional for lead capture. Without both, the lead enters the inbox and triggers the owner alert, but the customer acknowledgement is suppressed. Configure them only after checking the live form's wording and returned field name. Existing Booked Secure acknowledgement rules and Texto settings must also be enabled for an SMS to send.

## Meta app setup

1. In the Meta developer app with access to the Glocast Page, configure the Page webhook callback as `https://<your Booked Secure host>/api/public/leads/meta` and enter the verify token above.
2. Subscribe the Page to the `leadgen` field and grant the app/Page token the required lead retrieval permission. Check the app's access level and live mode for leads from real customers.
3. Enter the exact Page and form IDs in the deployment settings. Ensure the Page is subscribed to the app; simply verifying the callback does not subscribe the Page.
4. Submit one test lead using Meta's Lead Ads Testing Tool. Confirm a single Booked Secure inbox record with `source_channel=meta`, the form ID and contact fields. Submit/replay the same lead ID again and confirm there is no second lead or SMS.
5. If SMS consent is present on the form, set its exact field/value, submit a **new** test lead with consent, and check one Texto outbound message and the Booked Secure conversation. Test a declined/no-answer submission too: it should create a lead without texting the customer.

Webhook verification rejects unsigned or altered requests. Page and form IDs are checked both in the event and the fetched lead. Meta retries a failed delivery on a non-2xx response; repeat deliveries use the Meta lead ID as Booked Secure's idempotency key. Deployment and Meta app configuration are required before this route receives live leads.
