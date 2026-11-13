# Business audit: Glocast, SiteVend and GuardFlow on BookedSecure

11 November 2026. What each business needs, what BookedSecure already covers, what I built overnight, and what's next.

## At a glance

| | Glocast | SiteVend | GuardFlow |
|---|---|---|---|
| What they sell | Mobile car detailing, Sydney (consumers) | Free vending machines for workplaces, Sydney (businesses) | Workforce software for security companies, Australia (businesses, monthly plans from A$350) |
| Who enquires | Car owners | Warehouse, site, office, gym and building managers | Security company owners and operations managers |
| What a "win" is | A booked detail, then repeat visits | A site assessment, then an installed machine | A free trial or demo call, then a paid plan |
| Biggest gap today | No reviews, no prices on site, form not connected | Enquiry form not connected, long follow-up | No demo-booking path, no nurture after signup |
| BookedSecure fit | Strong (already using it) | Strong for leads and follow-up | Good for leads, LinkedIn and email; not for in-app trial tracking |

## 1. Glocast (glocast.com.au)

**Website audit**
- Built on GoDaddy. "Book Online Now" and "Free Quote" only jump to a section on the homepage. The form (name, mobile, vehicle) is a GoDaddy inquiry, not a booking, and it doesn't reach BookedSecure.
- No prices or job lengths anywhere, although BookedSecure already holds them (Full Detail $229, Ceramic $949.99, and so on).
- "Reviews" and "Blog" are empty headings. There are no reviews, no Google rating and no testimonials.
- The 15% offer has no terms. Opening hours differ between sections (7am vs 8am). The business name varies ("Glocast Detailing", "Glocast Mobile Detailing").
- Template leftovers: a "filler@godaddy.com" account email shows, the same paragraph repeats three times, and most images have no alt text.
- Local SEO is thin: one suburb page (Strathfield), no service-area list, no Google Business Profile link.

**What BookedSecure already does for Glocast**
- Quote page with AI chat and live booking, Facebook instant leads, comments and DMs, the Co-work assistant, campaigns, LinkedIn, results with Facebook ad cost per lead and booking, auto-complete jobs.
- New this week: website booking API, travel time and blocked time, Facebook and Instagram posting.

**What would help most** (research: reviews and repeat customers are the two biggest levers for mobile detailers)
1. **Reviews.** Texting a review link right after the job is the single most recommended tactic. *Built tonight.*
2. **Put booking on the website.** Replace the GoDaddy form with BookedSecure's quote chat, which shows real prices and real times. *Built tonight (copy-paste code).*
3. **Repeat visits.** Maintenance-detail reminders every 4 to 8 weeks. This already exists as "due back" reactivation; make sure Glocast's trade cycle is on.
4. **Social content on a schedule** (Instagram and Facebook before-and-after posts). *Scheduling built tonight.*
5. **Later:** a monthly maintenance plan (membership), fleet/B2B enquiries as their own service, Google Business Profile posts.

## 2. SiteVend (sitevendservices.com.au)

**Website audit**
- Clean, focused site with a clear offer ("$0 to host"), one form (name, business, mobile, site suburb, staff on site, website) and a phone number (0433 533 016). Pages for six site types (warehouses, construction, factories, offices, gyms, apartments).
- The form doesn't feed BookedSecure, so enquiries aren't followed up automatically.
- No reviews or named client logos yet. There's also no "book a site assessment" time picker, only "we'll call you back".

**How BookedSecure fits**
- **Leads:** the website form can post straight into BookedSecure through the leads API (`POST /api/public/v1/leads`, an "Add leads" key). Business name and staff numbers go into the message field. Alternatively, use the quote chat embed.
- **Follow-up:** the instant text and follow-up sequence suit SiteVend, because a facility manager rarely answers the first call.
- **Booking the site check:** the quote page can offer real assessment times. Add a "Free site assessment" service with a length (for example 30 minutes) and turn on Bookable availability.
- **Outreach:** email campaigns plus CSV import fit prospect lists of facility managers. LinkedIn posting suits B2B awareness.
- **Reviews:** after an install, the review request (built tonight) asks the site contact for a Google review.

**What would help most** (research: vending placement is won by reaching facility and operations managers and following up)
1. Connect the form: a 15-minute change on the SiteVend site, using the leads API.
2. A "Free site assessment" service plus availability, so leads can book a time.
3. A short follow-up sequence written for facility managers ("Still keen on a free machine for your team?").
4. A LinkedIn or Facebook post every week showing installs (scheduled).
5. **Later:** a "site type" question on the quote page (Warehouse, Construction, Office...), and machine or restock tracking. Machine and restock tracking is outside BookedSecure's scope.

## 3. GuardFlow (guardflow.com.au)

**Website audit**
- A strong SaaS landing page: clear pricing promise (per company, unlimited guards), App Store link, 14-day trial, FAQ and NSW SLED integration.
- **Weak points:** "Book a call" is only a mailto link, there's no demo-booking calendar and no testimonials or logos. Android is waitlist-only, but the waitlist goes through the App Store badge. There's no lead capture for people not ready to sign up.

**How BookedSecure fits**
- **Leads:** a "Book a demo" quote page (plans mode: asks about company size and needs, no street address) or the website booking API for a real demo calendar. This replaces the mailto link.
- **LinkedIn:** the main channel for B2B security owners. Posting and scheduling are in Social media.
- **Email campaigns** to security company lists (from CSV), with AI writing and one follow-up.
- **The Co-work assistant** to manage enquiries, and ChatGPT/Claude through MCP.
- **Not a fit:** tracking trial users inside the GuardFlow app (that's GuardFlow's own data). Send trial signups into BookedSecure with the leads API so they get a welcome and follow-up.

**What would help most** (research: competitors such as SecurityTime, Guardso and Tech Guarding all sell with free trials plus demos)
1. Swap the mailto "Book a call" for BookedSecure booking: a 30-minute "Demo call" service with your availability.
2. Send every signup and Android waitlist entry to BookedSecure (`POST /leads`) for automatic follow-up.
3. Two or three scheduled LinkedIn posts per week (features, SLED, "per company, not per guard").
4. An email campaign to NSW security companies, with a follow-up for anyone who didn't book.

## What I built overnight (all on `main`)

| Feature | Helps | Needs from you |
|---|---|---|
| **Ask for a review** (Automations): one text per completed job with your Google review link, after a delay you choose, only to customers who agreed to texts, never twice | All three | Turn it on and paste your review link |
| **Add to your website** (Business and services → Quote page): copy-paste code for the quote chat or a "Get a quote" button | Glocast, SiteVend | Paste into GoDaddy / the SiteVend site |
| **Schedule Facebook and Instagram posts:** pick a date and time, posts go out automatically, Cancel anytime | All three | Lovable: apply `docs/scheduled-posts.sql`, then publish |

Earlier today: Facebook and Instagram posting, one Social media page, website booking API, assistants managing availability, Approved services redesign.

## Your to-do list (morning)

1. **Lovable:** apply `docs/scheduled-posts.sql` from the repo as a migration, regenerate types, then publish.
2. **Glocast:** Automations → Ask for a review → paste the Google review link → turn on. Then paste the quote chat code into the GoDaddy site in place of the inquiry form.
3. **SiteVend and GuardFlow:** create their BookedSecure accounts. Then for each:
   - **Services:** add "Free site assessment" or "Demo call" with a length, and set availability.
   - **API key:** create an "Add leads" key and point the website forms at `POST /api/public/v1/leads`.
   - **Facebook and LinkedIn:** connect them.
4. **Delete the two test posts** on Glocast's Facebook and Instagram if you haven't yet.

### Added 13 Nov: Glocast's "one tool" plan

Done: Phase 1 (booking confirmations) and Phase 3 (social planner), both tested live.

5. **Google Ads Basic access:** Google Ads (manager account) → Tools → API Center → apply for Basic access, choose reporting only, and attach `docs/google/google-ads-api-design.pdf`. Review takes about 2–5 business days.
6. **Google Ads, after approval:** set `GOOGLE_ADS_DEVELOPER_TOKEN` in Lovable secrets, then connect Glocast's account in Ad results and check the figures against Google Ads.
7. **Competitor ads (to replace Adspirer):** decide whether to build the competitor tracker: saved Facebook pages, one-click Meta Ad Library links and notes. Meta's Ad Library API only returns Australian ads that are political or about social issues, so competitors' ordinary ads can't be pulled in automatically.
8. **TikTok scheduling:** create a TikTok developer app for BookedSecure and apply for the Content Posting API. Until TikTok audits the app, posts can only be private, for up to 5 accounts a day.
9. **Shared email inbox (to replace Outlook):** only if Glocast asks; Replies already covers campaign replies.

## Sources
- Review links and repeat customers for detailers: [Auto Detailing Marketing Guide 2026](https://www.enrichlabs.ai/blog/auto-detailing-marketing-complete-guide-2026), [Customer retention for auto detailing](https://smart-website-pro.pages.dev/customer-retention-for-auto-detailing), [Mobile detailing trends 2026](https://neardetailer.pages.dev/blog/mobile-detailing-trends-2026/)
- Vending placement decision-makers: [How to pitch prospects for vending machine placement](https://vmfsusa.com/prospects-for-vending-machine)
- Security software competitors in Australia: [SecurityTime (Trustpilot)](https://au.trustpilot.com/review/securitytime.com.au), [Guardso (Capterra AU)](https://www.capterra.com.au/software/163920/guardso), [Tech Guarding (Capterra AU)](https://www.capterra.com.au/software/1108291/Tech-Guarding)
