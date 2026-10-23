# Existing AI actions exposed through MCP

MCP does not run a second model for customer, service, add-on, settings or reply-preparation actions. Cowork and MCP use the same typed shared actions and caller-authorized atomic database functions.

## Available (28 MCP tools)
- Existing reads: customers, customer history, bookings, services/add-ons, business snapshot, campaign reports and business settings.
- Shared inbox query: `query_leads`, including source/status/SMS filters and pagination.
- Existing mutations: notes and atomic booking scheduling/moving.
- Shared Cowork mutations: customer creation, service and add-on creation/updates, business-detail updates (including service area).
- Shared text preparation: `send_text` saves an approval card to the ongoing Cowork conversation. The owner confirms in BookedSecure. It does not send directly, and does not claim delivery.
- Shared operations: customer detail/status updates, local-time booking and rescheduling, booking cancellation/completion, add-on linking, bulk status changes, quote mode, automated sending pause/resume, business follow-up rules and customer follow-up overrides.
- `request_account_action` stores broader existing Cowork work as a pending request in the ongoing conversation. In-app Confirm passes it to the existing assistant. Messaging and import approvals are still separate. This is not execution or delivery.

## Not directly exposed
Deletion, campaign drafting, import review, team access and richer operational reporting are available by preparing a Cowork request, not standalone remote execution. File imports still require a file attached inside BookedSecure. Payments and billing remain outside assistant access. Existing privileged builders are never registered directly as MCP tools.

## Verification boundaries
78 targeted checks passed for shared actions, operational adapters, existing MCP reads/writes, connection diagnostics and timezone conversion. Rollback-only integration scripts cover saved/readback state, tenant isolation, permissions and approval cards, but could not execute: the diagnostic connection cannot update profile fixtures or assume the authenticated role. No test records were saved. Signed-in integration-page rendering was verified; a real pending-request test was rejected because the current preview account’s trial/subscription has ended. Its Confirm flow therefore remains unverified. Manifest extraction confirms 28 tools, not deployment. External ChatGPT calls against this revision require republishing and refreshed tool discovery in the connected client.