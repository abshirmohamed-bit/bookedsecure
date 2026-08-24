CREATE TABLE public.automation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  job_type text NOT NULL,
  step integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  run_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX automation_jobs_idempotency_key_uidx ON public.automation_jobs (idempotency_key);
CREATE INDEX automation_jobs_due_idx ON public.automation_jobs (status, run_at);
CREATE INDEX automation_jobs_lead_idx ON public.automation_jobs (lead_id);

GRANT SELECT ON public.automation_jobs TO authenticated;
GRANT ALL ON public.automation_jobs TO service_role;

ALTER TABLE public.automation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs readable in tenant" ON public.automation_jobs
  FOR SELECT TO authenticated USING (business_id = public.current_business_id());

CREATE TRIGGER automation_jobs_updated BEFORE UPDATE ON public.automation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid,
  kind text NOT NULL DEFAULT 'new_lead',
  title text NOT NULL,
  body text NOT NULL,
  metadata jsonb,
  idempotency_key text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notifications_idempotency_key_uidx ON public.notifications (idempotency_key);
CREATE INDEX notifications_business_created_idx ON public.notifications (business_id, created_at DESC);

GRANT SELECT, UPDATE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications readable in tenant" ON public.notifications
  FOR SELECT TO authenticated USING (business_id = public.current_business_id());

CREATE POLICY "notifications markable in tenant" ON public.notifications
  FOR UPDATE TO authenticated
  USING (business_id = public.current_business_id())
  WITH CHECK (business_id = public.current_business_id());

UPDATE public.usage_limits
SET monthly_segment_cap = 200, monthly_ai_cost_cap = 10, hard_block = true, alert_threshold_pct = 80
WHERE business_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.usage_limits (business_id, monthly_segment_cap, monthly_ai_cost_cap, hard_block, alert_threshold_pct)
SELECT '11111111-1111-1111-1111-111111111111', 200, 10, true, 80
WHERE NOT EXISTS (SELECT 1 FROM public.usage_limits WHERE business_id = '11111111-1111-1111-1111-111111111111');

SELECT cron.unschedule('sms-follow-ups-every-10-min');
SELECT cron.schedule(
  'sms-follow-ups-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://shine-reply-flow.lovable.app/api/public/hooks/follow-ups',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_WHi8jU1SJMy0w1-JeuojfA_ie90kzam'),
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);