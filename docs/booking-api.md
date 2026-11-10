# BookedSecure booking API

For a business whose own website shows the quote and booking screens, with
BookedSecure keeping the records, sending the confirmation and the reminder.

```
Customer picks package, size, extras ─► website calls /booking/quote and /booking/availability
Customer picks a time and confirms   ─► website calls /booking/book
BookedSecure re-checks, saves the customer and booking together, texts the confirmation once
The time disappears from /booking/availability (and from the BookedSecure quote page)
```

## Base URL and authentication

- Base URL: `https://bookedsecure.com/api/public/v1`
- Key: the business owner creates one in BookedSecure → **Setup → Connections → API keys**, access
  **"Website quotes and bookings"**. It only allows the four booking endpoints below.
- Send it as `Authorization: Bearer bs_live_…` (or `X-API-Key: bs_live_…`).
- **Keep the key on your server.** Call these endpoints from your website's backend (or a serverless
  function), never from browser JavaScript, where anyone could read the key.
- Limit: 60 requests per minute per key. Cache `/booking/options` for a few minutes.
- Every response is JSON with `ok: true|false`. Errors look like
  `{"ok": false, "error": {"code": "slot_unavailable", "message": "…"}}`.
- Machine-readable description: `GET /api/public/v1/openapi.json`.

## 1. Options: packages, sizes and add-ons

`GET /booking/options`

```json
{
  "ok": true,
  "business": { "name": "Glocast Mobile Auto Detailing", "timezone": "Australia/Sydney" },
  "online_booking": true,
  "rules": { "lead_time_minutes": 120, "horizon_days": 14, "travel_buffer_minutes": 30, "slot_step_minutes": 30 },
  "services": [
    {
      "id": "5f0c…",
      "name": "Full Detail (Interior & Exterior)",
      "price_text": "$229",
      "price": 229,
      "price_kind": "exact",
      "duration_minutes": 180,
      "bookable_online": true,
      "sizes": [
        { "key": "small-car", "label": "Small car", "price": 229, "duration_minutes": 180 },
        { "key": "suv", "label": "SUV", "price": 269, "duration_minutes": 210 }
      ],
      "addons": [
        { "id": "a9d2…", "name": "Leather Protection", "price_text": "$150.00", "price": 150, "price_kind": "exact", "duration_minutes": 60 }
      ]
    }
  ]
}
```

- `sizes` is empty when the package has one price and length. When it isn't empty, a size is required.
- `price_kind`: `exact`, `from` (a starting price, e.g. "from $149") or `on_request` (no figure; the
  business confirms the price). Prices are always the business's own; nothing is invented.
- Only show packages with `bookable_online: true` for online booking (the rest have no set length).

## 2. Quote

`POST /booking/quote`

```json
{ "service_id": "5f0c…", "size": "suv", "addon_ids": ["a9d2…"] }
```

```json
{
  "ok": true,
  "quote": {
    "service": { "id": "5f0c…", "name": "Full Detail (Interior & Exterior)" },
    "size": { "key": "suv", "label": "SUV" },
    "addons": [{ "id": "a9d2…", "name": "Leather Protection" }],
    "lines": [
      { "kind": "service", "id": "5f0c…", "name": "Full Detail (Interior & Exterior) (SUV)", "price": 269, "price_kind": "exact", "duration_minutes": 210 },
      { "kind": "addon", "id": "a9d2…", "name": "Leather Protection", "price": 150, "price_kind": "exact", "duration_minutes": 60 }
    ],
    "duration_minutes": 270,
    "price": { "amount": 419, "kind": "exact", "currency": "AUD", "label": "$419" }
  }
}
```

Errors (422): `service_not_found`, `size_required`, `size_not_found`, `addon_not_available`, `duration_missing`.

## 3. Availability

`GET /booking/availability?service_id=5f0c…&size=suv&addon_ids=a9d2…&date=2026-11-16&days=7`

- `date` is the first day (YYYY-MM-DD, business timezone); `days` 1–31, default 7. Without `date`,
  it starts from now.
- Times account for the job's full length (package + size + add-ons), existing bookings, blocked time,
  travel time between jobs, working hours and the earliest-booking notice.
- Only times are returned, never anything about other customers.

```json
{
  "ok": true,
  "timezone": "Australia/Sydney",
  "duration_minutes": 270,
  "price": { "amount": 419, "kind": "exact", "currency": "AUD", "label": "$419" },
  "slots": [
    { "start": "2026-11-15T21:00:00.000Z", "end": "2026-11-16T01:30:00.000Z", "label": "Mon 16 Nov, 8:00 am" },
    { "start": "2026-11-15T21:30:00.000Z", "end": "2026-11-16T02:00:00.000Z", "label": "Mon 16 Nov, 8:30 am" }
  ],
  "message": null
}
```

`slots` is empty with a `message` when nothing is open (for example "Online booking is switched off
for this business.").

## 4. Book

`POST /booking/book` with an `Idempotency-Key` header (8–120 characters, letters, numbers, `. _ : -`).
Make one key per checkout (for example a UUID) and **reuse it on every retry of that checkout**.

```http
POST /api/public/v1/booking/book
Authorization: Bearer bs_live_…
Idempotency-Key: checkout-7f3a9c21-4e0b
Content-Type: application/json
```

```json
{
  "service_id": "5f0c…",
  "size": "suv",
  "addon_ids": ["a9d2…"],
  "starts_at": "2026-11-15T21:00:00.000Z",
  "customer": {
    "name": "Sam Lee",
    "mobile": "0412 345 678",
    "email": "sam@example.com",
    "address": "12 Example St",
    "suburb": "Parramatta",
    "vehicle": "Mazda CX-5",
    "notes": "Dog hair in the back seats"
  },
  "sms_consent": true,
  "source": "Glocast website"
}
```

`201 Created` (or `200` with `"replay": true` when the same key is sent again):

```json
{
  "ok": true,
  "replay": false,
  "booking": {
    "id": "c41e…",
    "customer_id": "77b0…",
    "starts_at": "2026-11-15T21:00:00.000Z",
    "ends_at": "2026-11-16T01:30:00.000Z",
    "timezone": "Australia/Sydney",
    "label": "Mon 16 Nov, 8:00 am",
    "quote": { "…": "same shape as /booking/quote" },
    "status": "confirmed"
  },
  "confirmation": { "outcome": "sent", "sent": true }
}
```

What it guarantees:

- **No double bookings.** The time is re-checked, then the customer and booking are saved in one
  database step that locks the business's schedule and refuses any overlap (including travel time).
- **No duplicates.** The same `Idempotency-Key` always returns the first booking and never texts twice.
- **Same customer, one record.** An existing customer with that mobile is reused.
- **Confirmation once**, by text, when `sms_consent` is `true` (show a tick box such as "Text me my
  booking confirmation and reminder"). Without consent the booking is still saved, but no text is sent.
- **Reminder once**, if the business switched reminders on (Setup → Business and services → Website
  booking), the set number of hours before the booking. Cancelled or moved bookings aren't reminded.

Errors: `400 missing_idempotency_key | invalid_body | invalid_mobile`, `409 slot_unavailable`
(fetch availability again and let the customer pick another time), `422` quote errors,
`503 not_ready` (online booking isn't set up for this account yet).

## curl

```bash
curl -s https://bookedsecure.com/api/public/v1/booking/options -H "Authorization: Bearer $BOOKEDSECURE_KEY"
```

```bash
curl -s "https://bookedsecure.com/api/public/v1/booking/availability?service_id=$SERVICE&size=suv&date=2026-11-16&days=7" -H "Authorization: Bearer $BOOKEDSECURE_KEY"
```

```bash
curl -s -X POST https://bookedsecure.com/api/public/v1/booking/book -H "Authorization: Bearer $BOOKEDSECURE_KEY" -H "Idempotency-Key: checkout-7f3a9c21-4e0b" -H "Content-Type: application/json" -d '{"service_id":"'$SERVICE'","size":"suv","starts_at":"2026-11-15T21:00:00.000Z","customer":{"name":"Sam Lee","mobile":"0412345678"},"sms_consent":true,"source":"Website"}'
```
