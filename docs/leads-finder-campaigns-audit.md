# Leads, Lead finder and Campaigns: how they work together

11 November 2026. The question: how do the three tabs get a tenant from "I need more work" to booked jobs, and where did they not connect?

## The tenant's goal

More booked jobs from two pools:

- **New businesses** (B2B), found with Lead finder: SiteVend (warehouses, gyms), GuardFlow (security companies), cleaners (offices, strata).
- **People who already know them**: enquiries, past customers, lost leads, imported lists.

## Routes

### 1. Lead finder → Campaigns → Leads (new business)

1. **Lead finder:**
   - **Ask Co-work:** Co-work suggests who to look for from the business profile, or fills the search from the owner's words.
   - **Find:** web search and OpenStreetMap find businesses. Each website is read and fit-checked, and the email it publishes is kept and checked.
   - **Add to customers:** creates leads tagged Lead finder. Nothing is sent.
2. **Campaigns:**
   - **Open:** "Email them" (in the add toast) or "Email the businesses you added" opens a new campaign with the audience **Businesses from Lead finder**.
   - **Write:** AI writes the email from the business facts.
   - **Send:** after the preview and a yes, with an optional follow-up to anyone who hasn't booked.
3. **Reply:**
   - **Owner:** gets a copy by email, and the thread appears in Campaigns → Replies.
   - **Leads:** the lead moves to **Replied**. *(new)*
4. **Leads:**
   - **Filter:** Replied or Source "Lead finder", to see who answered.
   - **Lead page:** shows the campaign emails they got and links to their reply *(new)*.
   - **Next steps:** the owner quotes, books or texts as usual.
5. **Back in Lead finder:** each added business shows **Added → Emailed → Replied → Booked** and links to its lead *(new)*.

### 2. Leads → Campaigns (people who already know you)

- **Pick people:** select leads in the Leads list (filter by status or source first), then press **Email selected** *(new)*. A campaign opens with exactly those people; anyone without an email is left out, with a note.
- **Quick audiences:** Open enquiries, Quoted not booked, Booked, Past customers and Lost leads in the campaign composer. Each is already filtered by status.
- **One person:** "Send an email" on the lead page, now with that person's campaign history above it *(new)*.

### 3. Campaigns → Leads

- **People tab:** each recipient links to their lead.
- **Replies:** each thread has "Open customer".
- **Bookings:** a booking within 30 days of an email counts in the campaign's results. The lead's status moves to Booked through the normal booking flow.

### 4. Other routes worth using

- **Lead finder → Leads → SMS:** OpenStreetMap results often have a phone but no email. Add those to customers manually and text them only if you have their permission (SMS needs consent, unlike B2B email).
- **Co-work in chat:** "find warehouses near Auburn for SiteVend and add the good ones" runs `suggest_lead_searches` → `find_businesses` → `add_found_businesses_to_customers`. Then "draft a campaign for the Lead finder businesses" uses the `lead_finder` audience. It still needs the preview and the owner's yes to send.
- **Campaigns → Social:** what works in an email (a before-and-after, an offer) can be posted to Facebook, Instagram or LinkedIn from Social media.

## What was broken and is now fixed

| Gap | Before | Now |
|---|---|---|
| Lead finder businesses in Leads | Shown as "Past customers", labelled "CRM CSV", source "Unknown" | Labelled **Lead finder**; Source filter "Lead finder (businesses you found)" |
| Leads → Campaigns | Selecting leads only offered Delete | **Email selected** opens a campaign with those people |
| Lead finder → Campaigns | Plain link to Campaigns; you had to find the audience | Opens a new campaign with the Lead finder audience already chosen |
| Campaign replies | Saved and forwarded, but the lead didn't change | Lead moves to **Replied**, the same as an SMS reply |
| Lead page | No record of campaign emails | **Campaign emails** list with dates, follow-ups and reply links |
| Lead finder after adding | Only "Added" | Shows **Emailed / Replied / Booked** and links to the lead |
| Wrong question sets | Fixed industry rules | The website AI decides the quote steps (done earlier today) |

## Still worth doing (not built)

1. **Results for outreach campaigns:** show replies next to bookings in campaign results, since for cold outreach a reply is the win.
2. **Prospect status:** a dedicated "Prospect" status instead of reusing "Past customers" (previous_lead) for Lead finder businesses. This needs a database change.
3. **Lookalikes:** "find businesses like this customer", starting a Lead finder search from a won B2B customer's type and suburb.
4. **MCP (ChatGPT and Claude):** expose the Lead finder tools too. They're Co-work only for now.
5. **Lead finder credits:** charge for searches beyond the 20 free per month, the way SMS credits work.

## Testing status

- **Automated:** 2,314 tests pass, plus type-check and lint.
- **Live, OpenStreetMap:** around Auburn, 37 SiteVend-type sites; gyms in Parramatta, 29. The free servers are sometimes overloaded, so results vary.
- **Not yet live:** Firecrawl web search, Co-work suggestions and these joining-up fixes need the published app and `docs/lead-finder.sql` applied.
