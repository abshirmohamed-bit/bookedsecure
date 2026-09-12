ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'preview',
  ADD COLUMN IF NOT EXISTS billing_interval text NOT NULL DEFAULT 'month',
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS past_due_since timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_updated_at timestamptz;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_subscription_status_check
  CHECK (subscription_status IN ('preview','active','past_due','canceled'));

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_billing_interval_check
  CHECK (billing_interval IN ('month','year'));

CREATE UNIQUE INDEX IF NOT EXISTS businesses_stripe_subscription_id_key
  ON public.businesses (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS businesses_stripe_customer_id_idx
  ON public.businesses (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE public.businesses ALTER COLUMN plan_id SET DEFAULT 'essentials';

-- Businesses that already had live messaging access keep it on their current plan.
UPDATE public.businesses b
SET subscription_status = 'active',
    current_period_start = date_trunc('month', now()),
    current_period_end = date_trunc('month', now()) + interval '1 month',
    subscription_updated_at = now()
WHERE b.subscription_status = 'preview'
  AND EXISTS (
    SELECT 1 FROM public.pilot_applications pa
    WHERE pa.business_id = b.id
      AND pa.access_state IN ('paid','paid_by_platform_credits')
  );

-- Plans: confirmed commercial model.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS campaigns_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS automation_custom_enabled boolean NOT NULL DEFAULT false;

UPDATE public.plans SET included_segments = 900, overage_cents = 6,
  campaigns_enabled = false, automation_custom_enabled = false
WHERE id = 'essentials';
UPDATE public.plans SET included_segments = 1500, overage_cents = 6,
  campaigns_enabled = true, automation_custom_enabled = true, reactivation_enabled = true
WHERE id = 'pro';

-- Usage periods can belong to a business subscription directly.
ALTER TABLE public.sms_usage_periods ALTER COLUMN pilot_application_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS sms_usage_periods_business_period_idx
  ON public.sms_usage_periods (business_id, period_start DESC);

-- Atomic purchased-credit spend: fails (returns NULL) when the balance is short.
CREATE OR REPLACE FUNCTION public.spend_sms_credits(p_business_id uuid, p_credits integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_balance integer;
BEGIN
  UPDATE public.texto_accounts
  SET credit_balance = credit_balance - p_credits,
      updated_at = now()
  WHERE business_id = p_business_id
    AND credit_balance >= p_credits
  RETURNING credit_balance INTO v_balance;
  RETURN v_balance;
END;
$$;

CREATE OR REPLACE FUNCTION public.refund_sms_credits(p_business_id uuid, p_credits integer)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.texto_accounts
  SET credit_balance = credit_balance + p_credits,
      updated_at = now()
  WHERE business_id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.spend_sms_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refund_sms_credits(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spend_sms_credits(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refund_sms_credits(uuid, integer) TO service_role;