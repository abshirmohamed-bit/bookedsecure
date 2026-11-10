# Lead finder setup

Lead finder (sidebar → Work → Lead finder) finds local businesses for a tenant's
outreach, the way Explee does, using services BookedSecure already has:

1. **Find:** Google Places API (New) text search, for example "cleaning companies in Parramatta NSW", up to 20 results.
2. **Read and check:** the existing Firecrawl connector reads each business's own website. The AI reader writes a one-line summary and judges the fit against the owner's request (Good / Maybe / Not a fit, with a reason). Website text is treated as data, never as instructions.
3. **Email:** only addresses shown on that business's own website are kept.
   - **ZeroBounce:** emails are checked with ZeroBounce when `ZEROBOUNCE_API_KEY` is set.
   - **Without ZeroBounce:** BookedSecure checks that the domain accepts mail (MX lookup). Addresses that would bounce are dropped.
4. **Reach:** **Add to customers** creates leads (no message is sent) tagged "Lead finder". The campaign audience **Businesses from Lead finder** reaches only them, and they are never mixed into customer audiences. Campaigns already include unsubscribe and an optional follow-up.

Limits: 20 searches per business per month (`LEAD_FINDER_MONTHLY_SEARCHES`).

## Setup

1. **Google Cloud** (project `bookedsecure`):
   - Enable **Places API (New)**.
   - Create an API key restricted to Places API (New).
2. **Lovable secrets:**
   - `GOOGLE_PLACES_API_KEY` (required)
   - `ZEROBOUNCE_API_KEY` (optional, for full email checks)
   - `FIRECRAWL_API_KEY` is already set for website setup.
3. **Lovable:** apply `docs/lead-finder.sql` as a migration exactly as written, then publish.

## Costs (approximate)

| Service | Cost |
|---|---|
| Google Places Text Search | about US$32 per 1,000 searches; each search returns up to 20 businesses |
| Firecrawl | one scrape per business website |
| ZeroBounce | about US$0.008 per email checked |

## Compliance (Australia)

The Spam Act allows emailing a business at an address it publishes, about its business, and only with an unsubscribe. The page tells owners this. Every campaign includes an unsubscribe link.
