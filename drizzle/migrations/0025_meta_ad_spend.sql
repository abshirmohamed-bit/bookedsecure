-- Facebook ad spend for the cost-per-lead / cost-per-job report.
-- Both tables are server-only (RLS on, no client policies): meta_ad_accounts holds
-- an encrypted user token, and the report is served by owner-checked server functions.
CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  ad_account_id text CHECK (ad_account_id IS NULL OR ad_account_id ~ '^[0-9]{3,40}$'),
  ad_account_name text,
  currency text,
  available_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  user_token_ciphertext text,
  token_expires_at timestamptz,
  last_spend_sync_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.meta_ad_accounts TO service_role;
ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.meta_ad_spend_daily (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  campaign_id text NOT NULL,
  campaign_name text,
  date date NOT NULL,
  spend numeric(12,2) NOT NULL DEFAULT 0,
  meta_leads integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, campaign_id, date)
);
GRANT ALL ON public.meta_ad_spend_daily TO service_role;
ALTER TABLE public.meta_ad_spend_daily ENABLE ROW LEVEL SECURITY;
