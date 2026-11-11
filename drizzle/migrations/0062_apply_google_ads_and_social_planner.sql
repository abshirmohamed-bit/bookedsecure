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

ALTER TABLE public.linkedin_posts DROP CONSTRAINT IF EXISTS linkedin_posts_status_check;
ALTER TABLE public.linkedin_posts ADD CONSTRAINT linkedin_posts_status_check
  CHECK (status IN ('draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'failed', 'cancelled'));

ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS approved_by uuid;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS insights jsonb;
ALTER TABLE public.linkedin_posts ADD COLUMN IF NOT EXISTS insights_at timestamptz;

CREATE INDEX IF NOT EXISTS linkedin_posts_planner_idx
  ON public.linkedin_posts (business_id, coalesce(published_at, scheduled_for, created_at));