-- ===== 1. Central commercial configuration (singleton, admin-managed) =====
CREATE TABLE public.commercial_config (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  currency text NOT NULL DEFAULT 'aud',
  pilot_price_minor_units integer NOT NULL DEFAULT 9900,
  billing_interval text NOT NULL DEFAULT 'month',
  included_sms_segments integer NOT NULL DEFAULT 250,
  overage_mode text NOT NULL DEFAULT 'hard_cap',
  pilot_duration_days integer NOT NULL DEFAULT 30,
  support_channel text NOT NULL DEFAULT 'email',
  support_address text NOT NULL DEFAULT '',
  support_target_business_days integer NOT NULL DEFAULT 1,
  cancellation_terms text NOT NULL DEFAULT 'cancel_before_next_renewal',
  pilot_end_action text NOT NULL DEFAULT 'pause',
  stripe_product_id text,
  stripe_recurring_price_id text,
  configuration_version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.commercial_config TO service_role;
ALTER TABLE public.commercial_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER commercial_config_updated
  BEFORE UPDATE ON public.commercial_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.commercial_config (
  currency, pilot_price_minor_units, billing_interval, included_sms_segments,
  overage_mode, pilot_duration_days, support_channel, support_address,
  support_target_business_days, cancellation_terms, pilot_end_action,
  stripe_product_id, stripe_recurring_price_id
) VALUES (
  'aud', 9900, 'month', 250,
  'hard_cap', 30, 'email', '',
  1, 'cancel_before_next_renewal', 'pause',
  'bookedsecure_paid_pilot', 'paid_pilot_monthly'
);

-- ===== 2. Commercial fields on pilot_applications =====
ALTER TABLE public.pilot_applications
  ADD COLUMN IF NOT EXISTS commercial_status text NOT NULL DEFAULT 'not_invited',
  ADD COLUMN IF NOT EXISTS payment_required boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS pilot_extension_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS continuation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS continuation_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS continuation_approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancellation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_state text NOT NULL DEFAULT 'pending'
    CHECK (access_state IN ('pending','paid','past_due','canceled','paused','pilot_expired')),
  ADD COLUMN IF NOT EXISTS access_state_reason text,
  ADD COLUMN IF NOT EXISTS commercial_configuration_version integer,
  ADD COLUMN IF NOT EXISTS commercial_terms_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS last_payment_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS pilot_applications_access_state_idx ON public.pilot_applications (access_state);
CREATE INDEX IF NOT EXISTS pilot_applications_stripe_customer_idx ON public.pilot_applications (stripe_customer_id);
CREATE INDEX IF NOT EXISTS pilot_applications_stripe_subscription_idx ON public.pilot_applications (stripe_subscription_id);
CREATE INDEX IF NOT EXISTS pilot_applications_business_idx ON public.pilot_applications (business_id);

-- ===== 3. Per-billing-period SMS usage with atomic reservation =====
CREATE TABLE public.sms_usage_periods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pilot_application_id uuid NOT NULL REFERENCES public.pilot_applications(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  included_segments integer NOT NULL DEFAULT 250,
  segments_used integer NOT NULL DEFAULT 0,
  segments_blocked integer NOT NULL DEFAULT 0,
  hard_cap_reached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sms_usage_periods_pilot_idx ON public.sms_usage_periods (pilot_application_id);
CREATE INDEX sms_usage_periods_business_idx ON public.sms_usage_periods (business_id);

GRANT ALL ON public.sms_usage_periods TO service_role;
ALTER TABLE public.sms_usage_periods ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER sms_usage_periods_updated
  BEFORE UPDATE ON public.sms_usage_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Atomic reservation: one UPDATE guarded by the cap, so concurrent sends
-- cannot both pass at the limit. Returns the updated row, or NULL when the
-- reservation would exceed the included segments.
CREATE OR REPLACE FUNCTION public.reserve_sms_segments(p_period_id uuid, p_segments integer)
RETURNS public.sms_usage_periods
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  result public.sms_usage_periods;
BEGIN
  UPDATE public.sms_usage_periods
  SET segments_used = segments_used + p_segments,
      hard_cap_reached_at = CASE
        WHEN segments_used + p_segments >= included_segments AND hard_cap_reached_at IS NULL THEN now()
        ELSE hard_cap_reached_at
      END,
      updated_at = now()
  WHERE id = p_period_id
    AND segments_used + p_segments <= included_segments
  RETURNING * INTO result;
  RETURN result;
END;
$$;

-- Records a blocked send attempt (does not count toward usage).
CREATE OR REPLACE FUNCTION public.record_blocked_sms_segments(p_period_id uuid, p_segments integer)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE public.sms_usage_periods
  SET segments_blocked = segments_blocked + p_segments,
      hard_cap_reached_at = COALESCE(hard_cap_reached_at, now()),
      updated_at = now()
  WHERE id = p_period_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_sms_segments(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_blocked_sms_segments(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_sms_segments(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_blocked_sms_segments(uuid, integer) TO service_role;

-- ===== 4. Stripe webhook event ledger (idempotency) =====
CREATE TABLE public.stripe_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','failed','duplicate')),
  processing_error text,
  payload_reference jsonb
);

GRANT ALL ON public.stripe_events TO service_role;
ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY;