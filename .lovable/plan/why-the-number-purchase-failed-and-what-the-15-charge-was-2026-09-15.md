# Why the number purchase failed — and what the $15 charge was

## The $15 on your bank statement is correct and expected

That charge is the real Founder subscription you chose to pay from the front end. Our records show Glocast is back on the Founder plan, active, paid, next renewal 15 Oct 2026. Nothing was charged twice, and no money was taken for the phone number itself — the number attempt happened after the payment and failed, so there is nothing to refund.

## Why the number could not be claimed

The provider accepted our request to *list* numbers for sale (that is why you saw twelve numbers at $15/month), but rejected our request to *buy* one with "Not found" plus a list of the routes it supports — and the buy route is in that list. So the address is right; the provider's buy handler is refusing this particular request. The likely causes, in order:

1. The buy request expects a different shape than we send (we send one number as `number`; their assign/recall calls take a list, and their listing may return numbers that must be bought by group rather than individually).
2. The numbers in the for-sale list are not actually purchasable on our account (already taken, or reserved to another group), and their handler reports that as "Not found".
3. The buy route is enabled only for accounts with number purchasing switched on — the same restriction we already hit on sub-accounts.

No money was involved in that failed attempt.

## What I'll do

1. Capture the exact request and reply for a buy attempt (address, body, headers minus secrets, full response) into the private audit log, so we stop guessing.
2. Retry the buy through the small set of shapes the provider's own documented calls use — single number, list of numbers, and the group form the listing returns — and stop at the first that succeeds. Each attempt is recorded; a rejection costs nothing.
3. Cross-check the listing against the numbers the provider says our account holds, so we only ever try to buy numbers that are genuinely for sale to us.
4. If every shape is still refused, report the verbatim reply to you and to the provider's support, and switch to the fallback: you buy the number inside the provider's own portal, then paste it into "Already bought a number yourself?" — it gets connected to Glocast without a second purchase.
5. Confirm the monthly number cost is booked privately once a number is actually held (right now it is recorded at $0 because Glocast holds no number yet).

Throughout this, Glocast keeps sending and receiving on the existing number; nothing about the current messaging setup changes.

## Technical notes

- `purchaseNumberFromTexto` posts `{ number }` to `/numbers/purchase`; the 404 body is the provider's catch-all route list, which means the router did not match the request rather than that the path is wrong. Add request/response capture in `textoRequest` for number routes (redacting `Authorization`) and audit via the existing `texto_number_purchase_failed` event.
- Try in order: `{ number }`, `{ numbers: [number] }`, `{ msisdn: number }`, and the `group`-scoped variant derived from the `/numbers/available` entry; short-circuit on the first 2xx. Cache nothing on failure.
- Reconcile `/numbers/available` against `GET /numbers` before offering a number in `DedicatedNumberPanel`.
- Manual fallback already exists via `claimNumberForBusiness({ alreadyPurchased: true })`.
- `provider_costs` shows `number_rental` at `0` for invoice `in_1UFu5ZAEzSAu4BpUj8iDO4cJ` because `holdsDedicatedNumber` is false; it books $15 once a number is assigned.
