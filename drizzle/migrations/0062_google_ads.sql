-- Ad results: Google Ads beside Facebook, and clicks/impressions for both.
--
-- google_ads_accounts      one per business: the chosen Google Ads account and the
--                          owner's encrypted refresh token. Server-only (RLS on, no
--                          client policies), like meta_ad_accounts.
-- google_ad_spend_daily    cost, clicks, impressions and conversions per campaign per
--                          day, from the Google Ads API (read only). Server-only too:
--                          the report is served by owner-checked server functions.
-- meta_ad_spend_daily      gains clicks and impressions.

ALTER TABLE public.meta_ad_spend_daily ADD COLUMN IF NOT EXISTS clicks integer;
ALTER TABLE public.meta_ad_spend_daily ADD COLUMN IF NOT EXISTS impressions integer;

CREATE TABLE IF NOT EXISTS public.google_ads_accounts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id text CHECK (customer_id IS NULL OR customer_id ~ '^[0-9]{6,12}$'),
  customer_name text,
  currency text,
  login_customer_id text CHECK (login_customer_id IS NULL OR login_customer_id ~ '^[0-9]{6,12}$'),
  available_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  refresh_token_ciphertext text NOT NULL,
  access_token_ciphertext text,
  access_token_expires_at timestamptz,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.google_ads_accounts TO service_role;
ALTER TABLE public.google_ads_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.google_ad_spend_daily (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  date date NOT NULL,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  conversions numeric(12,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, campaign_id, date)
);
GRANT ALL ON public.google_ad_spend_daily TO service_role;
ALTER TABLE public.google_ad_spend_daily ENABLE ROW LEVEL SECURITY;
