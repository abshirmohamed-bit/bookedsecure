# Lead finder setup

Lead finder (sidebar → Work → Lead finder) finds local businesses for a tenant's
outreach, the way Explee does. It needs no Google billing.

## How a search works

1. **Co-work suggests who to look for.** It reads the business profile (what the business sells, who it serves, where it works), takes the owner's own words if given, and fills the search. The owner can change anything, or type the search themselves.
2. **Find (up to 50 results):**
   - **Co-work plans the search:** web phrases, nearby suburbs, map categories and name words for this exact request. If the AI is unavailable, a built-in list of about 70 business types is used.
   - **Firecrawl web search** (the Lovable Firecrawl connector website setup already uses) runs up to 4 planned phrases, then plain phrases, then the nearby suburbs, until there are plenty. Directories, social networks, property portals and government sites are dropped.
   - **OpenStreetMap** adds named businesses two ways at once: Photon (fast, about 1 second) and Overpass (slower, has phones and websites, capped at 55 seconds). It steps out to a wider area when a suburb is thin.
   - Google Places is used too, only if `GOOGLE_PLACES_API_KEY` is ever added.
   - **Never empty if avoidable:** weak name-only matches are kept but ranked last. If everything comes back empty, a last plain search runs. A search that still finds nothing isn't counted.
3. **Read and check:** Firecrawl reads up to 20 websites per search, within a time limit (what is not read in time still shows). The AI writes the business's name, suburb, phone and a one-line summary, and judges the fit against the request (Good / Maybe / Not a fit, with a reason). Website text is treated as data, never as instructions.
4. **Email:** only addresses shown on the business's own website (home page, then its contact page) or in its map listing are kept. Businesses from the map with no website get a website lookup by name.
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
| Firecrawl | uses your existing credits: up to about 12 web searches plus up to 20 site reads and their contact pages per search |
| OpenStreetMap | free; please keep searches reasonable, as its servers are shared |

## Compliance (Australia)

The Spam Act allows emailing a business at an address it publishes, about its business, and only with an unsubscribe. The page tells owners this. Every campaign includes an unsubscribe link.

## Coverage compared with Google

OpenStreetMap has good coverage of shops, gyms, childcare, accountants and hospitality in cities, but few Australian tradies (it had no electricians listed in Parramatta when tested). Web search has to carry those. There is no Google data to compare against, so an exact percentage can't be stated.
