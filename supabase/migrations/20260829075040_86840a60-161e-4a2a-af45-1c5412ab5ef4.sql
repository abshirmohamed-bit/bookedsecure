ALTER TABLE public.pilot_applications
  ADD COLUMN IF NOT EXISTS renewal_prevention_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_prevention_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS renewal_prevention_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS renewal_prevention_last_error text;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.cron_credentials (
  name text PRIMARY KEY,
  secret text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON SCHEMA private FROM anon, authenticated;
REVOKE ALL ON private.cron_credentials FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_cron_credential(p_name text, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, pg_temp
AS $$
BEGIN
  INSERT INTO private.cron_credentials (name, secret, updated_at)
  VALUES (p_name, p_secret, now())
  ON CONFLICT (name) DO UPDATE
    SET secret = EXCLUDED.secret, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_cron_credential(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_cron_credential(text, text) TO service_role;

SELECT cron.unschedule('pilot-expiry-hourly');

SELECT cron.schedule(
  'pilot-expiry-hourly',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://bookedsecure.lovable.app/api/public/hooks/pilot-expiry',
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