-- Booking confirmations by email and text, on every new booking.
--
-- businesses.booking_email   the business's confirmation email: on/off, subject,
--                            its own HTML (merge fields, hosted images) and an
--                            optional reply-to. Null means the built-in template.
-- jobs.notify_customer       the per-booking switch: false and nothing is sent
--                            automatically for that booking.
-- booking_confirmations      the send log, one row per booking per channel. The
--                            unique (job_id, channel) is also the claim that keeps
--                            two requests from emailing the same customer twice.
-- Written only by the server; each business reads its own rows.

ALTER TABLE public.businesses ADD COLUMN IF NOT EXISTS booking_email jsonb;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS notify_customer boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.booking_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES public.jobs (id) ON DELETE CASCADE,
  lead_id uuid,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'skipped', 'failed')),
  reason text,
  recipient text,
  subject text,
  provider_message_id text,
  trigger text NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto', 'manual')),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, channel)
);
CREATE INDEX IF NOT EXISTS booking_confirmations_business_idx
  ON public.booking_confirmations (business_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS booking_confirmations_retry_idx
  ON public.booking_confirmations (status, updated_at) WHERE status = 'failed';

REVOKE ALL ON public.booking_confirmations FROM anon, authenticated;
GRANT SELECT ON public.booking_confirmations TO authenticated;
GRANT ALL ON public.booking_confirmations TO service_role;
ALTER TABLE public.booking_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY booking_confirmations_read ON public.booking_confirmations FOR SELECT TO authenticated
  USING (business_id = (SELECT p.business_id FROM public.profiles p WHERE p.id = auth.uid()));
