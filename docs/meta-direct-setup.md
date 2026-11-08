# Direct Facebook lead import (replacing Make)

BookedSecure can read Glocast's Facebook lead form itself every five minutes,
instead of asking the Make scenario to do it. It is the same job the Make
blueprint does (list the form's leads since the last checkpoint, fetch their
answers, hand them to the importer). Leads go through exactly the same
pipeline, so dedupe, enrichment, auto-replies and owner alerts are unchanged,
and a lead Make already imported is never created or texted twice.

What it needs is one server secret: a Facebook **Page access token** for the
Glocast Page with permission to read leads.

## 1. Create a Page access token that does not expire

You must be an admin of the Glocast Facebook Page and of a Meta developer app.

1. Go to <https://developers.facebook.com/apps> and open (or create) an app of
   type **Business**. You can keep it in Development mode: you are an admin of
   both the app and the Page, so no App Review is needed for your own Page.
2. Open the **Graph API Explorer** (<https://developers.facebook.com/tools/explorer>).
   Choose your app, then **Get Token → Get User Access Token** and tick:
   `leads_retrieval`, `pages_show_list`, `pages_read_engagement`,
   `pages_manage_metadata`, `pages_manage_ads`. Approve the pop-up, making
   sure the Glocast Page is selected.
3. Copy the token into the **Access Token Debugger**
   (<https://developers.facebook.com/tools/debug/accesstoken>), click
   **Debug**, then **Extend Access Token** at the bottom. Copy the long-lived
   token it gives you.
4. Back in the Graph API Explorer, paste the long-lived token into the token
   box and run `GET me/accounts`. Find the entry with id `383114254879346`
   (Glocast Mobile Auto Detailing) and copy its `access_token`. That is the
   Page token.
5. Check it in the Access Token Debugger: **Type** should be *Page* and
   **Expires** should be *Never*.

If the Page uses **Leads Access** (Meta Business Suite → Business settings →
Integrations → Leads Access), make sure your app, or you, is allowed for the
Glocast Page. Otherwise Facebook refuses the read even with a valid token.

Keep the token private: don't paste it into chats, email or code.

## 2. Add the secret in Lovable

In Lovable, open **Cloud → Secrets** and add:

| Name | Value |
| --- | --- |
| `META_DIRECT_GLOCAST_ACCESS_TOKEN` | the Page token from step 1.4 |
| `META_DIRECT_GRAPH_VERSION` | optional, e.g. `v23.0` (that is the default) |

## 3. Switch over

In BookedSecure: **Settings → Integrations → Facebook lead import →
Direct from Facebook (no Make)**.

1. Click **Test Facebook access**. It does one read-only check and saves nothing.
2. Click **Import now (direct)**. The first direct run continues from where
   Make left off, so normally it brings in nothing new or just the latest few.
   Its result appears in the import history labelled *Direct*.
3. Turn on **Check for new leads every 5 minutes (direct)**. When asked, choose
   **OK** to also switch off Make's automatic checks.
4. Once you have seen a few successful direct imports, turn the scenario
   **OFF in Make** so it can no longer use any credits.

To go back, turn the direct switch off and Make's switch back on (and the
scenario back ON in Make).

## When something goes wrong

The error is shown on the card, and in each run in the import history.

- *Access token has expired or was revoked*: this happens if you change your
  Facebook password, remove the app, or lose admin on the Page. Repeat step 1
  and update the secret.
- *Facebook refused access*: the token is missing `leads_retrieval`, or Leads
  Access is blocking the app.
- After 5 failures in a row, automatic checks pause. Fix the cause, then switch
  the 5-minute check off and on again to resume.

## Limits today

- Only the Glocast business and its approved form (`38813647781617096`) can use
  direct import; the token is bound to them in `src/lib/meta-direct.server.ts`.
  Opening it to other businesses needs per-business token storage and a Page
  and form picker.
- Each check runs inside the five-minute cron request. That's fine for normal
  volumes; a very large first import could be cut short, in which case the next
  check retries the same window and skips leads already saved.
