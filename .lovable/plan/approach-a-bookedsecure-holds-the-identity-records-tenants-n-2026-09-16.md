# Approach A — BookedSecure holds the identity records, tenants never deal with the number provider

You verify once with the provider, and from then on every dedicated number is bought
through BookedSecure using your saved card. In return you must be able to produce, on
request, the verified identity of the business behind each number. So the app needs a
proper identity record per business — collected in the app, stored privately, and
required before a number is issued.

## What changes for a business owner

1. On the messaging page, before "Show me available numbers", they complete a short
   **Business identity** step: legal/trading name, ABN, registered address, website,
   contact name, contact email, contact mobile, and the kinds of messages they will send.
2. They tick a declaration that the details are true and that they are the business
   responsible for the number.
3. Once saved, the number step unlocks. If identity is missing or incomplete, the
   number button explains exactly which fields are outstanding instead of failing later.
4. Nothing about the provider, pricing, or your costs is shown. Their plan price is
   unchanged.

## What changes for you

- A platform-admin view lists every business with its identity record, when it was
  submitted, and which number it is tied to — so an authority request can be answered
  in one place.
- Identity is captured at the moment the business asks for a number, not at signup, so
  existing tenants are never blocked retroactively.
- Glocast's record is pre-filled from what you already gave: Glocast Pty Ltd,
  ABN 20 284 379 143, glocast.com.au.

## Technical notes

- New table `business_identity` (one row per business): legal name, trading name, abn,
  address lines, state, postcode, country, website, contact name/email/phone, message
  types (text array), declaration accepted at/by, status (`pending`/`verified`),
  verified_at, verified_by, plus timestamps. RLS: owner of the business can select and
  insert/update their own row; `platform_admin` can select all; GRANTs for
  `authenticated` and `service_role`, no `anon`.
- Reuse `businesses.abn` and `businesses.website` as the seed values when the form
  first opens; the identity row becomes the authoritative record afterwards.
- Server functions in `src/lib/tenant-identity.functions.ts` (+ `.server.ts` I/O):
  `getBusinessIdentity`, `saveBusinessIdentity` (owner-only via `requireWriteContext`),
  both audited through `recordAuditEvent`.
- `claimNumberForBusiness` / `purchaseNumberForBusiness` in
  `src/lib/sms/texto-accounts.server.ts` gain a hard gate: no complete identity record →
  return `{ ok: false, code: "identity_required", missing: [...] }`. The provider request
  additionally sends `label` as the business name so numbers are traceable at the
  provider.
- `DedicatedNumberPanel` renders the identity form when the record is missing or
  incomplete, and handles the new `identity_required` result by scrolling to it.
- Admin listing added to `src/routes/admin.messaging-numbers.tsx`, reading through a
  `platform_admin`-gated server function.
- Tests: identity validation (ABN 11 digits, required fields), owner-only writes,
  cross-tenant read isolation, and the number-claim gate.

## Still manual, once only

The provider's card registration happens in their own app the first time. After that
first purchase, BookedSecure buys numbers through the API with the saved card and no
back-and-forth per tenant.
