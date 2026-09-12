SELECT cron.schedule(
  'topup-expiry-hourly',
  '20 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/topup-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || c.secret
    ),
    body := '{"source":"pg_cron"}'::jsonb
  )
  FROM private.cron_credentials c
  WHERE c.name = 'lovable_cron';
  $$
);