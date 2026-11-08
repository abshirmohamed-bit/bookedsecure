# Facebook lead import

Each business connects its own Facebook Page in BookedSecure, and BookedSecure
reads that Page's lead forms itself every five minutes. Every lead is saved
once (deduplicated by its Facebook lead id), enriched, and gets the normal
auto-reply and owner alert.

There are two parts: a one-time platform setup (BookedSecure's own Meta app),
and a per-business **Connect Facebook** step that each customer does in Settings.

## How it works

- The owner clicks **Connect Facebook** (Settings → Integrations → Facebook lead
  import). Facebook asks them to sign in and pick their Page.
- BookedSecure swaps the sign-in for a long-lived token and keeps only that
  **Page's** access token. Page tokens made this way don't expire. The token is
  encrypted (AES-256-GCM, tied to the business and Page) in the server-only
  `meta_lead_accounts` table and never reaches the browser.
- The owner can import every active form on the Page (the default, which also
  picks up new forms automatically) or choose specific forms.
- The five-minute `lead-sync` sweep imports for every business whose direct
  5-minute switch is on. Failures show on the card, and checks pause after 5 in
  a row.

## 1. One-time platform setup (BookedSecure's Meta app)

App: **bookedsecure** (`2973065043060989`) at developers.facebook.com.

1. **Use case.** *Capture & manage ad leads with Marketing API* must include
   `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads` (and `business_management`).
   These are already added.
2. **Redirect address** (done). In *Facebook Login for Business → Settings*, add this
   to **Valid OAuth Redirect URIs**:
   `https://bookedsecure.com/api/public/meta/oauth/callback`
3. **Login configuration.** *Facebook Login for Business → Configurations* has
   **BookedSecure lead import** (Configuration ID `1107768802024784`): General
   login, **User access token**, and every permission the app offers
   (`leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads`, `pages_messaging`,
   `business_management`, `ads_read`, `ads_management`). The extra ones are
   there for future features. Each connecting business approves all of them, and
   App Review will ask what each one is used for.
4. **Lovable Cloud → Secrets:**

   | Name | Value |
   | --- | --- |
   | `META_APP_ID` | `2973065043060989` |
   | `META_APP_SECRET` | App settings → Basic → App secret (keep private) |
   | `META_LOGIN_CONFIG_ID` | `1107768802024784` |
   | `META_GRAPH_VERSION` | optional; defaults to `v27.0` |

   Tokens are encrypted with the existing `TENANT_AI_ENCRYPTION_SECRET`.

### Opening it to every customer (Meta's rules)

While the app is unpublished, only people with a role on the app (admins,
developers, testers) can connect. That's enough for Glocast today, because the
person connecting is an app admin. To let any customer connect, Meta requires:

- **Business verification** of BookedSecure's business portfolio.
- **App Review** for Advanced Access to the permissions above, usually with a
  screen recording of the Connect Facebook flow and lead import.
- Then **publishing** the app (switching it to Live).

Until then, a new customer can be added under *App roles → Testers* so they can
connect.

5. **Instant leads webhook.** In the app's *Webhooks* product, choose the
   **Page** object, set the callback URL to
   `https://bookedsecure.com/api/public/meta/webhook` and the verify token to
   `bookedsecure-leadgen-v1` (not a secret; override with
   `META_WEBHOOK_VERIFY_TOKEN`), then subscribe to the **leadgen** field. Every
   delivery is checked against the app secret's signature. Each connected Page
   is subscribed automatically (or with **Turn on instant leads**), so Facebook
   tells BookedSecure about a lead the moment it's submitted. Instant imports
   never move the five-minute check's starting point, so that check still catches
   anything a webhook misses.

## 2. Per business: connect Facebook

In BookedSecure: **Settings → Integrations → Facebook lead import →
Facebook lead import**.

1. Click **Connect Facebook**, sign in, and tick the business Page (and allow
   lead access). If several Pages were shared, pick the one with the lead forms.
2. Optional: **Choose forms**. Leave it on *All active forms* unless only some
   forms should be imported.
3. Click **Test Facebook access**, then **Import new leads now**. The first run
   looks back over the chosen window (7 days by default). Its result appears in
   the import history.
4. Turn on **Check for new leads every 5 minutes**.

If the Page uses **Leads Access** (Meta Business Suite → Business settings →
Integrations → Leads Access), make sure BookedSecure is allowed for that Page.

## Ad attribution and cost per job

- Every imported lead records the campaign, ad set and ad it came from
  (`source_campaign` plus `source_metadata.ad`).
- Connect Facebook also keeps the person's long-lived user token (about 60 days),
  encrypted in server-only `meta_ad_accounts`, because a Page token can't read ad
  spend. The ad account running the lead campaigns is picked automatically (the
  owner can change it).
- The five-minute sweep refreshes campaign spend about hourly into
  `meta_ad_spend_daily` (90 days the first time, then the last 3 days).
- Home → Operational details shows spend, leads, bookings, completed jobs,
  revenue, cost per lead/booking/job and return per campaign (7/30/90 days).
- Businesses connected before this need to click **Reconnect / change Page**
  once. When the token nears expiry the report asks for a reconnect.

## Facebook & Instagram comments and DMs

- Permissions (in the login configuration): `pages_read_user_content`,
  `pages_manage_engagement` (Facebook comments), `pages_messaging` + Human Agent
  (Messenger), `instagram_basic`, `instagram_manage_comments`,
  `instagram_manage_messages` (Instagram). Businesses connected before these were
  added must **Reconnect / change Page** once.
- Webhooks: Page fields `leadgen`, `feed`, `messages`; Instagram fields
  `comments`, `messages`. While the app is unpublished Meta delivers no live
  webhooks, so the five-minute sweep fetches new comments and DMs (and **Check
  now** on the page fetches immediately).
- Nothing is posted or sent without the owner approving it on the Facebook &
  Instagram page. DM replies follow Meta's rules: free within 24 hours of the
  customer's last message, a personal (Human Agent) reply up to 7 days, then closed.
- Migration `0026_social_messages` creates `social_messages` and
  `meta_social_state` (server-only).

## When something goes wrong

- *The Facebook connection has expired or was revoked*: this happens after a
  Facebook password change, removing the app, or losing admin on the Page. Click
  **Reconnect / change Page**.
- *Facebook refused access*: lead access wasn't granted for that Page, or Leads
  Access blocks BookedSecure. Reconnect and allow lead access.
- *A selected lead form is no longer on the connected Page*: update **Choose forms**.
- After 5 failures in a row, automatic checks pause. Fix the cause, then switch
  the 5-minute check off and on again.

## Limits

- One Facebook Page per business.
- Each check runs inside the five-minute cron request. A very large first
  import could be cut short; the next check retries the same window and skips
  leads already saved.
