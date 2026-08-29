ALTER TABLE public.pilot_applications
  DROP CONSTRAINT pilot_applications_access_state_check;

ALTER TABLE public.pilot_applications
  ADD CONSTRAINT pilot_applications_access_state_check
  CHECK (access_state = ANY (ARRAY[
    'pending'::text,
    'paid'::text,
    'paid_by_platform_credits'::text,
    'past_due'::text,
    'canceled'::text,
    'paused'::text,
    'pilot_expired'::text
  ]));

ALTER TABLE public.pilot_applications
  ADD CONSTRAINT pilot_applications_credit_state_has_no_stripe
  CHECK (
    access_state <> 'paid_by_platform_credits'::text
    OR (
      stripe_customer_id IS NULL
      AND stripe_subscription_id IS NULL
      AND stripe_checkout_session_id IS NULL
    )
  );