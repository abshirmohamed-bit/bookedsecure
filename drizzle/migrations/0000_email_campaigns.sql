CREATE TABLE public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  from_address text NOT NULL DEFAULT 'onboarding@resend.dev',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  sent_at timestamptz,
  cancelled_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_campaigns TO authenticated;
GRANT ALL ON public.email_campaigns TO service_role;

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email campaigns tenant" ON public.email_campaigns
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());

CREATE TABLE public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns (id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads (id) ON DELETE SET NULL,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  error text,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_campaign_recipients TO authenticated;
GRANT ALL ON public.email_campaign_recipients TO service_role;

ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email recipients tenant" ON public.email_campaign_recipients
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());

CREATE INDEX email_campaign_recipients_campaign_idx
  ON public.email_campaign_recipients (campaign_id);

CREATE TABLE public.email_unsubscribes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, email)
);

GRANT SELECT, INSERT, DELETE ON public.email_unsubscribes TO authenticated;
GRANT ALL ON public.email_unsubscribes TO service_role;

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email unsubscribes tenant" ON public.email_unsubscribes
  FOR ALL TO authenticated
  USING (business_id = private.current_business_id())
  WITH CHECK (business_id = private.current_business_id());