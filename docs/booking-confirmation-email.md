# Booking confirmation email (feature-flagged)

Companion to the operational booking confirmation SMS. Implemented on
`feat/booking-confirmation-email` — **not** live until merged to `main` and
env flags are set. Default behaviour: **SMS only** (email gated OFF).

## Env (BookedSecure host — never commit secrets)

| Variable | Default | Purpose |
|---|---|---|
| `BOOKING_CONFIRM_EMAIL_ENABLED` | unset / not `true` | Master switch. Must be `true` to send anything. |
| `BOOKING_CONFIRM_EMAIL_TEST_TO` | unset | When set, **every** send goes only to this address (never the customer). Use for QA. |
| `BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER` | unset / not `true` | Required (with no TEST_TO) before a real customer address may be used. |
| `RESEND_API_KEY` | unset | Resend API key. Read from host env only. |
| `BOOKING_CONFIRM_EMAIL_LOGO_URL` | `${PUBLIC_APP_URL}/email/glocast-logo-gc-transparent-email560.png` | Absolute PNG URL for the logo. |
| `BOOKING_CONFIRM_EMAIL_HERO_URL` | `${PUBLIC_APP_URL}/email/glocast-hero-smiling.jpg` | Absolute JPEG URL for the hero photo. |
| `PUBLIC_APP_URL` | `https://bookedsecure.com` | Origin used for default asset URLs and reschedule links. |

## Behaviour

- Wired next to `deliverBookingConfirmation` inside `finalizeBookingOnlyBooking`.
- From: `Glocast <info@glocast.com.au>` via Resend REST.
- Idempotency-Key: `booking_confirm_email:{offerId}`.
- No lead email → skip email (SMS still runs).
- Email failure → recorded in `audit_events`; booking + SMS unaffected.
- No secrets in the repo.

## Assets

Static files under `public/email/` (served after deploy):

- `/email/glocast-logo-gc-transparent-email560.png`
- `/email/glocast-hero-smiling.jpg`

Until `main` is deployed, override with `BOOKING_CONFIRM_EMAIL_*_URL` pointing
at a CDN (e.g. jsDelivr raw from the feature branch) if you need a render test.

## Go-live checklist

1. Set `RESEND_API_KEY` in BookedSecure env (Resend dashboard; domain verified).
2. QA with `BOOKING_CONFIRM_EMAIL_ENABLED=true` + `BOOKING_CONFIRM_EMAIL_TEST_TO=info@glocast.com.au`.
3. When ready for customers: clear TEST_TO, set `BOOKING_CONFIRM_EMAIL_ALLOW_CUSTOMER=true`.
4. Merge feature branch to `main` only with explicit approval (Lovable deploys `main`).
