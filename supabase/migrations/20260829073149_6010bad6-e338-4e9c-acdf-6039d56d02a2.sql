UPDATE public.commercial_config
SET stripe_product_id = 'bookedsecure_paid_pilot',
    stripe_recurring_price_id = 'paid_pilot_monthly',
    updated_at = now()
WHERE singleton IS TRUE;

SELECT cron.unschedule('sms-follow-ups-every-10-min');
SELECT cron.schedule(
  'sms-follow-ups-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/follow-ups',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_WHi8jU1SJMy0w1-JeuojfA_ie90kzam'),
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'pilot-expiry-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/pilot-expiry',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_publishable_WHi8jU1SJMy0w1-JeuojfA_ie90kzam'),
    body := '{"source":"pg_cron"}'::jsonb
  );
  $$
);