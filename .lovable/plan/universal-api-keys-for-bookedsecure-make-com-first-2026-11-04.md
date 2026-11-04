# Universal API keys for BookedSecure (Make.com first)

## Goal
Owners can create API keys inside BookedSecure and paste them into Make.com (or Zapier, n8n, custom code, any tool that supports "API key" auth). Make.com can then send Meta Lead Ads leads straight into BookedSecure, and read back customers/bookings. MCP stays as the separate, sign-in-based connection for ChatGPT, Claude, Grok and other AI assistants.

## What the owner sees
- New **Settings → Integrations → API keys** page:
  - "Create key": name it (e.g. "Make.com – Meta leads"), choose access: *Add leads only* or *Read & write*.
  - The full key is shown **once** with a copy button; afterwards only the last 4 characters.
  - List of keys with last-used time, request count, and a **Revoke** button.
  - Short Make.com guide: which module to use, the URL to paste, and how to map Meta lead fields.
- New leads from the API show source "Meta (via Make.com)" or the source name sent, so Facebook attribution improves.
- New leads trigger the normal flow: owner notification, instant acknowledgement text (respecting opt-outs, mobile checks, credits and quiet hours), follow-ups as configured.

## First version of the API (v1)
| Action | Purpose |
|---|---|
| Check connection | Make.com "test connection" – returns business name only |
| Create lead | Name, mobile, email, service, message, source, campaign/ad name. Reuses an existing customer with the same mobile instead of duplicating |
| Find customers | Search by name/phone/email, paged |
| List bookings | Upcoming/date range, paged |
| List services | So Make.com can map service names |

Booking creation, campaigns and texting stay **out** of v1 – they keep their in-app Confirm safeguards. Can be added later through the same shared actions Cowork/MCP use.

Also provide a downloadable **OpenAPI description** so Make.com's "HTTP – Make a request" module, Zapier and others can be set up easily. A dedicated Make.com custom app can come later.

## Safety
- Keys are stored hashed (never readable again), tied to one business only; a key can never touch another tenant.
- Each key has a scope; "Add leads only" keys cannot read customer data.
- Rate limits per key; requests rejected when the subscription is inactive.
- Every request logged (key, action, result) for the owner and the Control room; revoke takes effect immediately.
- Input strictly validated; Australian mobile normalisation reused; duplicate submissions from Make.com retries ignored via an optional idempotency key.

## Technical details
- Table `api_keys` (tenant_id, name, prefix, sha256 hash, scopes, created_by, last_used_at, revoked_at) + `api_key_requests` log; RLS owner-only, writes via owner-verified server functions.
- Routes under `src/routes/api/public/v1/*` (`/me`, `/leads`, `/customers`, `/bookings`, `/services`, `/openapi.json`); auth via `Authorization: Bearer bs_live_...` (also `X-API-Key`). Handler hashes key, resolves tenant, then calls a tenant-scoped SECURITY DEFINER RPC (`api_create_lead`, etc.) that re-checks key scope/revocation and subscription, writes atomically and audits — no admin client for ordinary reads.
- Lead creation reuses existing create-customer logic (same-mobile reuse, opt-out, deleted-lead rules) and existing notification triggers.
- Tests: key hashing/verification, scope enforcement, cross-tenant rejection, revoked key, duplicate mobile reuse, validation errors.
- Record architecture rule in AGENTS.md.

## Out of scope for now
Direct Meta connection, outgoing webhooks to Make.com (e.g. "booking created" triggers) — good second phase.
