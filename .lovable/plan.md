# Hide self-service subscription plans

## What will change
- Remove Pricing links and the plan-focused benefits section from the public landing page.
- Replace the public Pricing page with a simple contact invitation instead of plan cards, prices, or self-service signup.
- Remove Plan & billing from signed-in navigation and account menus.
- Remove subscription banners and upgrade links that send tenants into self-service billing.
- Keep subscription access checks working behind the scenes; this only removes self-service plan purchasing and management.
- Point tenants who need access to a clear BookedSecure contact option.

## Technical details
- Preserve existing subscription records, trials, payment handling, SMS number setup, credits, and owner reporting.
- Leave the billing route available as a contact-only fallback so old bookmarks do not break.
- Update nearby messaging and setup wording so hidden billing links are not exposed.
- Verify the landing page and signed-in workspace on desktop and mobile, then check the current build status.
