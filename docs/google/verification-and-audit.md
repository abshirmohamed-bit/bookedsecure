# Google verification and YouTube API audit: ready-to-paste answers

- **Google Cloud project:** `bookedsecure`, app name BookedSecure.
- **Status:** In production, unverified.
- **Owner contact:** bookedsecure@gmail.com.

Until verification passes:
- **Warning screen:** owners see "Google hasn't verified this app" and must click **Advanced → Go to bookedsecure.com**.
- **User cap:** a lifetime limit of 100 users.
- **Private uploads:** videos upload as private until the YouTube audit (step 4) passes.

## Order of steps

1. **Domain ownership.** In Lovable Domains, add the Search Console TXT record for `bookedsecure.com`, then press **Verify** in Search Console. Use the same Google account that owns the Cloud project.
2. **Logo.** Under Google Auth Platform → Branding → App logo, upload `docs/google/bookedsecure-logo-120.png` and save.
3. **Verification.** Go to Verification Center → **Prepare for verification**, then submit with the answers below and the demo video.
4. **YouTube audit.** Submit the YouTube API Services Audit and Quota Extension form (link below) with the answers in the last section. This lifts the private-only lock and raises the daily quota.

## Scopes and why each one is needed

Paste one justification per scope.

**`https://www.googleapis.com/auth/youtube.upload`**
> BookedSecure is software for small service businesses (for example car detailers and cleaners). The business owner chooses a video in BookedSecure (Social media → YouTube → Upload), enters the title, description and privacy, and presses "Upload to YouTube". We use this scope only to upload that one video to the owner's own channel, through a resumable videos.insert upload, optionally with a scheduled publishAt time. We never upload anything the owner didn't choose and approve.

**`https://www.googleapis.com/auth/youtube.readonly`**
> We read the connected channel's name, picture and statistics (subscribers, views, video count) and the owner's latest uploads (title, duration, views, likes and comments). This lets the owner see their channel inside BookedSecure (Social media → YouTube → Insights) and confirm where videos will be uploaded. The data is shown only to that business's own team and isn't shared or sold.

**`https://www.googleapis.com/auth/youtube.force-ssl`**
> This lets the owner read comments on their own videos and reply to them from BookedSecure (Social media → YouTube → Comments). We list comment threads on the owner's channel, and post a reply only when the owner writes or approves it and presses "Post reply". We don't edit or delete videos, comments, ratings or captions. The YouTube Data API needs this scope to insert comment replies.

**`https://www.googleapis.com/auth/yt-analytics.readonly`**
> We read the last 28 days of the owner's own channel analytics (views per day, estimated watch time, subscribers gained and lost, and average view duration). We show them on Social media → YouTube → Insights, so a small business can see whether its videos bring in customers. It's read-only and shown only to that business.

**How the data is protected (for every scope):**
> Each business connects its own Google account. The refresh token is encrypted with AES-256-GCM, bound to that business, and stored in a server-only table that no browser role can read. Tokens never reach the browser: uploads go through our server with a short-lived signed ticket. Owners can disconnect at any time, which revokes the grant at Google and deletes the stored token. Our privacy policy (https://bookedsecure.com/privacy) and terms (https://bookedsecure.com/terms) describe the use of YouTube API Services and link to the YouTube Terms of Service and the Google Privacy Policy.

## Demo video

Record the screen, about 2 to 3 minutes. Upload it to YouTube as **Unlisted** and paste the link into the form.

1. Show bookedsecure.com, then sign in to BookedSecure.
2. Open **Social media → YouTube**, press **Connect YouTube**, and show the Google consent screen with the app name and the requested permissions. The browser's address bar must show the `client_id`, which Google requires.
3. After returning to BookedSecure, show "Uploading to" with your channel name.
4. **Upload:** choose a short video, use **Write it** (AI title and description), pick Public or Unlisted, press **Upload to YouTube**, wait for 100%, then open the video on YouTube.
5. **Insights:** show the stats, Latest uploads (Long-form/Short-form filter) and **Suggest titles**.
6. **Comments:** show a comment, press **Suggest a reply**, edit it, press **Post reply**, then show the reply on YouTube.
7. **Disconnect:** press **Disconnect** and show that the connection is gone.

Narrate or add captions in English saying what each step does and which scope it uses.

## YouTube API Services: Audit and Quota Extension form

Form: https://support.google.com/youtube/contact/yt_api_form

Answers:

- **Organisation:** BookedSecure (Australia), https://bookedsecure.com
- **Contact email:** bookedsecure@gmail.com
- **Google Cloud project ID:** `bookedsecure`
- **Project number:** shown on the project dashboard in Google Cloud.
- **API client type:** Web application (server-side), multi-tenant SaaS.
- **Who uses it:** Owners of small service businesses (detailing, cleaning, trades, security, vending) who connect their own YouTube channel.
- **What it does:**
  > Business owners upload their own videos (with an AI-assisted title and description, privacy and optional scheduled publish time), see their own channel statistics and 28-day analytics, get title ideas for their own long-form videos, and read and reply to comments on their own videos. Every write action (upload, reply) is started by the owner pressing a button. Nothing is posted automatically.
- **APIs used:**
  - YouTube Data API v3: `videos.insert` (resumable), `channels.list` (mine), `playlistItems.list` (own uploads), `videos.list` (own videos), `commentThreads.list` (allThreadsRelatedToChannelId = own channel), `comments.insert` (reply).
  - YouTube Analytics API: `reports.query` (`channel==MINE`).
- **Data storage:**
  - **Tokens:** encrypted per business.
  - **Uploads:** title, privacy, video ID and link are stored as the business's own post history.
  - **Stats and comments:** fetched live when the owner opens the page and not stored.
  - **Refresh:** nothing is refreshed or stored for longer than YouTube's policies allow.
- **Quota requested:** 100,000 units/day. Reason:
  > Each upload uses about 1,600 units; we expect up to about 50 uploads per day across all businesses, plus small reads for stats and comments.
- **Screenshots and links:**
  - The demo video above.
  - https://bookedsecure.com/privacy
  - https://bookedsecure.com/terms
