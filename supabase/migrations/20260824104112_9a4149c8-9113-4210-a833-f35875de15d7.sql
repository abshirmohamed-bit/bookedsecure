-- 1. SMS senders --------------------------------------------------------------
CREATE TABLE public.sms_senders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  phone_number text NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'twilio',
  credential_mode text NOT NULL DEFAULT 'platform',
  subaccount_sid text,
  credential_secret_name text,
  label text,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  status_callback_url text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sms_senders_one_primary ON public.sms_senders (business_id) WHERE is_primary;
CREATE INDEX sms_senders_business ON public.sms_senders (business_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_senders TO authenticated;
GRANT ALL ON public.sms_senders TO service_role;
ALTER TABLE public.sms_senders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "senders tenant" ON public.sms_senders FOR ALL TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());
CREATE TRIGGER sms_senders_updated BEFORE UPDATE ON public.sms_senders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Consent / STOP history ----------------------------------------------------
CREATE TABLE public.consent_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel text NOT NULL DEFAULT 'sms',
  mobile_number text,
  consent_text text,
  source text,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX consent_events_lead ON public.consent_events (lead_id, occurred_at DESC);

GRANT SELECT ON public.consent_events TO authenticated;
GRANT ALL ON public.consent_events TO service_role;
ALTER TABLE public.consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consent history readable in tenant" ON public.consent_events FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- 3. SMS usage rollup ----------------------------------------------------------
CREATE TABLE public.sms_usage_daily (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  segments_out integer NOT NULL DEFAULT 0,
  messages_out integer NOT NULL DEFAULT 0,
  segments_in integer NOT NULL DEFAULT 0,
  failures integer NOT NULL DEFAULT 0,
  provider_cost numeric NOT NULL DEFAULT 0,
  retail_charge numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (business_id, usage_date)
);
GRANT SELECT ON public.sms_usage_daily TO authenticated;
GRANT ALL ON public.sms_usage_daily TO service_role;
ALTER TABLE public.sms_usage_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms usage readable in tenant" ON public.sms_usage_daily FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE TRIGGER sms_usage_daily_updated BEFORE UPDATE ON public.sms_usage_daily
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. AI usage ------------------------------------------------------------------
CREATE TABLE public.ai_usage_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  purpose text NOT NULL,
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_detail text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_business_date ON public.ai_usage_events (business_id, created_at DESC);
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai usage readable in tenant" ON public.ai_usage_events FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());

-- 5. Usage limits --------------------------------------------------------------
CREATE TABLE public.usage_limits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  monthly_segment_cap integer NOT NULL DEFAULT 2000,
  monthly_ai_cost_cap numeric NOT NULL DEFAULT 25,
  alert_threshold_pct integer NOT NULL DEFAULT 80,
  hard_block boolean NOT NULL DEFAULT true,
  last_alert_sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.usage_limits TO authenticated;
GRANT ALL ON public.usage_limits TO service_role;
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "limits readable in tenant" ON public.usage_limits FOR SELECT TO authenticated
  USING (business_id = public.current_business_id());
CREATE POLICY "limits editable in tenant" ON public.usage_limits FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());
CREATE TRIGGER usage_limits_updated BEFORE UPDATE ON public.usage_limits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Column additions ---------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN sender_id uuid REFERENCES public.sms_senders(id) ON DELETE SET NULL,
  ADD COLUMN from_number text,
  ADD COLUMN segments integer NOT NULL DEFAULT 1,
  ADD COLUMN provider_cost numeric,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 1,
  ADD COLUMN next_retry_at timestamp with time zone;

ALTER TABLE public.businesses
  ADD COLUMN sms_credential_mode text NOT NULL DEFAULT 'platform';

ALTER TABLE public.webhook_events
  ADD COLUMN business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN signature_verified boolean;

-- 7. Seed the pilot sender + caps ---------------------------------------------
INSERT INTO public.sms_senders (business_id, phone_number, provider, credential_mode, label, is_primary, active)
SELECT b.id, COALESCE(NULLIF(b.phone_number, ''), '+61480000000'), 'twilio', 'platform',
       'Glocast dedicated number', true, true
FROM public.businesses b
ORDER BY b.created_at
LIMIT 1;

INSERT INTO public.usage_limits (business_id)
SELECT id FROM public.businesses
ON CONFLICT (business_id) DO NOTHING;

-- 8. Automatic follow-up scheduler --------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'sms-follow-ups-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--32747b7a-7d60-4b57-a38a-e5b710c823bb-dev.lovable.app/api/public/hooks/follow-ups',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_WHi8jU1SJMy0w1-JeuojfA_ie90kzam'),
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);