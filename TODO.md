# BookedSecure to-do list

What's still open, newest plans last. Tick items off here (`~~strike~~` or delete them) as they're done, and add new ones at the bottom of their section.

## From the November business audit (Glocast, SiteVend, GuardFlow)

Background: [docs/business-audit-2026-11.md](docs/business-audit-2026-11.md).

1. **Lovable:** apply `docs/scheduled-posts.sql` from the repo as a migration, regenerate types, then publish.
2. **Glocast:** Automations → Ask for a review → paste the Google review link → turn on. Then paste the quote chat code into the GoDaddy site in place of the inquiry form.
3. **SiteVend and GuardFlow:** create their BookedSecure accounts. Then for each:
   - **Services:** add "Free site assessment" or "Demo call" with a length, and set availability.
   - **API key:** create an "Add leads" key and point the website forms at `POST /api/public/v1/leads`.
   - **Facebook and LinkedIn:** connect them.
4. **Delete the two test posts** on Glocast's Facebook and Instagram if you haven't yet.

## Glocast's "one tool" plan (added 13 Nov)

Done: Phase 1 (booking confirmations) and Phase 3 (social planner), both tested live.

5. **Google Ads Basic access:** Google Ads (manager account) → Tools → API Center → apply for Basic access, choose reporting only, and attach `docs/google/google-ads-api-design.pdf`. Review takes about 2–5 business days.
6. **Google Ads, after approval:** set `GOOGLE_ADS_DEVELOPER_TOKEN` in Lovable secrets, then connect Glocast's account in Ad results and check the figures against Google Ads.
7. **Competitor ads (to replace Adspirer):** decide whether to build the competitor tracker: saved Facebook pages, one-click Meta Ad Library links and notes. Meta's Ad Library API only returns Australian ads that are political or about social issues, so competitors' ordinary ads can't be pulled in automatically.
8. **TikTok scheduling:** create a TikTok developer app for BookedSecure and apply for the Content Posting API. Until TikTok audits the app, posts can only be private, for up to 5 accounts a day.
9. **Shared email inbox (to replace Outlook):** only if Glocast asks; Replies already covers campaign replies.
