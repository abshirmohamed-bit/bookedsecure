# Direct Facebook lead import (replacing Make)

Each business connects its own Facebook Page in BookedSecure, and BookedSecure
reads that Page's lead forms itself every five minutes, instead of a Make
scenario doing it (Make charges credits for every run). Leads go through the
same pipeline as Make imports, so dedupe, enrichment, auto-replies and owner
alerts are unchanged, and a lead Make already imported is never created or
texted twice.

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
2. **Redirect address.** In *Facebook Login for Business → Settings*, add this
   to **Valid OAuth Redirect URIs**:
   `https://bookedsecure.com/api/public/meta/oauth/callback`
3. **Login configuration (recommended).** In *Facebook Login for Business →
   Configurations*, create one with token type **User access token** and the
   permissions above. Copy its **Configuration ID**.
4. **Lovable Cloud → Secrets:**

   | Name | Value |
   | --- | --- |
   | `META_APP_ID` | `2973065043060989` |
   | `META_APP_SECRET` | App settings → Basic → App secret (keep private) |
   | `META_LOGIN_CONFIG_ID` | the Configuration ID from step 3 |
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

## 2. Per business: connect Facebook

In BookedSecure: **Settings → Integrations → Facebook lead import →
Direct from Facebook (no Make)**.

1. Click **Connect Facebook**, sign in, and tick the business Page (and allow
   lead access). If several Pages were shared, pick the one with the lead forms.
2. Optional: **Choose forms**. Leave it on *All active forms* unless only some
   forms should be imported.
3. Click **Test Facebook access**, then **Import now (direct)**. The first direct
   run continues from where Make left off. Its result appears in the import
   history labelled *Direct*.
4. Turn on **Check for new leads every 5 minutes (direct)**, and choose **OK** to
   also switch off Make's automatic checks.
5. After a few good direct imports, turn the scenario **OFF in Make**.

If the Page uses **Leads Access** (Meta Business Suite → Business settings →
Integrations → Leads Access), make sure BookedSecure is allowed for that Page.

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
