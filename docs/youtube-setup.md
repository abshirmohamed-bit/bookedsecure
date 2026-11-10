# YouTube posting setup

BookedSecure uploads videos to YouTube through Google's official **YouTube Data
API v3**. Each business connects its own channel under **Social media → YouTube**.
BookedSecure keeps only an encrypted refresh token for that business (server-only
table `youtube_accounts`, `docs/youtube.sql`). Nothing is uploaded until the
owner presses **Upload to YouTube**.

## What's already built

- **Connect:** Google sign-in per business, with signed state, an owner check and
  the callback `/api/public/youtube/oauth/callback`. Asks for `youtube.upload`
  and `youtube.readonly` (to read the channel name).
- **Tokens:** the refresh token and a cached access token, AES-GCM encrypted and
  bound to the business. Disconnecting revokes the grant at Google and deletes
  the row.
- **Uploads:** resumable upload in 8 MB pieces through `/api/youtube/upload`
  (owner session plus a signed ticket). Google's token never reaches the
  browser. The limit is 2 GB per video here.
- **Composer:**
  - Title and description, with AI writing (it's tenant-aware).
  - Who can watch: Public, Unlisted or Private.
  - Made for kids (YouTube requires an answer).
  - Schedule: the video is uploaded now as private with a `publishAt`, and
    YouTube publishes it at that time.
  - Progress bar, video preview, and recent videos with links.
- **History:** recorded in `linkedin_posts` with `platform = 'youtube'`.
- **Privacy policy:** `/privacy` covers YouTube API Services, the YouTube Terms,
  the Google Privacy Policy, and how to revoke access.
- **Assistants:** none yet. Co-work, ChatGPT and Claude can't upload, because a
  video file has to be chosen in the browser (Instagram is handled the same way).

## 1. Google Cloud project (once, for the whole platform)

1. Go to <https://console.cloud.google.com/> and create a project named `BookedSecure`.
2. **APIs & Services → Library:** enable **YouTube Data API v3**.
3. **Google Auth Platform → Branding** (the OAuth consent screen):
   - App name: `BookedSecure`
   - Support email: yours
   - Logo: the BookedSecure logo
   - Home page: `https://bookedsecure.com`
   - Privacy policy: `https://bookedsecure.com/privacy`
   - Terms: `https://bookedsecure.com/terms`
   - Authorised domain: `bookedsecure.com`
4. **Audience:** choose User type **External**. While the app is in **Testing**,
   add each owner's Google email as a test user (up to 100).
5. **Data Access → Add scopes:**
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
6. **Clients → Create client:**
   - Type: **Web application**
   - Authorised redirect URI, exactly:
     `https://bookedsecure.com/api/public/youtube/oauth/callback`
   - Copy the **Client ID** and **Client secret**.

## 2. Lovable

1. Add these secrets (never paste them into chat):
   - `Google_Console_Client_ID`
   - `Google_Console_Client_Secret`
2. Ask Lovable to apply `docs/youtube.sql` as a migration exactly as written,
   then publish.

Until both steps are done, the YouTube tab explains that it's waiting, and
nothing else is affected.

## 3. Google approvals (before real customers use it)

- **Testing mode:**
  - Only listed test users can connect.
  - Google expires their access after **7 days**, so they must reconnect.
  - Uploaded videos are **locked to private**.
- **App verification:** `youtube.upload` is a *sensitive* scope.
  1. On **Audience**, press **Publish app**.
  2. Submit for verification with a short screen recording that shows:
     - the Google sign-in and consent screen;
     - uploading a video from Social media → YouTube;
     - Disconnect.
  3. Google checks the domain, the privacy policy and the branding. This
     usually takes a few days to a few weeks.
- **YouTube API Services audit:** API projects created after 28 July 2020 upload
  videos as **private only** until they pass this audit. Submit the
  **YouTube API Services – Audit and Quota Extension form**. The same form asks
  for more quota.
- **Quota:** the default is 10,000 units a day for the whole platform, and each
  upload costs about 1,600 units. That's roughly **6 uploads a day across all
  businesses** until the quota extension is approved.

## Notes

- Vertical videos up to 3 minutes become **Shorts** automatically.
- Custom thumbnails aren't included. They need a phone-verified channel; owners
  can set them in YouTube Studio.
- Editing or deleting videos happens in YouTube Studio.
