# Two live numbers for Glocast, and a $15 number-only plan

## The short answers

- **Yes, Glocast can run both numbers at once.** Sending already picks the number per conversation: a reply to an existing thread goes out from the same number it started on, and replies coming in are matched to whichever of your numbers they arrive at. So the old number keeps handling the customers you texted in the last 24 hours while the new one takes all new enquiries.
- **One thing blocks it today:** when a new number is claimed, the code deliberately switches the old number off. That has to become "make the new number the main one, keep the old one live for existing conversations".
- **Buying the number:** you get a button on the messaging screen. It lists the real numbers the provider has for sale with their monthly price, you pick one, and the platform buys it and locks it to Glocast in one step. If the provider refuses the purchase, nothing is half-done — you see the provider's exact reply and can instead buy it yourself in their dashboard, and the platform will detect and attach it automatically.
- **The provider account needs money in it** before a purchase or a real text can go through. That part is yours.

## What changes

**1. Two numbers, one business**
- New number becomes the main sender for all new enquiries.
- The old number stays active, not main, so ongoing conversations and any incoming replies keep working exactly as they do now.
- Both numbers show on the messaging screen with which one is the main sender and which one is kept for existing conversations.
- Releasing or cancelling a number only ever touches that one number.

**2. Buy your number from the app**
- "Get your number" panel: live list of numbers for sale with monthly price, a confirm step, then purchase and lock-to-Glocast.
- Result is reported plainly: bought and attached, or refused with the provider's own reason.
- Safe to press twice — a second press never buys a second number.
- Manual fallback: a number you buy yourself in the provider dashboard is picked up by the existing sync and attached to Glocast without you typing anything.

**3. The $15 plan corrected**
- $15/month covers the dedicated number only. **No included texts at all.**
- Every text is paid from purchased credits at 3c each. At zero balance sending pauses with a clear "top up to keep sending" message; automatic top-up can keep it filled.
- The plan card and billing screen say exactly this, so there is no "1,500 included" anywhere.
- The subscription runs month to month and stays active until Glocast cancels it — no expiry, no trial end.

**4. Turning the provider on**
- Live provider operations switched on for real purchases, with the inbound and delivery webhooks pointed at the live site.
- The old provider stays switched on the whole time.

## What still needs you

- Put funds in the provider account.
- Press the real $15 payment yourself if the plan needs re-subscribing at the corrected price.

## Technical notes

- `ensurePrimarySender` gains a `keepExistingActive` mode: demote other senders (`is_primary: false`) without setting `active: false`. Default stays as-is for other tenants; Glocast's activation uses the retaining mode. `lead-engine.server.ts` already resolves sender by conversation's last sender, then `is_primary`, so thread continuity needs no change; `findSenderByNumber` already routes inbound by receiving number.
- `resolveEffectiveProviderName` keeps its simulation gate; Glocast's `businesses.default_sms_provider` moves off `telnyx` to the new number's provider only after the new sender exists, since the per-sender provider already wins.
- New server function + messaging-panel UI wrapping `listPurchasableNumbers()` and `purchaseNumberFromTexto()`, owner-gated, with an idempotency guard on "already has an assigned number" and full pass-through of the provider's status and body on failure. Audit event on purchase and on refusal.
- Migration: `plans` row `founder` → `included_segments = 0`; keep `overage_cents = 3` and the hidden `is_offered = false`. Check every reader of `included_segments` handles 0 (usage period creation, hard-cap gate, billing copy) so a zero allowance means "credits only", not "unlimited".
- Confirm no expiry/sweep job downgrades or expires a `founder` subscription; cancellation only via Stripe `cancel_at_period_end`.
- `TEXTO_ACCOUNT_PROVISIONING=live`; provider capability flags for number purchase updated to match what the live API actually accepts, verified by the first real call rather than assumed.
- Verification: typecheck, full vitest (including new tests for dual-active senders, inbound routing to the non-primary number, and zero-included-segment billing), build, then a browser pass over the messaging and billing screens.
