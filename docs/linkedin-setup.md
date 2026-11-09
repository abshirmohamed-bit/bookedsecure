# LinkedIn posting setup

BookedSecure posts to LinkedIn through LinkedIn's official API. Each business
connects its own LinkedIn on the **LinkedIn posts** page; BookedSecure keeps only
an encrypted access token for that business (table `linkedin_accounts`,
migration `0035_linkedin_posting`). Nothing is posted until the owner presses
**Post to LinkedIn**, or says yes to a preview from the Assistant, ChatGPT or Claude.

LinkedIn messages are not included: LinkedIn only gives messaging access to
closed partners, and the tools that work around this break LinkedIn's terms.

## 1. Create the LinkedIn app (once, for the whole platform)

1. Go to <https://www.linkedin.com/developers/apps> and choose **Create app**.
2. App name: `BookedSecure`. LinkedIn Page: the BookedSecure Company Page
   (create one first if needed). Privacy policy URL: `https://bookedsecure.com/privacy`.
   Upload the BookedSecure logo. Don't use LinkedIn's name or logo in the app.
3. On the **Settings** tab, click **Verify** next to the Company Page and have a
   Page super admin approve it.
4. On the **Products** tab, request:
   - **Sign In with LinkedIn using OpenID Connect** (instant)
   - **Share on LinkedIn** (instant)
5. On the **Auth** tab, add this authorized redirect URL exactly:
   `https://bookedsecure.com/api/public/linkedin/oauth/callback`
6. Copy the **Client ID** and **Primary Client Secret**.

## 2. Add the secrets in Lovable

In the Lovable project, add these secrets (never paste them into chat):

| Secret | Value |
|---|---|
| `LINKEDIN_CLIENT_ID` | Client ID from the Auth tab |
| `LINKEDIN_CLIENT_SECRET` | Primary Client Secret from the Auth tab |

Optional: `LINKEDIN_API_VERSION` (format `YYYYMM`, defaults to `202610`).
LinkedIn retires versions after about a year, so update it when LinkedIn warns.

Ask Lovable to apply migration `0035_linkedin_posting`, then publish.

## 3. Company Pages and comments (needs LinkedIn approval)

Posting as a Company Page needs LinkedIn's **Community Management API**.
LinkedIn vets this and only gives it to registered businesses:

- a business email address (not Gmail), legal business name, address, website and privacy policy;
- the app verified by the Company Page (step 1.3);
- first a Development tier request, then a Standard tier request with a narrated
  screen recording of: connecting LinkedIn, posting to a Page, and how comments
  and commenter details are shown.

LinkedIn may require Community Management to be the only product on an app; if
the request form says so, create a second app for it and use that app's keys.

When approved, add the secret `LINKEDIN_PAGES_ENABLED` = `true` and publish.
Owners then reconnect LinkedIn and can choose to post as their Page.

## Notes

- LinkedIn access tokens last about 60 days. The LinkedIn posts page shows
  when to renew and offers **Reconnect** in the last week.
- Posts are public text posts, up to 3,000 characters.
- ChatGPT/Claude (MCP 0.9.0) and the Assistant can write, preview and publish
  posts; publishing needs the preview's confirmation code after the owner's yes.
