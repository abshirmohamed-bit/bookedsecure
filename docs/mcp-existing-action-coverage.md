# Existing AI actions exposed through MCP

MCP does not run a second model for customer, service, add-on, settings or reply-preparation actions. Cowork and MCP use the same typed shared actions and caller-authorized atomic database functions.

## Available (15 MCP tools)
- Existing reads: customers, customer history, bookings, services/add-ons, business snapshot, campaign reports and business settings.
- Shared inbox query: `query_leads`, including source/status/SMS filters and pagination.
- Existing mutations: notes and atomic booking scheduling/moving.
- Shared Cowork mutations: customer creation, service and add-on creation/updates, business-detail updates (including service area).
- Shared text preparation: `send_text` saves an approval card to the ongoing Cowork conversation. The owner confirms in BookedSecure. It does not send directly, and does not claim delivery.

## Not yet exposed
Cowork also supports richer customer updates, booking completion/cancellation/deletion, bulk status changes, add-on linking, SMS/email campaign drafting, imports, quote funnel/unfinished prospects/performance, automation changes and team access. These remain available in the app, not through MCP. Their current privileged implementations must not be imported wholesale into OAuth tools. Each needs a caller-scoped shared boundary and any existing approval behavior preserved before exposure.

## Verification boundaries
Unit tests cover shared dispatch, exact prices, tenant-bound reply preparation, failures and proposal-only behavior. The rollback-only database integration script exercises actual saved/readback state, tenant isolation, trial/role checks and approval cards without sending SMS or leaving test records. Manifest extraction confirms the 15-tool catalog. Neither test proves a ChatGPT-hosted call; that requires republishing and a completed external OAuth connection.