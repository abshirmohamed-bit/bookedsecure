# Bring back in-app text credit top-ups (plans stay hidden)

## Confirmed issue
Hiding the plan page also removed the only place tenants could buy text credits, connect their texting number, and set automatic top-ups. Once credits hit zero, texts stop and the only option is to contact BookedSecure.

## What will change
- Add a "Credits and number" section to the Messaging page containing the existing pieces from the old billing screen:
  - Get your texting number (provider link + "I've got my number")
  - Buy credits at the tenant's usual rate, card saved
  - Automatic top-ups (low-balance trigger + pack)
- In the Messaging overview, the "Top up credits" action opens that section again instead of only showing the contact number.
- Plan cards, prices of the $100 plan, and Plan & billing links stay hidden. Contact BookedSecure stays for account access.

## Technical details
- Extract the number step, credit purchase and auto top-up blocks from BillingPanel into a standalone component; render it in settings.messaging.
- No changes to payments, pricing, Glocast Founder rates or send checks.
- Verify as a trial tenant on desktop and phone.
