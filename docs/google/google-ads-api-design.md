# BookedSecure — Google Ads API design document

Supporting the Google Ads API Basic access application.

## Company and tool

- **Company:** BookedSecure (https://bookedsecure.com), Australia.
- **Tool:** BookedSecure, a web app for Australian service businesses (detailers, cleaners, trades). It handles enquiries, quotes, bookings, follow-up texts and email, and reporting.
- **Who uses the API:** our customers, the owners of those businesses. Each owner connects their own Google Ads account. We don't run ads for anyone and don't manage campaigns.
- **API use:** reporting only, read-only. The tool never creates, changes, pauses or deletes anything in Google Ads.

## What the tool does with the API

The **Ad results** page shows Google Ads beside Facebook ads for one business: spend, impressions, clicks, CTR and cost per click from Google Ads. BookedSecure then joins those figures to its own records: the enquiries the ads brought (through `gclid`, `gbraid` and `wbraid` on the business's quote page), the bookings made, the jobs completed and the revenue. The owner sees cost per lead, cost per booking and return per campaign.

## Sign-in and account access

1. The owner presses **Connect Google Ads** and signs in with Google OAuth 2.0 (scope `https://www.googleapis.com/auth/adwords`). The OAuth state is signed and bound to the business and user.
2. `customers:listAccessibleCustomers` lists the accounts that login can reach. For a manager account, a `customer_client` query (level 1) lists its client accounts. The owner picks the account.
3. The refresh token is encrypted with AES-GCM, bound to that business, and stored in a server-only table that no browser or other business can read. **Disconnect** deletes it.

## API calls

All calls are `googleAds:search`, read-only:

| Purpose | Query |
|---|---|
| Account name and currency | `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1` |
| Client accounts under a manager | `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager FROM customer_client WHERE customer_client.level = 1` |
| Daily campaign figures | `SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN … ` |

**Volume:** each connected account loads 90 days once on connect. After that, a background job refreshes the last 3 days once an hour, the days Google can still adjust. That is about 24–30 requests per account per day, far below the Basic access limit of 15,000 operations a day.

## Data handling

- **What's stored:** only campaign id, campaign name, date, cost, clicks, impressions and conversions, per business, in a server-only table.
- **Who sees it:** only that business's own users.
- **Third parties:** no Google Ads data is sold, shared or used to train models.
- **Retention:** figures older than the reporting window are not refreshed.
- **On disconnect:** the token is deleted.

## Screens

- Ad results with Google Ads beside Facebook (campaign table, totals, cost per lead and booking).
- The Connect Google Ads button and the account chooser.

## Contacts

- **API contact:** the BookedSecure owner account's email, as set in the API Center.
- **Website:** https://bookedsecure.com
