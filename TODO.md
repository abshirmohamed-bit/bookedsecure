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
9. ~~**Shared email inbox (to replace Outlook):**~~ Built 13 Nov as Campaigns → Inbox: each business gets `<name>@bookedsecure.com`, which already receives through Resend, so no DNS change is needed.
10. **Lovable:** apply `docs/email-inbox.sql` as a migration, regenerate types, then publish. Until then the Inbox only shows campaign replies.
11. **Inbox, first live test:** choose Glocast's address in Campaigns → Inbox. Then send it an email with an attachment from another mailbox, reply from BookedSecure, and check that the answer threads in the other mailbox. To keep one inbox, set up forwarding from info@glocast.com.au to the new address.
12. ~~**Inbox overlaps cleaned up (14 Nov):**~~ lead page emails, campaign-reply answers and reply-to defaults now use the business's address; shared branding and sender code. Check in the live test (item 11) that a lead-page email lands in Inbox → Sent.
12a. **Inbox, later:** a spam filter (Resend passes on everything it receives); Co-Work and ChatGPT tools for the inbox; rich-text writing.

## UI fixes (13 Nov)

13. ~~Home "waiting for your reply" listed people already answered or booked~~ fixed (lib/needs-reply); ~~Coming up~~ now skips deleted leads; ~~Co-Work hid the ongoing chat behind "Carry on"~~; ~~Social Post and Lead finder layouts~~ redone.
14. ~~**Lovable Publish** so production gets these and the sidebar's "Inbox" label (it still says "Replies" until published).~~ Published 14 Nov.
15. ~~Checked on phone and desktop (14 Nov): Social Post and Lead finder fit; Lead finder's selection bar now stays on one line on phones.~~ Publish again so production gets the bar fix.
16. ~~**Coming up:**~~ checked live 14 Nov: Brandon Vella and Adam Newell no longer show there; Home lists only Brandon as waiting for a reply.
