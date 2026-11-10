# Lead finder setup

Lead finder (sidebar → Work → Lead finder) finds local businesses for a tenant's
outreach, the way Explee does. It needs no Google billing.

## How a search works

1. **Co-work suggests who to look for.** It reads the business profile (what the business sells, who it serves, where it works), takes the owner's own words if given, and fills the search. The owner can change anything, or type the search themselves.
2. **Find:**
   - **Firecrawl web search** (the Lovable Firecrawl connector website setup already uses) finds business websites. Directories, social networks and government sites are dropped.
   - **OpenStreetMap** (free) adds named businesses in the area, matched by category (gyms are filed as "fitness centres") and by name.
   - Google Places is used too, only if `GOOGLE_PLACES_API_KEY` is ever added. It's optional.
3. **Read and check:** Firecrawl reads up to 12 websites per search. The AI writes the business's name, suburb, phone and a one-line summary, and judges the fit against the request (Good / Maybe / Not a fit, with a reason). Website text is treated as data, never as instructions.
4. **Email:** only addresses shown on the business's own website are kept.
   - **ZeroBounce:** emails are checked with ZeroBounce when `ZEROBOUNCE_API_KEY` is set (optional).
   - **Without ZeroBounce:** BookedSecure checks that the domain accepts mail (MX lookup).
5. **Reach:** **Add to customers** creates leads (nothing is sent) tagged "Lead finder". The campaign audience **Businesses from Lead finder** reaches only them, and they are never mixed into customer audiences.

The Co-work assistant can do the same in chat:
- `suggest_lead_searches`
- `find_businesses`
- `lead_finder_results`
- `add_found_businesses_to_customers`

Sending still needs the campaign preview and the owner's yes.

Limit: 20 searches per business per month (`LEAD_FINDER_MONTHLY_SEARCHES`).

## Setup

1. **Lovable:** apply `docs/lead-finder.sql` as a migration exactly as written, then publish. Nothing else is required: `FIRECRAWL_API_KEY` and `LOVABLE_API_KEY` are already set.
2. **Optional:**
   - `ZEROBOUNCE_API_KEY` for full email checks (about US$0.008 per email; 100 free a month).
   - `GOOGLE_PLACES_API_KEY` for Google Maps listings (needs Google billing).

## Costs

| Service | Cost |
|---|---|
| Firecrawl | uses your existing credits: one web search plus up to 12 page reads per search |
| OpenStreetMap | free; please keep searches reasonable, as its servers are shared |

## Compliance (Australia)

The Spam Act allows emailing a business at an address it publishes, about its business, and only with an unsubscribe. The page tells owners this. Every campaign includes an unsubscribe link.
