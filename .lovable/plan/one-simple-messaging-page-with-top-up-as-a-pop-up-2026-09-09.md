# One simple Messaging page, with top-up as a pop-up

Today the Messaging page stacks four blocks that repeat each other: sending status, sending setup, "Your number & credits", and "SMS number & usage". The same number, the same usage and the same provider are shown two or three times, in platform language the business owner does not need. This replaces it with one short page.

## What the owner will see

One page, three cards, nothing to hunt for:

```text
┌ Your messaging ────────────────────────────────────────────┐
│ Your number  +61 468 045 220        Sending: Active        │
│ Texts this month  672 / 1,000 included   [bar]             │
│ Credits left  0        Extra texts 8c each                 │
│ [ Top up credits ]   [ Pause sending ]                     │
└────────────────────────────────────────────────────────────┘
┌ How your texts look ───────────────────────────────────────┐
│ Signature, quiet hours start/end        [ Save ]           │
└────────────────────────────────────────────────────────────┘
  › Advanced & account            (collapsed, opens in place)
     safety caps, AI spend, retired numbers, recent top-ups,
     provider/technical details, request cancellation
```

- The top card is the whole story: number, whether texts are going out, how many of the included texts are used, credits left, and the two buttons that matter.
- Duplicated rows go: one number line instead of three, one usage line instead of three, and the technical provider/routing detail moves under "Advanced & account" where it stays available but out of the way.
- Provider choice (Simulated / Twilio / Telnyx), the assigned-business and primary/active rows, monthly caps and AI spend are all moved into the collapsed section. Nothing is deleted.
- The included-texts figure and the plan price will both come from the plan the business is actually on, so the page can't again say "$300 / month" next to "250 texts".
- Wording stays plain: "Your number", "Texts this month", "Credits left", "Pause sending". No segments, providers or caps in the visible summary.

## Top up credits as a pop-up

Choosing a credit pack currently pushes a payment form into the page and shifts everything below it. Instead:

- "Top up credits" opens a centred pop-up over the page, like the reference image: the page behind stays visible and unchanged, and the pop-up floats above it.
- The pop-up shows the three packs, then the secure payment form in place once a pack is chosen, with a back link to change pack.
- "Payments are in test mode — no real money moves." sits inside the pop-up, next to the payment form, instead of on the page.
- Closing it (X, click outside, Esc) leaves the page exactly as it was; after a successful payment the pop-up closes and the balance refreshes.
- The pop-up never blocks the rest of the site: it is dismissible at any point and scrolls internally on small screens.

## Technical notes

- Rewrite `src/routes/settings.messaging.tsx` to render three children: a new `MessagingOverviewCard`, the existing `BusinessSettingsForm` (signature + quiet hours only), and a new collapsed `MessagingAdvanced` section built from `@/components/ui/collapsible`.
- New `src/components/messaging/MessagingOverviewCard.tsx` reads the existing `getMessagingAccount` and `getSmsSetup` queries; no new server functions. `SmsSetupPanel`'s caps form, sender list and AI spend move into `MessagingAdvanced` unchanged; `ProviderStatus` and the provider `select` move there too.
- `NumberCreditsPanel` is split: summary tiles into the overview card, top-up flow into new `src/components/messaging/TopupDialog.tsx` using `@/components/ui/dialog` (Radix portal + overlay, `EmbeddedCheckoutProvider`/`EmbeddedCheckout` inside `DialogContent`, `max-h-[85vh] overflow-y-auto`), and top-up history plus the cancellation request into the advanced section. Pause/resume mutation moves to the overview card.
- In `getMessagingAccount`, take `priceMinorUnits`/`billingInterval`/`currency` from the plan row (`getPlanForBusiness`) rather than `commercial_config`, keeping `includedSegments` from the pilot snapshot so accepted pilots keep their agreed allowance. Keep the existing defensive `plan` fallback in place.
- Owner-only gating, roles, RLS, provisioning states and all messaging/consent logic are untouched — this is presentation only, plus the one price-source fix.
- Verify with `bunx tsgo`, the existing vitest suite, and a render check of `/settings/messaging`.
