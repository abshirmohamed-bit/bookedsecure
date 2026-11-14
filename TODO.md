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
17. **Lovable Publish** for Outreach (14 Nov): Lead finder, Campaigns and Inbox are now one sidebar item with shared tabs and a Found → Emailed → Replied → Booked strip. After publishing, check the strip's numbers against Lead finder's results.
18. ~~**Lovable:** apply `docs/email-theme.sql` (adds `businesses.email_theme`), then publish.~~ Applied and published 14 Nov. **You:** in Outreach → Inbox → your address → Email template: download the example, change a colour, upload it, check the preview, apply, and send yourself an email to confirm the look.

## Engine layouts 100x (14 Nov)

19. **Deploy phase 1** (cuts, people, text, activity, push-in rails; see AGENTS.md): pull the main checkout, then `fly deploy "C:\Users\Abshir\StartUp\New folder\Guardflow HQ\bookedsecure\engine" -a crayzmundo-engine --remote-only`, and check the two new models landed: `fly ssh console -a crayzmundo-engine -C "ls -la /models"`. Then re-clip "Last To Leave Mansion" and compare the same clips.
20. ~~**Phase 2 (each layout on the new signals)**~~ built 14 Nov (see AGENTS.md); **deploy it** the same way as item 19, then re-clip and compare.
21. **Phase 3 (proof):** ~~benchmark criteria for "subject in frame by body box" and "no sliced text"~~ built 14 Nov (engine/app/pipeline/checks.py, in tools/benchmark.py). **Still to do on the PC with the footage:** before/after sheets on all four footage types, and `python tools/benchmark.py <video> --scenes "…" --expect split,screen,…` with the layout each scene should get.
22. **Style review (14 Nov):** after cutting, the Engine revisits every clip and gives it the layout that suits what it shows (split screen for two people talking, screen + speaker for slides, the whole picture for wide scenes…), keeps any layout you asked for and notes clips that can't take it; Co-Work can tell you clip by clip (video_clip_styles) and switch them after your yes (apply_clip_styles); Studio shows it under the layout chips. **Deploy the Engine** (as item 19) and **Lovable Publish**, then re-clip "Last To Leave Mansion" with no layout chosen and ask Co-Work "which look did each clip get?". Clips made before this: ask Co-Work to "recheck the looks" of a video.

## Hermes plan: Co-Work and the Engine learn (14 Nov)

22. ~~**Lovable:** apply `docs/cowork-memory.sql` (Co-Work's memories, skills and review marks), then publish.~~ Applied and publishing requested 14 Nov. **You:** tell Co-Work "remember we don't detail boats", ask "what do you remember?", open the brain button beside the history, and after a longer task wait ~15 minutes for the review to mark what it learned as New.
23. ~~**Phase 2:** routines (scheduled tasks) for Co-Work, and the Engine watching a YouTube channel to clip new uploads.~~ Built 14 Nov.
23a. **Lovable:** apply `docs/cowork-routines.sql` (Co-Work routines and the channel watch), then publish. Then test: ask Co-Work "every weekday at 7am tell me today's bookings", open Routines (alarm clock beside the history) and press Run now; the report arrives in the bell within ~10 minutes. Turn on "Clip new YouTube uploads" with the rights tick; the next upload over 2 minutes appears in Studio within the hour.
24. **Phase 3:** talk to Co-Work by SMS from the owner's own number, by email, then Telegram (WhatsApp needs Meta approval).
25. **Phase 4:** the Engine learns each business's style per kind of video (recipes from kept and changed looks).
