ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_subscription_status_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_subscription_status_check
  CHECK (subscription_status IN ('preview','trialing','active','past_due','canceled'));

COMMENT ON COLUMN public.businesses.subscription_status IS
  'Access state: preview, trialing, active, past_due, or canceled. Trialing access expires at current_period_end.';