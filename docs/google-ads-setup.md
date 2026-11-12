# Google Ads on BookedSecure

Ad results (Work → Ad results) shows Google Ads beside Facebook: spend, impressions,
clicks, CTR and cost per click from Google, and the leads, bookings, completed jobs and
revenue they brought from BookedSecure's own records. BookedSecure only **reads** Google
Ads; it never changes campaigns.

## One-time platform setup

1. **Database**: apply `drizzle/migrations/0062_google_ads.sql` (ask Lovable).
2. **Google Cloud** (project `bookedsecure`, the same OAuth client YouTube uses):
   - APIs & Services → Library → enable **Google Ads API**.
   - OAuth consent screen → Scopes → add `https://www.googleapis.com/auth/adwords`.
   - Credentials → the web client → Authorised redirect URIs → add
     `https://bookedsecure.com/api/public/google-ads/oauth/callback`.
3. **Developer token**: in a Google Ads *manager* account, Tools → API Center. Copy the
   developer token and apply for **Basic access** (a test-only token can't read real accounts).
4. **Secrets** (Lovable project secrets):
   - `GOOGLE_ADS_DEVELOPER_TOKEN` — the token from step 3.
   - `GOOGLE_ADS_LOGIN_CUSTOMER_ID` — optional: the manager account id (digits only),
     used only for ad accounts a business's own login can't reach directly.
   - `GOOGLE_ADS_API_VERSION` — optional, defaults to `v23`. Google retires versions about a
     year after release; set the current one if Google reports the version is unsupported.
   - `Google_Console_Client_ID` / `Google_Console_Client_Secret` and
     `TENANT_AI_ENCRYPTION_SECRET` already exist for YouTube.

## Each business

The owner opens Ad results → **Connect Google Ads**, signs in with a Google user that can
see the ad account, and picks the account if there is more than one. Every business uses the
one platform developer token; nothing per business is needed in secrets. BookedSecure saves
the route to each account: directly, through a manager account the owner's login can see
(agencies: its client accounts are listed too), or through `GOOGLE_ADS_LOGIN_CUSTOMER_ID`
when that is the only way in. Figures load at once
(90 days), then refresh hourly from the follow-ups hook (the last 3 days, which Google still
adjusts). The refresh token is stored encrypted, bound to the business, in the server-only
`google_ads_accounts` table.

## How Google leads are counted

A lead is from Google Ads when the quote-page visit that became it carried a Google ad click
(`gclid`, `gbraid`/`wbraid`) or was tagged as paid Google traffic. To see leads per campaign,
add `utm_campaign={campaignid}` to the account's tracking template (Google Ads → Settings →
Account settings → Tracking → Final URL suffix: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`).
Leads without a campaign still count, under "Not from a known campaign".
